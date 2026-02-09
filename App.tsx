import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ScriptLine, SrtLine } from './types';
import { VOICES, LANGUAGES, LinkIcon, XCircleIcon, KeyIcon } from './constants';
import { generateSingleSpeakerAudio, previewVoice, transcribeAudioWithSrt, setApiKey, getApiKey } from './services/geminiService';
import { MainContent } from './components/MainContent';
import {
    createWavBlobFromBase64Pcm,
    encodeAudioBufferToWavBlob,
    sliceAudioBuffer,
    analyzeScript,
    msToSrtTime,
    stringifySrt,
    audioBufferToWavBase64,
    parseSrt,
    adjustSrtGaps,
    srtTimeToMs,
    spliceAudio,
    detectSilence
} from './components/Header';

// Defines the structure for each generated audio clip in the history
export interface AudioHistoryItem {
    id: string;
    src: string;
    scriptChunk: string;
    audioBuffer: AudioBuffer;
    isTrimmed: boolean;
    contextDuration: number; // Duration of the prepended context in seconds
    status: 'full' | 'trimmed';
    srtLines: SrtLine[];
    originalSrtLines: SrtLine[];
}

interface TtsResult {
    audioHistory: AudioHistoryItem[];
    srtContent: string | null;
}

export interface AutoFormatOptions {
    period: boolean;
    question: boolean;
    exclamation: boolean;
    comma: boolean;
}

export const MAX_CHAR_LIMIT = 10000;

const USEFUL_LINKS = [
    {
        title: "Trend Finder 분석 사이트",
        desc: "유튜브 분석과 주제 발굴, 키워드 및 채널 분석 등",
        url: "https://second.moducalc.com/"
    },
    {
        title: "모두의 계산기",
        desc: "50개 이상의 생활 필수 계산기 모음",
        url: "https://www.moducalc.com/"
    },
    {
        title: "트파 유튜브 채널",
        desc: "Trend Finder의 공식 유튜브 채널",
        url: "https://www.youtube.com/channel/UCDtBxeitkVsiLRNLX7DOdCA"
    },
    {
        title: "트파 콘텐츠 멤버십 가입하기",
        desc: "채널 멤버십 가입을 통해 콘텐츠 제작을 후원해주세요.",
        url: "https://www.youtube.com/channel/UCDtBxeitkVsiLRNLX7DOdCA/join"
    }
];

