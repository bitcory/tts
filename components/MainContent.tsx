import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ScriptLine, SrtLine, Voice } from '../types';
import { AudioHistoryItem, MAX_CHAR_LIMIT, AutoFormatOptions } from '../App';
import { 
    ChartBarIcon, StopIcon, SparklesIcon, ListBulletIcon, PencilIcon, 
    ClipboardIcon, DownloadIcon, LinkIcon, RefreshIcon, ScissorsIcon, 
    TrashIcon, XCircleIcon, PlusIcon, MinusIcon, StyleIcon, WrapTextIcon,
    ArrowsUpDownIcon, ArrowUpIcon, ArrowDownIcon, PlayIcon, ChevronLeftIcon, ChevronRightIcon
} from '../constants';
import { AudioPlayer, AudioPlayerHandle } from './AudioPlayer';
import { SilenceRemover } from './SilenceRemover';
import { ScriptAnalysis } from './ScriptAnalysis';
import { msToSrtTime, srtTimeToMs } from './Header';
import { DIALOGUE_STYLES } from '../constants';

export interface MainContentProps {
    // Voice & Settings Props
    singleSpeakerVoice: string;
    setSingleSpeakerVoice: (voice: string) => void;
    voices: Voice[];
    onPreviewVoice: (voiceId: string) => void;
    isPreviewLoading: Record<string, boolean>;
    srtSplitCharCount: number;
    setSrtSplitCharCount: (count: number) => void;

    // Main Props
    isLoading: boolean;
    loadingStatus: string;
    error: string | null;
    audioHistory: AudioHistoryItem[];
    srtContent: string | null;
    activeSrtLineId: string | null;
    setActiveSrtLineId: (id: string | null) => void;
    onGenerateAudio: () => void;
    onStopGeneration: () => void;
    onClearAudioHistory: () => void;
    onTrimAudio: (id: string) => void;
    onActiveAudioChange: (id: string) => void;
    scriptLines: ScriptLine[];
    onScriptChange: (newFullScript: string) => void;
    onUpdateScriptLine: (id: string, newValues: Partial<Omit<ScriptLine, 'id'>>) => void;
    onRemoveScriptLine: (id: string) => void;
    onAddScriptLine: () => void;
    onRemoveEmptyScriptLines: () => void;
    onAutoFormatScript: (options: AutoFormatOptions) => void;
    onMergeScriptLine: (index: number, direction: 'up' | 'down') => void;
    onSplitScriptLine: (index: number, cursorPosition: number) => void;
    onRegenerateSrt: (id?: string) => void;
    onDetectSilence: (id?: string) => void;
    silentSegments: { start: number; end: number }[];
    onRemoveSilenceSegments: (segments: { start: number; end: number }[]) => void;
    scriptAnalysis: any;
    totalEstimatedTime: number;
    editableSrtLines: SrtLine[];
    originalSrtLines: SrtLine[];
    onUpdateSrtLine: (id: string, newValues: Partial<Omit<SrtLine, 'id' | 'index'>>) => void;
    onRemoveSrtLine: (id: string) => void;
    onSplitSrtLine: (index: number, cursorPosition: number) => void;
    onResetSrt: () => void;
    onBulkTimeShift: (shiftMs: number) => void;
    onReconstructAudio: () => void;
    hasTimestampEdits: boolean;
    isTimestampSyncEnabled: boolean;
    setIsTimestampSyncEnabled: (enabled: boolean) => void;
    isAnalysisPanelOpen: boolean;
    setIsAnalysisPanelOpen: (isOpen: boolean | ((prev: boolean) => boolean)) => void;
}

interface ScriptEditorProps {
    scriptLines: ScriptLine[];
    onScriptChange: (newFullScript: string) => void;
    onUpdateScriptLine: (id: string, newValues: Partial<Omit<ScriptLine, 'id'>>) => void;
    onRemoveScriptLine: (id: string) => void;
    onAddScriptLine: () => void;
    onRemoveEmptyScriptLines: () => void;
    onAutoFormatScript: (options: AutoFormatOptions) => void;
    onMergeScriptLine: (index: number, direction: 'up' | 'down') => void;
    onSplitScriptLine: (index: number, cursorPosition: number) => void;
    scriptAnalysis: any;
    totalEstimatedTime: number;
    isLoading: boolean;
    loadingStatus: string;
    error: string | null;
}