export function App() {
    const [singleSpeakerVoice, setSingleSpeakerVoice] = useState<string>('');
    const [scriptLines, setScriptLines] = useState<ScriptLine[]>([]);

    const [ttsResult, setTtsResult] = useState<TtsResult>({ audioHistory: [], srtContent: null });
    const [activeAudioId, setActiveAudioId] = useState<string | null>(null);

    const [editableSrtLines, setEditableSrtLines] = useState<SrtLine[]>([]);
    const [originalSrtLines, setOriginalSrtLines] = useState<SrtLine[]>([]);
    const [hasTimestampEdits, setHasTimestampEdits] = useState(false);
    const [isTimestampSyncEnabled, setIsTimestampSyncEnabled] = useState(true);

    const [isLoading, setIsLoading] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const [isPreviewLoading, setIsPreviewLoading] = useState<Record<string, boolean>>({});
    const [srtSplitCharCount, setSrtSplitCharCount] = useState<number>(25);

    const [activeSrtLineId, setActiveSrtLineId] = useState<string | null>(null);
    const [silentSegments, setSilentSegments] = useState<{ start: number; end: number }[]>([]);
    const [isAnalysisPanelOpen, setIsAnalysisPanelOpen] = useState(false);
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [isApiKeySet, setIsApiKeySet] = useState(!!getApiKey());

    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        // Initial sample text
        if (scriptLines.length === 0) {
            setScriptLines([
                { id: 'line-1', speakerId: 'Speaker', text: '안녕하세요! 툴비 스튜디오입니다.' },
                { id: 'line-2', speakerId: 'Speaker', text: '여러분이 원하는 음성을 만드실수 있습니다.' },
                { id: 'line-3', speakerId: 'Speaker', text: '텍스트를 입력하시고 테스트 해보세요.' }
            ]);
        }
    }, []);

    useEffect(() => {
        const savedKey = localStorage.getItem('gemini_api_key');
        if (savedKey) {
            setApiKey(savedKey);
            setIsApiKeySet(true);
        }
    }, []);

    const scriptAnalysis = useMemo(() => {
        const fullText = scriptLines.map(l => l.text).join('\n');
        return analyzeScript(fullText);
    }, [scriptLines]);

    const totalEstimatedTime = useMemo(() => {
        return scriptLines.reduce((acc, line) => acc + (line.estimatedTime || 0), 0);
    }, [scriptLines]);

    const handleScriptChange = (newFullScript: string) => {
        const lines = newFullScript.split('\n');
        setScriptLines(prev => {
            return lines.map((text, index) => {
                const charCount = text.replace(/\s/g, '').length;
                const estimatedTime = charCount * 0.25;

                if (index < prev.length) {
                    return {
                        ...prev[index],
                        text: text,
                        estimatedTime: estimatedTime
                    };
                } else {
                    return {
                        id: `line-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
                        speakerId: 'Speaker',
                        text: text,
                        estimatedTime: estimatedTime,
                        style: ''
                    };
                }
            });
        });
    };

    const handleUpdateScriptLine = (id: string, newValues: Partial<Omit<ScriptLine, 'id'>>) => {
        setScriptLines(prev => prev.map(line => {
            if (line.id === id) {
                const updated = { ...line, ...newValues };
                if (newValues.text !== undefined) {
                    const charCount = updated.text.replace(/\s/g, '').length;
                    updated.estimatedTime = charCount * 0.25;
                }
                return updated;
            }
            return line;
        }));
    };

    const handleRemoveScriptLine = (id: string) => {
        if (scriptLines.length <= 1) {
            setScriptLines([{ id: `line-${Date.now()}`, speakerId: 'Speaker', text: '' }]);
        } else {
            setScriptLines(prev => prev.filter(l => l.id !== id));
        }
    };

    const handleAddScriptLine = () => {
        setScriptLines(prev => [
            ...prev,
            { id: `line-${Date.now()}`, speakerId: 'Speaker', text: '' }
        ]);
    };

    const handleRemoveEmptyScriptLines = () => {
        setScriptLines(prev => {
            const filtered = prev.filter(line => line.text.trim().length > 0);
            return filtered.length > 0 ? filtered : [{ id: `line-${Date.now()}`, speakerId: 'Speaker', text: '' }];
        });
    };

    const handleSplitScriptLine = (index: number, cursorPosition: number) => {
        setScriptLines(prev => {
            const newLines = [...prev];
            const line = newLines[index];
            const text = line.text;

            const firstPart = text.slice(0, cursorPosition);
            const secondPart = text.slice(cursorPosition);

            const calcTime = (t: string) => t.replace(/\s/g, '').length * 0.25;

            // Update current line
            newLines[index] = {
                ...line,
                text: firstPart,
                estimatedTime: calcTime(firstPart)
            };

            // Insert new line after
            newLines.splice(index + 1, 0, {
                id: `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                speakerId: line.speakerId,
                text: secondPart,
                estimatedTime: calcTime(secondPart),
                style: line.style // Inherit style
            });

            return newLines;
        });
    };

    const handleMergeScriptLine = (index: number, direction: 'up' | 'down') => {
        setScriptLines(prev => {
            const newLines = [...prev];

            if (direction === 'up') {
                if (index <= 0) return prev;
                const prevLine = newLines[index - 1];
                const currLine = newLines[index];

                const combinedText = (prevLine.text.trim() + ' ' + currLine.text.trim()).trim();
                prevLine.text = combinedText;
                prevLine.estimatedTime = combinedText.replace(/\s/g, '').length * 0.25;

                newLines.splice(index, 1);
            } else {
                if (index >= newLines.length - 1) return prev;
                const currLine = newLines[index];
                const nextLine = newLines[index + 1];

                const combinedText = (currLine.text.trim() + ' ' + nextLine.text.trim()).trim();
                currLine.text = combinedText;
                currLine.estimatedTime = combinedText.replace(/\s/g, '').length * 0.25;

                newLines.splice(index + 1, 1);
            }

            return newLines;
        });
    };

    const handleAutoFormatScript = (options: AutoFormatOptions) => {
        setScriptLines(prev => {
            // Combine existing lines into one string, handling existing newlines as spaces to reflow
            const fullText = prev.map(l => l.text).join(' ');

            const triggers = [];
            if (options.period) triggers.push('\\.');
            if (options.question) triggers.push('\\?');
            if (options.exclamation) triggers.push('!');
            if (options.comma) triggers.push(',');

            if (triggers.length === 0) return prev;

            const pattern = `([${triggers.join('')}])`;
            // Regex to match trigger char followed by whitespace(s)
            const splitRegex = new RegExp(`${pattern}\\s+`, 'g');
            // Regex to match trigger char at the very end of string
            const endRegex = new RegExp(`${pattern}$`, 'g');

            const newText = fullText
                .replace(splitRegex, '$1\n')
                .replace(endRegex, '$1\n');

            const newLines = newText.split('\n')
                .map(t => t.trim())
                .filter(t => t.length > 0);

            if (newLines.length === 0) return [{ id: `line-${Date.now()}`, speakerId: 'Speaker', text: '' }];

            return newLines.map((text, index) => {
                const charCount = text.replace(/\s/g, '').length;
                return {
                    id: `line-${Date.now()}-${index}`,
                    speakerId: 'Speaker',
                    text: text,
                    estimatedTime: charCount * 0.25,
                    style: ''
                };
            });
        });
    };

    const handleSaveApiKey = () => {
        const trimmedKey = apiKeyInput.trim();
        if (!trimmedKey) return;
        setApiKey(trimmedKey);
        localStorage.setItem('gemini_api_key', trimmedKey);
        setIsApiKeySet(true);
        setApiKeyInput('');
        setIsApiKeyModalOpen(false);
    };

    const handleOpenApiKeyModal = () => {
        setApiKeyInput(getApiKey());
        setIsApiKeyModalOpen(true);
    };

    const handlePreviewVoice = async (voiceId: string) => {
        if (isPreviewLoading[voiceId]) return;

        setIsPreviewLoading(prev => ({ ...prev, [voiceId]: true }));
        try {
            const audio = new Audio(`/previews/${voiceId}.wav`);
            await audio.play();
        } catch (e) {
            // Fallback to API if local file fails
            try {
                const base64Pcm = await previewVoice(voiceId);
                const blob = createWavBlobFromBase64Pcm(base64Pcm);
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.onended = () => URL.revokeObjectURL(url);
                await audio.play();
            } catch (e2) {
                console.error("Preview failed", e2);
                alert("음성 미리듣기에 실패했습니다.");
            }
        } finally {
            setIsPreviewLoading(prev => ({ ...prev, [voiceId]: false }));
        }
    };

    const handleGenerateAudio = async () => {
        const fullText = scriptLines.map(l => l.text).join('\n').trim();
        if (!fullText) {
            setError("변환할 텍스트를 입력해주세요.");
            return;
        }
        if (fullText.length > MAX_CHAR_LIMIT) {
            setError(`글자 수는 ${MAX_CHAR_LIMIT}자를 초과할 수 없습니다.`);
            return;
        }
        if (!singleSpeakerVoice) {
            setError("음성을 선택해주세요.");
            return;
        }

        setIsLoading(true);
        setLoadingStatus('오디오 생성 중...');
        setError(null);
        abortControllerRef.current = new AbortController();

        try {
            const base64Pcm = await generateSingleSpeakerAudio(fullText, singleSpeakerVoice, abortControllerRef.current.signal);

            setLoadingStatus('오디오 처리 중...');
            const blob = createWavBlobFromBase64Pcm(base64Pcm);
            const url = URL.createObjectURL(blob);
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());

            setLoadingStatus('자막 생성 중...');
            const wavBase64 = await audioBufferToWavBase64(audioBuffer);

            const srt = await transcribeAudioWithSrt(wavBase64, srtSplitCharCount, abortControllerRef.current.signal, fullText);

            const parsedSrt = parseSrt(srt);
            const adjustedSrt = adjustSrtGaps(parsedSrt);

            const newItem: AudioHistoryItem = {
                id: `audio-${Date.now()}`,
                src: url,
                scriptChunk: fullText,
                audioBuffer: audioBuffer,
                isTrimmed: false,
                contextDuration: 0,
                status: 'full',
                srtLines: adjustedSrt,
                originalSrtLines: JSON.parse(JSON.stringify(adjustedSrt)),
            };

            setTtsResult(prev => ({
                audioHistory: [newItem, ...prev.audioHistory],
                srtContent: stringifySrt(adjustedSrt)
            }));

            setActiveAudioId(newItem.id);
            setEditableSrtLines(adjustedSrt);
            setOriginalSrtLines(JSON.parse(JSON.stringify(adjustedSrt)));
            setHasTimestampEdits(false);

        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
                setError("작업이 취소되었습니다.");
            } else {
                setError(e instanceof Error ? e.message : "오디오 생성 중 오류가 발생했습니다.");
            }
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
            abortControllerRef.current = null;
        }
    };

    const handleStopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    const handleRegenerateSrt = async (targetId?: string) => {
        // If a specific ID is provided, use it. Otherwise default to the active one, or the latest one.
        const idToUse = targetId || activeAudioId || ttsResult.audioHistory[0]?.id;
        const targetItem = ttsResult.audioHistory.find(item => item.id === idToUse);

        if (!targetItem) return;

        setIsLoading(true);
        setLoadingStatus('자막 재생성 중...');
        setError(null);
        abortControllerRef.current = new AbortController();

        try {
            const wavBase64 = await audioBufferToWavBase64(targetItem.audioBuffer);
            const srt = await transcribeAudioWithSrt(wavBase64, srtSplitCharCount, abortControllerRef.current.signal, targetItem.scriptChunk);
            const parsedSrt = parseSrt(srt);
            const adjustedSrt = adjustSrtGaps(parsedSrt);

            setTtsResult(prev => ({
                ...prev,
                audioHistory: prev.audioHistory.map(item =>
                    item.id === idToUse ? { ...item, srtLines: adjustedSrt, originalSrtLines: JSON.parse(JSON.stringify(adjustedSrt)) } : item
                ),
                srtContent: stringifySrt(adjustedSrt)
            }));

            setEditableSrtLines(adjustedSrt);
            setOriginalSrtLines(JSON.parse(JSON.stringify(adjustedSrt)));
            setHasTimestampEdits(false);
            setActiveAudioId(idToUse); // Ensure the edited audio becomes the active context

        } catch (e) {
            if (e instanceof Error && e.name !== 'AbortError') {
                setError(e.message);
            }
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
            abortControllerRef.current = null;
        }
    };

    const handleClearAudioHistory = () => {
        ttsResult.audioHistory.forEach(item => URL.revokeObjectURL(item.src));
        setTtsResult({ audioHistory: [], srtContent: null });
        setEditableSrtLines([]);
        setOriginalSrtLines([]);
        setSilentSegments([]);
        setActiveAudioId(null);
    };

    const handleTrimAudio = async (id: string) => {
        alert("이 기능은 현재 구현 중입니다.");
    };

    const handleDetectSilence = (targetId?: string) => {
        const idToUse = targetId || activeAudioId || ttsResult.audioHistory[0]?.id;
        const targetItem = ttsResult.audioHistory.find(item => item.id === idToUse);

        if (!targetItem) return;
        const segments = detectSilence(targetItem.audioBuffer);
        setSilentSegments(segments);
    };

    const handleRemoveSilenceSegments = async (segmentsToRemove: { start: number; end: number }[]) => {
        alert("오디오 무음 제거 기능은 자막 편집기 탭에서 오디오 파일을 업로드하여 사용할 수 있습니다.");
        setSilentSegments([]);
    };

    const handleActiveAudioChange = useCallback((id: string) => {
        const item = ttsResult.audioHistory.find(i => i.id === id);
        if (item) {
            setActiveAudioId(id);
            setEditableSrtLines(item.srtLines);
            setOriginalSrtLines(item.originalSrtLines);
            setTtsResult(prev => ({ ...prev, srtContent: stringifySrt(item.srtLines) }));
            setSilentSegments([]); // Reset UI specific states
        }
    }, [ttsResult.audioHistory]);

    const handleUpdateSrtLine = useCallback((id: string, newValues: Partial<Omit<SrtLine, 'id' | 'index'>>) => {
        setEditableSrtLines(prev => {
            const index = prev.findIndex(l => l.id === id);
            if (index === -1) return prev;

            const updatedLines = [...prev];
            const oldLine = updatedLines[index];
            let currentLine = { ...oldLine, ...newValues };

            let startMs = srtTimeToMs(currentLine.startTime);
            let endMs = srtTimeToMs(currentLine.endTime);
            const oldStartMs = srtTimeToMs(oldLine.startTime);
            const oldEndMs = srtTimeToMs(oldLine.endTime);

            updatedLines[index] = currentLine;

            const prevLine = index > 0 ? updatedLines[index - 1] : null;

            if (isTimestampSyncEnabled) {
                // === RIPPLE / ROLLING EDIT MODE (SYNC ON) ===
                // 1. Changing START time -> Adjust PREVIOUS END time (Rolling Edit)
                //    Only if we have a previous line.
                if (newValues.startTime !== undefined && prevLine) {
                    const delta = startMs - oldStartMs;
                    const prevEndMs = srtTimeToMs(prevLine.endTime);
                    const newPrevEndMs = prevEndMs + delta;

                    updatedLines[index - 1] = {
                        ...prevLine,
                        endTime: msToSrtTime(newPrevEndMs)
                    };
                }

                // 2. Changing END time -> Adjust ALL SUBSEQUENT lines (Ripple Edit)
                if (newValues.endTime !== undefined) {
                    const delta = endMs - oldEndMs;
                    for (let i = index + 1; i < updatedLines.length; i++) {
                        const l = updatedLines[i];
                        const lStart = srtTimeToMs(l.startTime) + delta;
                        const lEnd = srtTimeToMs(l.endTime) + delta;
                        updatedLines[i] = {
                            ...l,
                            startTime: msToSrtTime(lStart),
                            endTime: msToSrtTime(lEnd)
                        };
                    }
                }

            } else {
                // === CLAMPING MODE (SYNC OFF) ===
                if (prevLine) {
                    const prevEndMs = srtTimeToMs(prevLine.endTime);
                    if (startMs < prevEndMs) {
                        startMs = prevEndMs; // 이전 종료 시간보다 앞으로 갈 수 없음
                        currentLine.startTime = msToSrtTime(startMs);
                    }
                } else {
                    if (startMs < 0) {
                        startMs = 0;
                        currentLine.startTime = msToSrtTime(startMs);
                    }
                }

                const nextLine = index < updatedLines.length - 1 ? updatedLines[index + 1] : null;
                if (nextLine) {
                    const nextStartMs = srtTimeToMs(nextLine.startTime);
                    if (endMs > nextStartMs) {
                        endMs = nextStartMs; // 다음 시작 시간보다 뒤로 갈 수 없음
                        currentLine.endTime = msToSrtTime(endMs);
                    }
                }

                if (startMs >= endMs) {
                    if (newValues.startTime) {
                        endMs = startMs + 100;
                        currentLine.endTime = msToSrtTime(endMs);
                    }
                    else if (newValues.endTime) {
                        startMs = Math.max(0, endMs - 100);
                        currentLine.startTime = msToSrtTime(startMs);
                    }
                }

                updatedLines[index] = currentLine;
            }

            // Sync with history
            setTtsResult(prevTts => ({
                ...prevTts,
                audioHistory: prevTts.audioHistory.map(item =>
                    item.id === activeAudioId ? { ...item, srtLines: updatedLines } : item
                )
            }));

            return updatedLines;
        });

        // Only set flag if timestamp changed (text edit doesn't count for reconstruction disable)
        if (newValues.startTime !== undefined || newValues.endTime !== undefined) {
            setHasTimestampEdits(true);
        }
    }, [isTimestampSyncEnabled, activeAudioId]);

    const handleRemoveSrtLine = useCallback((id: string) => {
        setEditableSrtLines(prev => {
            const newLines = prev.filter(l => l.id !== id);
            setTtsResult(prevTts => ({
                ...prevTts,
                audioHistory: prevTts.audioHistory.map(item =>
                    item.id === activeAudioId ? { ...item, srtLines: newLines } : item
                )
            }));
            return newLines;
        });
        setHasTimestampEdits(true);
    }, [activeAudioId]);

    const handleSplitSrtLine = useCallback((index: number, cursorPosition: number) => {
        setEditableSrtLines(prev => {
            const line = prev[index];
            const text = line.text;
            const firstPartText = text.slice(0, cursorPosition).trim();
            const secondPartText = text.slice(cursorPosition).trim();

            if (!secondPartText) return prev;

            const startMs = srtTimeToMs(line.startTime);
            const endMs = srtTimeToMs(line.endTime);
            const duration = endMs - startMs;

            const totalLen = text.length;
            const splitRatio = totalLen > 0 ? cursorPosition / totalLen : 0.5;
            const splitTimeMs = startMs + Math.floor(duration * splitRatio);

            const newFirstLine = {
                ...line,
                text: firstPartText,
                endTime: msToSrtTime(splitTimeMs)
            };

            const newSecondLine: SrtLine = {
                id: `srt-${Date.now()}`,
                index: line.index + 1,
                startTime: msToSrtTime(splitTimeMs),
                endTime: line.endTime,
                text: secondPartText
            };

            const newLines = [...prev];
            newLines.splice(index, 1, newFirstLine, newSecondLine);

            const reindexedLines = newLines.map((l, i) => ({ ...l, index: i + 1 }));

            setTtsResult(prevTts => ({
                ...prevTts,
                audioHistory: prevTts.audioHistory.map(item =>
                    item.id === activeAudioId ? { ...item, srtLines: reindexedLines } : item
                )
            }));

            return reindexedLines;
        });
        setHasTimestampEdits(true);
    }, [activeAudioId]);

    const handleResetSrt = () => {
        setEditableSrtLines(JSON.parse(JSON.stringify(originalSrtLines)));
        setTtsResult(prevTts => ({
            ...prevTts,
            audioHistory: prevTts.audioHistory.map(item =>
                item.id === activeAudioId ? { ...item, srtLines: JSON.parse(JSON.stringify(originalSrtLines)) } : item
            )
        }));
        setHasTimestampEdits(false);
    };

    const handleBulkTimeShift = (shiftMs: number) => {
        setEditableSrtLines(prev => {
            const newLines = prev.map(line => {
                const start = Math.max(0, srtTimeToMs(line.startTime) + shiftMs);
                const end = Math.max(0, srtTimeToMs(line.endTime) + shiftMs);
                return {
                    ...line,
                    startTime: msToSrtTime(start),
                    endTime: msToSrtTime(end)
                };
            });

            setTtsResult(prevTts => ({
                ...prevTts,
                audioHistory: prevTts.audioHistory.map(item =>
                    item.id === activeAudioId ? { ...item, srtLines: newLines } : item
                )
            }));
            return newLines;
        });
        setHasTimestampEdits(true);
    };

    const handleReconstructAudio = async () => {
        // Find the audio item that matches the current editing context
        // Defaults to the latest if activeAudioId is somehow null
        const targetItem = activeAudioId
            ? ttsResult.audioHistory.find(item => item.id === activeAudioId)
            : ttsResult.audioHistory[0];

        if (!targetItem) return;

        setIsLoading(true);
        setLoadingStatus('오디오 재구성 중...');
        try {
            const { newBuffer, newSrtLines } = spliceAudio(targetItem.audioBuffer, editableSrtLines, originalSrtLines);
            const blob = encodeAudioBufferToWavBlob(newBuffer);
            const url = URL.createObjectURL(blob);

            const newItem: AudioHistoryItem = {
                id: `audio-reconstructed-${Date.now()}`,
                src: url,
                scriptChunk: targetItem.scriptChunk,
                audioBuffer: newBuffer,
                isTrimmed: true,
                contextDuration: 0,
                status: 'trimmed',
                srtLines: newSrtLines,
                originalSrtLines: JSON.parse(JSON.stringify(newSrtLines)),
            };

            setTtsResult(prev => ({
                ...prev,
                audioHistory: [newItem, ...prev.audioHistory],
                srtContent: stringifySrt(newSrtLines)
            }));

            setActiveAudioId(newItem.id);
            setEditableSrtLines(newSrtLines);
            setOriginalSrtLines(JSON.parse(JSON.stringify(newSrtLines)));
            setHasTimestampEdits(false);

        } catch (e) {
            setError(e instanceof Error ? e.message : "오디오 재구성 실패");
        } finally {
            setIsLoading(false);
            setLoadingStatus('');
        }
    };

    return (
        <div className="min-h-screen text-gray-200 font-sans selection:bg-indigo-500 selection:text-white">
            {/* API Key Modal */}
            {isApiKeyModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900/80 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl max-w-md w-full relative overflow-hidden">
                        <div className="absolute top-4 right-4">
                            <button
                                onClick={() => setIsApiKeyModalOpen(false)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <XCircleIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-6">
                            <h2 className="text-2xl font-bold text-white mb-1">API 키 설정</h2>
                            <p className="text-sm text-gray-400 mb-6">
                                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">Google AI Studio</a>에서 API 키를 발급받아 입력하세요.
                            </p>
                            <input
                                type="password"
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveApiKey(); }}
                                placeholder="API 키를 입력하세요"
                                className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 mb-4"
                            />
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={() => setIsApiKeyModalOpen(false)}
                                    className="px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                                >
                                    취소
                                </button>
                                <button
                                    onClick={handleSaveApiKey}
                                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                                >
                                    저장
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Link Collection Modal */}
            {isLinkModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-gray-900/80 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl max-w-lg w-full relative overflow-hidden">
                        <div className="absolute top-4 right-4">
                            <button
                                onClick={() => setIsLinkModalOpen(false)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <XCircleIcon className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-6">
                            <h2 className="text-2xl font-bold text-white mb-1">🔗 링크 모음</h2>
                            <p className="text-sm text-gray-400 mb-6">Trend Finder의 다양한 서비스와 채널을 만나보세요.</p>
                            <div className="space-y-3">
                                {USEFUL_LINKS.map((link, index) => (
                                    <a
                                        key={index}
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block p-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-indigo-500 transition-all group"
                                    >
                                        <div className="flex justify-between items-center mb-1">
                                            <h3 className="font-bold text-white group-hover:text-indigo-400 transition-colors">{link.title}</h3>
                                            <LinkIcon className="w-4 h-4 text-gray-500 group-hover:text-indigo-400" />
                                        </div>
                                        <p className="text-sm text-gray-400">{link.desc}</p>
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-[1800px] mx-auto px-2 py-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 pb-4">
                <header className="relative w-full pb-4 pt-2">
                    <div className="absolute top-4 right-0 hidden md:flex items-center gap-2">
                        <button
                            onClick={handleOpenApiKeyModal}
                            className={`flex items-center gap-2 bg-white/5 backdrop-blur-xl hover:bg-white/10 text-gray-300 hover:text-white px-4 py-2 rounded-full border transition-colors text-sm font-medium ${isApiKeySet ? 'border-green-600' : 'border-red-600'}`}
                        >
                            <KeyIcon className={`w-4 h-4 ${isApiKeySet ? 'text-green-400' : 'text-red-400'}`} />
                            API 키 설정
                        </button>
                    </div>

                    <div className="flex items-center justify-center gap-3 pt-2">
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white whitespace-nowrap">
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400">TB TTS STUDIO</span>
                        </h1>
                        <button
                            onClick={handleOpenApiKeyModal}
                            className={`md:hidden p-2 rounded-full border transition-colors ${isApiKeySet ? 'border-green-600 bg-green-600/10' : 'border-red-600 bg-red-600/10'}`}
                            title="API 키 설정"
                        >
                            <KeyIcon className={`w-4 h-4 ${isApiKeySet ? 'text-green-400' : 'text-red-400'}`} />
                        </button>
                    </div>
                </header>

                <MainContent
                    singleSpeakerVoice={singleSpeakerVoice}
                    setSingleSpeakerVoice={setSingleSpeakerVoice}
                    voices={VOICES}
                    onPreviewVoice={handlePreviewVoice}
                    isPreviewLoading={isPreviewLoading}
                    srtSplitCharCount={srtSplitCharCount}
                    setSrtSplitCharCount={setSrtSplitCharCount}

                    isLoading={isLoading}
                    loadingStatus={loadingStatus}
                    error={error}
                    audioHistory={ttsResult.audioHistory}
                    srtContent={ttsResult.srtContent}
                    activeSrtLineId={activeSrtLineId}
                    setActiveSrtLineId={setActiveSrtLineId}
                    onGenerateAudio={handleGenerateAudio}
                    onStopGeneration={handleStopGeneration}
                    onClearAudioHistory={handleClearAudioHistory}
                    onTrimAudio={handleTrimAudio}
                    onActiveAudioChange={handleActiveAudioChange}

                    scriptLines={scriptLines}
                    onScriptChange={handleScriptChange}
                    onUpdateScriptLine={handleUpdateScriptLine}
                    onRemoveScriptLine={handleRemoveScriptLine}
                    onAddScriptLine={handleAddScriptLine}
                    onRemoveEmptyScriptLines={handleRemoveEmptyScriptLines}
                    onAutoFormatScript={handleAutoFormatScript}
                    onMergeScriptLine={handleMergeScriptLine}
                    onSplitScriptLine={handleSplitScriptLine}

                    onRegenerateSrt={handleRegenerateSrt}
                    onDetectSilence={handleDetectSilence}
                    silentSegments={silentSegments}
                    onRemoveSilenceSegments={handleRemoveSilenceSegments}
                    scriptAnalysis={scriptAnalysis}
                    totalEstimatedTime={totalEstimatedTime}

                    editableSrtLines={editableSrtLines}
                    originalSrtLines={originalSrtLines}
                    onUpdateSrtLine={handleUpdateSrtLine}
                    onRemoveSrtLine={handleRemoveSrtLine}
                    onSplitSrtLine={handleSplitSrtLine}
                    onResetSrt={handleResetSrt}
                    onBulkTimeShift={handleBulkTimeShift}
                    onReconstructAudio={handleReconstructAudio}
                    hasTimestampEdits={hasTimestampEdits}
                    isTimestampSyncEnabled={isTimestampSyncEnabled}
                    setIsTimestampSyncEnabled={setIsTimestampSyncEnabled}
                    isAnalysisPanelOpen={isAnalysisPanelOpen}
                    setIsAnalysisPanelOpen={setIsAnalysisPanelOpen}
                />
            </div>
        </div>
    );
}