const ScriptEditor: React.FC<ScriptEditorProps> = ({
    scriptLines, onScriptChange, onUpdateScriptLine, onRemoveScriptLine, onAddScriptLine,
    onRemoveEmptyScriptLines, onAutoFormatScript, onMergeScriptLine, onSplitScriptLine,
    scriptAnalysis, totalEstimatedTime, isLoading, loadingStatus, error
}) => {
    const [isAutoFormatOpen, setIsAutoFormatOpen] = useState(false);
    const [autoFormatOptions, setAutoFormatOptions] = useState<AutoFormatOptions>({
        period: true,
        question: true,
        exclamation: true,
        comma: false
    });

    const fullScript = scriptLines.map(l => l.text).join('\n');

    const handleAutoFormatApply = () => {
        onAutoFormatScript(autoFormatOptions);
        setIsAutoFormatOpen(false);
    };

    return (
        <div className="bg-white/5 backdrop-blur-xl rounded-lg shadow-lg flex flex-col h-full border border-white/10 overflow-hidden">
             <div className="p-3 border-b border-white/10 bg-white/5 flex-shrink-0">
                <textarea
                    value={fullScript}
                    onChange={(e) => onScriptChange(e.target.value)}
                    placeholder="여기에 스크립트를 입력하세요. (엔터로 줄바꿈 시 분할됩니다)"
                    className="w-full h-24 bg-black/20 border border-white/10 rounded-md p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y text-sm leading-relaxed custom-scrollbar"
                />
            </div>
            <div className="p-3 bg-white/5 border-b border-white/10 flex justify-between items-center flex-shrink-0">
                <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-200 flex items-center gap-2 text-sm">
                        <PencilIcon className="w-4 h-4" /> 상세 편집
                    </h3>
                </div>
                <div className="flex items-center gap-2 relative">
                    <button 
                        onClick={() => setIsAutoFormatOpen(!isAutoFormatOpen)}
                        className="px-3 py-1.5 text-xs font-semibold text-gray-300 hover:text-white bg-white/10 hover:bg-white/15 rounded-md transition-colors flex items-center gap-1.5"
                        title="자동 줄바꿈 설정"
                    >
                        <WrapTextIcon className="w-3.5 h-3.5" />
                        자동 줄바꿈 설정
                    </button>
                    {isAutoFormatOpen && (
                        <div className="absolute top-full right-0 mt-2 w-48 bg-gray-900/90 backdrop-blur-2xl border border-white/10 rounded-lg shadow-xl z-20 p-3">
                            <h4 className="text-sm font-semibold text-gray-300 mb-2">자동 줄바꿈 기준</h4>
                            <div className="space-y-2">
                                <label className="flex items-center space-x-2 text-sm text-gray-400 hover:text-gray-200 cursor-pointer">
                                    <input type="checkbox" checked={autoFormatOptions.period} onChange={e => setAutoFormatOptions(prev => ({...prev, period: e.target.checked}))} className="rounded bg-gray-700 border-gray-600 text-indigo-500" />
                                    <span>마침표 (.)</span>
                                </label>
                                <label className="flex items-center space-x-2 text-sm text-gray-400 hover:text-gray-200 cursor-pointer">
                                    <input type="checkbox" checked={autoFormatOptions.question} onChange={e => setAutoFormatOptions(prev => ({...prev, question: e.target.checked}))} className="rounded bg-gray-700 border-gray-600 text-indigo-500" />
                                    <span>물음표 (?)</span>
                                </label>
                                <label className="flex items-center space-x-2 text-sm text-gray-400 hover:text-gray-200 cursor-pointer">
                                    <input type="checkbox" checked={autoFormatOptions.exclamation} onChange={e => setAutoFormatOptions(prev => ({...prev, exclamation: e.target.checked}))} className="rounded bg-gray-700 border-gray-600 text-indigo-500" />
                                    <span>느낌표 (!)</span>
                                </label>
                                <label className="flex items-center space-x-2 text-sm text-gray-400 hover:text-gray-200 cursor-pointer">
                                    <input type="checkbox" checked={autoFormatOptions.comma} onChange={e => setAutoFormatOptions(prev => ({...prev, comma: e.target.checked}))} className="rounded bg-gray-700 border-gray-600 text-indigo-500" />
                                    <span>쉼표 (,)</span>
                                </label>
                            </div>
                            <button onClick={handleAutoFormatApply} className="mt-3 w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded">적용하기</button>
                        </div>
                    )}
                    <button 
                        onClick={onRemoveEmptyScriptLines}
                        className="p-1.5 text-gray-400 hover:text-white bg-white/10 hover:bg-white/15 rounded-md transition-colors"
                        title="빈 줄 제거"
                    >
                        <MinusIcon className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onAddScriptLine}
                        className="p-1.5 text-gray-400 hover:text-white bg-white/10 hover:bg-white/15 rounded-md transition-colors"
                        title="줄 추가"
                    >
                        <PlusIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
            
            <div className="flex-grow overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {scriptLines.map((line, index) => (
                    <div key={line.id} className="group flex items-start gap-2 bg-white/5 hover:bg-white/10 p-2 rounded-md transition-colors border border-transparent hover:border-white/10">
                        <div className="flex flex-col gap-1 mt-1">
                            <span className="text-xs text-gray-500 w-6 text-center">{index + 1}</span>
                            <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => onMergeScriptLine(index, 'up')} disabled={index === 0} className="p-0.5 text-gray-500 hover:text-indigo-400 disabled:opacity-0" title="윗줄과 합치기">
                                    <ArrowUpIcon className="w-3 h-3" />
                                </button>
                                <button onClick={() => onMergeScriptLine(index, 'down')} disabled={index === scriptLines.length - 1} className="p-0.5 text-gray-500 hover:text-indigo-400 disabled:opacity-0" title="아랫줄과 합치기">
                                    <ArrowDownIcon className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                        <div className="flex-grow">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="relative group/style">
                                     <select 
                                        value={line.style || ''} 
                                        onChange={(e) => onUpdateScriptLine(line.id, { style: e.target.value })}
                                        className="appearance-none bg-white/5 text-xs text-gray-300 border border-white/10 rounded px-2 py-0.5 pr-6 focus:outline-none focus:border-indigo-500 cursor-pointer hover:bg-white/10"
                                    >
                                        {DIALOGUE_STYLES.map(style => (
                                            <option key={style.value} value={style.value}>{style.label}</option>
                                        ))}
                                    </select>
                                    <StyleIcon className="w-3 h-3 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                                <span className="text-xs text-gray-500">{(line.estimatedTime || 0).toFixed(1)}초</span>
                            </div>
                            <textarea
                                ref={(el) => {
                                    if (el) {
                                        el.style.height = 'auto';
                                        el.style.height = el.scrollHeight + 'px';
                                    }
                                }}
                                value={line.text}
                                onChange={(e) => {
                                    onUpdateScriptLine(line.id, { text: e.target.value });
                                    e.target.style.height = 'auto';
                                    e.target.style.height = e.target.scrollHeight + 'px';
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        onSplitScriptLine(index, e.currentTarget.selectionStart);
                                    } else if (e.key === 'Backspace' && line.text === '' && scriptLines.length > 1) {
                                        e.preventDefault();
                                        onRemoveScriptLine(line.id);
                                    }
                                }}
                                placeholder="내용을 입력하세요..."
                                className="w-full bg-transparent text-gray-200 text-sm focus:outline-none resize-none leading-relaxed overflow-hidden"
                                rows={1}
                            />
                        </div>
                        <button 
                            onClick={() => onRemoveScriptLine(line.id)}
                            className="p-1 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Footer moved inside the box */}
            <div className="flex-shrink-0 flex items-center justify-between p-3 bg-white/5 border-t border-white/10 text-xs">
                <p className="text-gray-400">
                    글자 수: <span className={`font-medium ${scriptAnalysis.charCount > MAX_CHAR_LIMIT ? 'text-red-500' : 'text-gray-300'}`}>{scriptAnalysis.charCount.toLocaleString()}</span> / {MAX_CHAR_LIMIT.toLocaleString()}
                    <span className="mx-2">|</span>
                    예상 시간: <span className="font-medium text-gray-300">{(totalEstimatedTime / 60).toFixed(0)}분 {Math.round(totalEstimatedTime % 60)}초</span>
                </p>
                    {isLoading && loadingStatus && (
                    <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-xs text-indigo-400 animate-pulse">{loadingStatus}</p>
                    </div>
                )}
                {error && <span className="text-xs text-red-400 ml-2 truncate max-w-[150px]" title={error}>{error}</span>}
            </div>
        </div>
    );
};

export const MainContent: React.FC<MainContentProps> = ({
    singleSpeakerVoice, setSingleSpeakerVoice, voices, onPreviewVoice, isPreviewLoading,
    srtSplitCharCount, setSrtSplitCharCount,
    isLoading,
    loadingStatus,
    error, 
    audioHistory,
    srtContent,
    activeSrtLineId,
    setActiveSrtLineId,
    onGenerateAudio,
    onStopGeneration,
    onClearAudioHistory,
    onTrimAudio,
    onActiveAudioChange,
    scriptLines,
    onScriptChange,
    onUpdateScriptLine, 
    onRemoveScriptLine,
    onAddScriptLine,
    onRemoveEmptyScriptLines,
    onAutoFormatScript,
    onMergeScriptLine,
    onSplitScriptLine,
    onRegenerateSrt, 
    onDetectSilence, 
    silentSegments, 
    onRemoveSilenceSegments,
    scriptAnalysis,
    totalEstimatedTime,
    editableSrtLines,
    originalSrtLines,
    onUpdateSrtLine,
    onRemoveSrtLine,
    onSplitSrtLine,
    onResetSrt,
    onBulkTimeShift,
    onReconstructAudio,
    hasTimestampEdits,
    isTimestampSyncEnabled,
    setIsTimestampSyncEnabled,
    isAnalysisPanelOpen,
    setIsAnalysisPanelOpen,
}) => {
    const [srtMode, setSrtMode] = useState<'chapter' | 'edit'>('chapter');
    const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    
    const srtTableBodyRef = useRef<HTMLTableSectionElement>(null);
    const activeRowRef = useRef<HTMLTableRowElement>(null);
    const audioPlayerRef = useRef<AudioPlayerHandle>(null);

    // Local state for split count to avoid re-renders on every keystroke
    const [localSplitCount, setLocalSplitCount] = useState<string>(srtSplitCharCount.toString());

    useEffect(() => {
        setLocalSplitCount(srtSplitCharCount.toString());
    }, [srtSplitCharCount]);
    
    // Reset page to 1 (latest) when new audio is generated
    useEffect(() => {
        if (audioHistory.length > 0) {
            setCurrentPage(1);
        }
    }, [audioHistory.length]);

    // Calculate current audio item and sync active audio state
    const currentAudioItem = audioHistory.length > 0 ? audioHistory[currentPage - 1] : null;
    const totalPages = audioHistory.length;
    
    useEffect(() => {
        if (currentAudioItem) {
            onActiveAudioChange(currentAudioItem.id);
        }
    }, [currentAudioItem?.id]); // Only trigger when ID changes

    const handleSplitCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalSplitCount(e.target.value);
    };

    const handleSplitCountBlur = () => {
        let val = parseInt(localSplitCount, 10);
        if (isNaN(val) || val < 10) {
            val = 10;
        }
        setSrtSplitCharCount(val);
        setLocalSplitCount(val.toString());
    };

    const handleSplitCountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
    };

    // Spacebar Key Listener for Play/Pause
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                const target = e.target as HTMLElement;
                const tagName = target.tagName;
                const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable;
                
                // Only toggle play if focus is NOT on an input/textarea
                if (!isInput) {
                    e.preventDefault(); // Prevent scrolling
                    audioPlayerRef.current?.togglePlay();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        if (isAutoScrollEnabled && activeRowRef.current && srtTableBodyRef.current) {
            const container = srtTableBodyRef.current.parentElement;
            if (container) {
                const rowTop = activeRowRef.current.offsetTop;
                const rowHeight = activeRowRef.current.offsetHeight;
                const containerTop = container.scrollTop;
                const containerHeight = container.clientHeight;

                if (rowTop < containerTop || rowTop + rowHeight > containerTop + containerHeight) {
                    container.scrollTo({ top: rowTop - containerHeight / 2 + rowHeight / 2, behavior: 'smooth' });
                }
            }
        }
    }, [activeSrtLineId, isAutoScrollEnabled]);

    const handleSrtLineClick = (line: SrtLine) => {
        const startTimeSec = srtTimeToMs(line.startTime) / 1000;
        audioPlayerRef.current?.seekTo(startTimeSec);
        
        // Manually set active line on click so it highlights even if auto-scroll (tracking) is off
        setActiveSrtLineId(line.id);

        audioPlayerRef.current?.pause();
    };
    
    // Only allow AudioPlayer to update the active line if auto-scroll (tracking) is enabled
    const handlePlayerActiveLineUpdate = useCallback((id: string | null) => {
        if (isAutoScrollEnabled) {
            setActiveSrtLineId(id);
        }
    }, [isAutoScrollEnabled, setActiveSrtLineId]);

    const handleCopySrt = () => {
        if (srtContent) {
            navigator.clipboard.writeText(srtContent).catch(err => console.error('Failed to copy SRT: ', err));
        }
    };

    const handleDownloadSrt = () => {
        if (srtContent) {
            const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `subtitles-${new Date().getTime()}.srt`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    };

    const handleTimeShiftApply = (shiftMs: number) => {
        onBulkTimeShift(shiftMs);
    };

    const handleTimeDragStart = (e: React.MouseEvent<HTMLInputElement>, lineId: string, field: 'startTime' | 'endTime') => {
        e.preventDefault();
        const initialX = e.clientX;
        const initialTimeMs = srtTimeToMs(e.currentTarget.value);

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - initialX;
            const sensitivity = 10; // 1px = 10ms
            const deltaTimeMs = Math.round(deltaX * sensitivity / 10) * 10;
            const newTimeMs = Math.max(0, initialTimeMs + deltaTimeMs);
            const newTimeStr = msToSrtTime(newTimeMs);
            onUpdateSrtLine(lineId, { [field]: newTimeStr });
        };

        const handleMouseUp = () => {
            document.body.style.cursor = 'default';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        document.body.style.cursor = 'ew-resize';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleIndividualTimeShift = (lineId: string, shiftMs: number) => {
        const line = editableSrtLines.find(l => l.id === lineId);
        if (!line) return;

        let startMs = srtTimeToMs(line.startTime) + shiftMs;
        let endMs = srtTimeToMs(line.endTime) + shiftMs;

        startMs = Math.max(0, startMs);
        endMs = Math.max(0, endMs);
        
        if (endMs < startMs) {
            endMs = startMs;
        }
        
        onUpdateSrtLine(lineId, {
            startTime: msToSrtTime(startMs),
            endTime: msToSrtTime(endMs),
        });
    };
    
    // Calculate height for responsiveness (viewport height - header/padding approx)
    // Adjust this value if header size changes
    const contentHeightStyle = { height: 'calc(100vh - 220px)' };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start" style={contentHeightStyle}>
            <div className="h-full lg:col-span-12">
                {/* 2-Column Layout for Input and Results */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-full">
                    {/* LEFT COLUMN: Voice Settings + Script Editor */}
                    <div className="flex flex-col gap-4 h-full min-h-0">
                        {/* Voice Selection & Controls Block */}
                        <div className="bg-white/5 backdrop-blur-xl p-4 rounded-lg shadow border border-white/10 flex flex-col gap-4 shrink-0">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium text-gray-300">음성 선택</label>
                                <div className="flex gap-2">
                                    <select
                                        value={singleSpeakerVoice}
                                        onChange={(e) => setSingleSpeakerVoice(e.target.value)}
                                        className={`flex-grow bg-white/5 border border-white/10 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm ${singleSpeakerVoice ? 'text-white' : 'text-gray-400'}`}
                                    >
                                        <option value="" disabled>음성을 선택하세요</option>
                                        {voices.map(voice => (
                                            <option key={voice.id} value={voice.id}>
                                                {voice.name} ({voice.gender === 'male' ? '남' : '여'}) - {voice.description}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={() => onPreviewVoice(singleSpeakerVoice)}
                                        disabled={!singleSpeakerVoice || isPreviewLoading[singleSpeakerVoice]}
                                        className="p-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-500 disabled:cursor-not-allowed flex-shrink-0"
                                        aria-label={`음성 미리듣기`}
                                    >
                                        {isPreviewLoading[singleSpeakerVoice] ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <PlayIcon className="w-5 h-5"/>}
                                    </button>
                                </div>
                            </div>
                            
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">자막 분할:</span>
                                    <input
                                        type="number"
                                        value={localSplitCount}
                                        min="10"
                                        max="100"
                                        onChange={handleSplitCountChange}
                                        onBlur={handleSplitCountBlur}
                                        onKeyDown={handleSplitCountKeyDown}
                                        className="w-14 text-center bg-white/5 border border-white/10 rounded-md py-1 px-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-xs text-white"
                                        title="자막 최대 글자 수"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    {isLoading ? (
                                        <button onClick={onStopGeneration} className="flex items-center justify-center gap-2 bg-red-600 text-white text-xs font-semibold py-2 px-3 rounded-md hover:bg-red-700 transition-colors">
                                            <StopIcon className="w-4 h-4" />
                                            <span>중지</span>
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={onGenerateAudio}
                                            disabled={!singleSpeakerVoice || scriptLines.every(l => !l.text.trim())}
                                            className="flex items-center justify-center gap-2 bg-indigo-600 text-white text-xs font-bold py-2 px-3 rounded-md hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <SparklesIcon className="w-4 h-4" />
                                            <span>생성</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Script Editor expands to fill space */}
                        <div className="flex-grow min-h-0">
                            <ScriptEditor 
                                scriptLines={scriptLines} 
                                onScriptChange={onScriptChange}
                                onUpdateScriptLine={onUpdateScriptLine}
                                onRemoveScriptLine={onRemoveScriptLine}
                                onAddScriptLine={onAddScriptLine}
                                onRemoveEmptyScriptLines={onRemoveEmptyScriptLines}
                                onAutoFormatScript={onAutoFormatScript}
                                onMergeScriptLine={onMergeScriptLine}
                                onSplitScriptLine={onSplitScriptLine}
                                scriptAnalysis={scriptAnalysis}
                                totalEstimatedTime={totalEstimatedTime}
                                isLoading={isLoading}
                                loadingStatus={loadingStatus}
                                error={error}
                            />
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Results Area */}
                    <div className="flex flex-col gap-6 min-w-0 h-full">
                         {/* Pagination Controls */}
                         {audioHistory.length > 1 && (
                            <div className="flex justify-center items-center gap-4 bg-white/5 backdrop-blur-xl p-2 rounded-lg border border-white/10">
                                <button 
                                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                    disabled={currentPage === 1}
                                    className="p-1 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                                    title="이전 (1번 방향)"
                                >
                                    <ChevronLeftIcon className="w-5 h-5 text-gray-300" />
                                </button>
                                <span className="text-sm font-semibold text-gray-300">
                                    {currentPage} / {totalPages}
                                </span>
                                <button 
                                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                                    disabled={currentPage === totalPages}
                                    className="p-1 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                                    title="다음 (2,3...번 방향)"
                                >
                                    <ChevronRightIcon className="w-5 h-5 text-gray-300" />
                                </button>
                            </div>
                        )}

                        {/* Display Current Audio Item */}
                        {currentAudioItem && (
                            <div key={currentAudioItem.id} className="flex-shrink-0">
                                <AudioPlayer
                                    ref={audioPlayerRef}
                                    item={currentAudioItem}
                                    index={totalPages - currentPage} // Show 0-based index or reversed logical index
                                    isLoading={isLoading}
                                    onTrim={() => onTrimAudio(currentAudioItem.id)}
                                    onRegenerateSrt={() => onRegenerateSrt(currentAudioItem.id)}
                                    onDetectSilence={() => onDetectSilence(currentAudioItem.id)}
                                    srtLines={editableSrtLines}
                                    activeSrtLineId={activeSrtLineId}
                                    setActiveSrtLineId={handlePlayerActiveLineUpdate}
                                />
                                {silentSegments.length > 0 && <SilenceRemover segments={silentSegments} onRemove={onRemoveSilenceSegments} />}
                            </div>
                        )}

                        {(isLoading && loadingStatus.includes('자막')) ? (
                            <div className="flex-grow bg-white/5 backdrop-blur-xl rounded-lg shadow-inner flex flex-col items-center justify-center border border-white/10">
                                <div className="relative w-20 h-20 mb-6">
                                    <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-500/30 rounded-full"></div>
                                    <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                                        <SparklesIcon className="w-8 h-8 text-indigo-400 animate-pulse" />
                                    </div>
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2 animate-pulse">{loadingStatus}</h3>
                                <p className="text-gray-400 text-sm max-w-md text-center leading-relaxed">
                                    AI가 오디오 파형을 분석하여 타임코드를 생성하고 있습니다.<br/>
                                    잠시만 기다려주세요...
                                </p>
                                <div className="flex gap-2 mt-6">
                                    <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce"></div>
                                </div>
                            </div>
                        ) : srtContent && (
                            <div className="flex-grow bg-white/5 backdrop-blur-xl rounded-lg shadow-inner flex flex-col min-h-0 border border-white/10">
                                <div className="flex-shrink-0 flex justify-between items-center p-3 border-b border-white/10">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setSrtMode('chapter')} className={`px-4 py-1.5 text-sm font-semibold rounded-md flex items-center gap-2 ${srtMode === 'chapter' ? 'bg-indigo-600 text-white' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}>
                                            <ListBulletIcon className="w-5 h-5" /> 챕터
                                        </button>
                                        <button onClick={() => setSrtMode('edit')} className={`px-4 py-1.5 text-sm font-semibold rounded-md flex items-center gap-2 ${srtMode === 'edit' ? 'bg-indigo-600 text-white' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}>
                                            <PencilIcon className="w-5 h-5" /> 수정
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <label className="flex items-center text-sm text-gray-300 cursor-pointer">
                                            <input type="checkbox" checked={isAutoScrollEnabled} onChange={(e) => setIsAutoScrollEnabled(e.target.checked)} className="mr-2 bg-gray-700 border-gray-600 rounded text-indigo-500 focus:ring-indigo-600"/>
                                            자동 스크롤
                                        </label>
                                        <button onClick={handleCopySrt} title="SRT 복사" className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-md"><ClipboardIcon className="w-5 h-5" /></button>
                                        <button onClick={handleDownloadSrt} title="SRT 다운로드" className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-md"><DownloadIcon className="w-5 h-5" /></button>
                                    </div>
                                </div>

                                {srtMode === 'edit' && (
                                    <div className="flex-shrink-0 p-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm text-gray-300">타임코드 동기화:</p>
                                            <button onClick={() => setIsTimestampSyncEnabled(!isTimestampSyncEnabled)} className={`px-3 py-1 text-xs font-semibold rounded-full flex items-center gap-1.5 ${isTimestampSyncEnabled ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'}`}>
                                                <LinkIcon className="w-3 h-3" /> {isTimestampSyncEnabled ? '활성' : '비활성'}
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleTimeShiftApply(-100)} className="px-2 py-1 text-xs bg-white/10 rounded-md hover:bg-white/15">-100ms</button>
                                            <button onClick={() => handleTimeShiftApply(100)} className="px-2 py-1 text-xs bg-white/10 rounded-md hover:bg-white/15">+100ms</button>
                                            <button onClick={onResetSrt} disabled={!hasTimestampEdits && JSON.stringify(editableSrtLines) === JSON.stringify(originalSrtLines)} className="text-sm flex items-center gap-1.5 text-yellow-400 hover:text-yellow-300 disabled:text-gray-500 disabled:cursor-not-allowed">
                                                <RefreshIcon className="w-4 h-4" /> 되돌리기
                                            </button>
                                            <button onClick={onReconstructAudio} disabled={hasTimestampEdits || JSON.stringify(editableSrtLines) === JSON.stringify(originalSrtLines)} className="text-sm flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 disabled:text-gray-500 disabled:cursor-not-allowed">
                                                <ScissorsIcon className="w-4 h-4" /> 오디오 재구성
                                            </button>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Flexible height container */}
                                <div className="flex-grow overflow-y-auto border-t border-white/10 custom-scrollbar">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-white/5 text-xs text-gray-400 uppercase sticky top-0 z-10">
                                        <tr>
                                            <th className="py-2 px-4 w-12">#</th>
                                            {srtMode === 'edit' && <th className="py-2 px-2 w-28 text-center">시간 조정</th>}
                                            <th className="py-2 px-4 w-32">시작 <span className="font-mono text-gray-500">(hh:mm:ss,ms)</span></th>
                                            <th className="py-2 px-4 w-32">종료 <span className="font-mono text-gray-500">(hh:mm:ss,ms)</span></th>
                                            <th className="py-2 px-4">내용</th>
                                            {srtMode === 'edit' && <th className="py-2 px-4 w-12"></th>}
                                        </tr>
                                    </thead>
                                    <tbody ref={srtTableBodyRef}>
                                        {editableSrtLines.map((line, index) => (
                                            <tr 
                                                key={line.id} 
                                                ref={line.id === activeSrtLineId ? activeRowRef : null}
                                                onClick={() => handleSrtLineClick(line)}
                                                className={`border-b border-white/5 transition-colors ${line.id === activeSrtLineId ? 'bg-indigo-900/40' : 'hover:bg-white/5'} ${srtMode === 'chapter' ? 'cursor-pointer' : ''}`}
                                            >
                                                <td className="px-4 py-2 text-gray-400 align-top">{index + 1}</td>
                                                {srtMode === 'edit' && (
                                                    <td className="px-2 py-2 font-mono align-top text-center">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button onClick={(e) => { e.stopPropagation(); handleIndividualTimeShift(line.id, -100); }} className="px-1.5 py-1 text-xs bg-white/10 rounded-md hover:bg-white/15" title="-100ms">-100ms</button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleIndividualTimeShift(line.id, 100); }} className="px-1.5 py-1 text-xs bg-white/10 rounded-md hover:bg-white/15" title="+100ms">+100ms</button>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="px-4 py-2 font-mono align-top">
                                                    {srtMode === 'edit' ? (
                                                        <input 
                                                            type="text" 
                                                            value={line.startTime} 
                                                            onChange={(e) => onUpdateSrtLine(line.id, { startTime: e.target.value })}
                                                            onMouseDown={(e) => handleTimeDragStart(e, line.id, 'startTime')}
                                                            className="w-full bg-white/10 p-1 rounded-md border border-transparent focus:border-indigo-500 focus:bg-black/20 outline-none cursor-ew-resize"
                                                        />
                                                    ) : ( <div>{line.startTime}</div> )}
                                                </td>
                                                <td className="px-4 py-2 font-mono align-top">
                                                    {srtMode === 'edit' ? (
                                                        <input
                                                            type="text"
                                                            value={line.endTime}
                                                            onChange={(e) => onUpdateSrtLine(line.id, { endTime: e.target.value })}
                                                            onMouseDown={(e) => handleTimeDragStart(e, line.id, 'endTime')}
                                                            className="w-full bg-white/10 p-1 rounded-md border border-transparent focus:border-indigo-500 focus:bg-black/20 outline-none cursor-ew-resize"
                                                        />
                                                    ) : ( <div>{line.endTime}</div> )}
                                                </td>
                                                <td className="px-4 py-2 align-top leading-relaxed">
                                                    {srtMode === 'edit' ? (
                                                        <textarea
                                                            value={line.text}
                                                            onChange={(e) => onUpdateSrtLine(line.id, { text: e.target.value })}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                                    e.preventDefault();
                                                                    onSplitSrtLine(index, e.currentTarget.selectionStart);
                                                                }
                                                            }}
                                                            className="w-full bg-white/10 p-1 rounded-md border border-transparent focus:border-indigo-500 focus:bg-black/20 outline-none resize-none"
                                                            rows={line.text.split('\n').length || 1}
                                                        />
                                                    ) : ( <div className="whitespace-pre-wrap">{line.text}</div> )}
                                                </td>
                                                {srtMode === 'edit' && (
                                                    <td className="px-4 py-2 text-center align-top">
                                                        <button onClick={(e) => { e.stopPropagation(); onRemoveSrtLine(line.id); }} className="text-gray-500 hover:text-red-500">
                                                            <TrashIcon className="w-5 h-5"/>
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
};