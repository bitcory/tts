import React, { useMemo, useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { DownloadIcon, ScissorsIcon, PlayIcon, PauseIcon, RefreshIcon, PlusIcon, MinusIcon } from '../constants';
import { AudioHistoryItem } from '../App';
import { SrtLine } from '../types';
import { parseSrt, srtTimeToMs } from './Header';
import { Waveform } from './Waveform';

interface AudioPlayerProps {
    item: AudioHistoryItem;
    index: number;
    isLoading: boolean;
    onTrim: () => void;
    onRegenerateSrt: () => void;
    onDetectSilence: () => void;
    srtLines: SrtLine[];
    activeSrtLineId: string | null;
    setActiveSrtLineId: (id: string | null) => void;
}

export interface AudioPlayerHandle {
  seekTo: (time: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
}

const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) {
        return '00:00:00,000';
    }
    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const milliseconds = Math.floor((timeInSeconds * 1000) % 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
};

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(({ 
    item, index, isLoading, onTrim, onRegenerateSrt,
    srtLines, activeSrtLineId, setActiveSrtLineId
}, ref) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [playbackRate, setPlaybackRate] = useState(1);
    
    const srtLinesWithSeconds = useMemo(() => {
        return srtLines.map(line => ({
            ...line,
            startTimeSec: srtTimeToMs(line.startTime) / 1000,
            endTimeSec: srtTimeToMs(line.endTime) / 1000,
        }));
    }, [srtLines]);

    const safePlay = (audio: HTMLAudioElement) => {
        if (audio.readyState >= 2) {
            audio.play().catch(e => console.error("Audio play failed", e));
        } else {
            audio.load();
            audio.addEventListener('canplay', () => {
                audio.play().catch(e => console.error("Audio play failed", e));
            }, { once: true });
        }
    };

    useImperativeHandle(ref, () => ({
        seekTo: (time: number) => {
            if (audioRef.current) {
                audioRef.current.currentTime = time;
                setCurrentTime(time);
            }
        },
        play: () => {
            if (audioRef.current) safePlay(audioRef.current);
        },
        pause: () => {
            if (audioRef.current) {
                audioRef.current.pause();
            }
        },
        togglePlay: () => {
            if (audioRef.current) {
                if (audioRef.current.paused) {
                    safePlay(audioRef.current);
                } else {
                    audioRef.current.pause();
                }
            }
        }
    }));

    // Force the browser to fully load the audio data on mount
    useEffect(() => {
        const audio = audioRef.current;
        if (audio) {
            audio.load();
        }
    }, [item.src]);

    // Smooth playback update using requestAnimationFrame
    useEffect(() => {
        let animationFrameId: number;

        const updateLoop = () => {
            if (audioRef.current && !audioRef.current.paused) {
                const now = audioRef.current.currentTime;
                setCurrentTime(now);
                
                const activeLine = srtLinesWithSeconds.find(
                    line => now >= line.startTimeSec && now < line.endTimeSec
                );
                setActiveSrtLineId(activeLine ? activeLine.id : null);

                animationFrameId = requestAnimationFrame(updateLoop);
            }
        };

        if (isPlaying) {
            animationFrameId = requestAnimationFrame(updateLoop);
        }

        return () => {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }, [isPlaying, srtLinesWithSeconds, setActiveSrtLineId]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const setAudioData = () => {
            setDuration(audio.duration);
            setCurrentTime(audio.currentTime);
        };

        const handleEnd = () => {
            setIsPlaying(false);
            setActiveSrtLineId(null);
            setCurrentTime(0); // Optional: Reset to start
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        
        // We still keep timeupdate as a fallback and for initial sync, 
        // but the main smooth loop is handled by the useEffect above.
        const handleTimeUpdate = () => {
            if (!isPlaying) {
                 setCurrentTime(audio.currentTime);
            }
        };

        audio.addEventListener('loadeddata', setAudioData);
        audio.addEventListener('ended', handleEnd);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('timeupdate', handleTimeUpdate);

        return () => {
            audio.removeEventListener('loadeddata', setAudioData);
            audio.removeEventListener('ended', handleEnd);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
        };
    }, [isPlaying, setActiveSrtLineId]); // Dependencies simplified as logic moved to rAF loop

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = item.src;
        link.download = `ai-보이스-스튜디오-오디오-${index + 1}-${new Date().getTime()}.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const togglePlayPause = () => {
        const audio = audioRef.current;
        if (!audio) return;

        if (isPlaying) {
            audio.pause();
        } else {
            safePlay(audio);
        }
    };

    const handleSeek = (time: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

    const handlePlaybackRateChange = (rate: number) => {
        setPlaybackRate(rate);
        if (audioRef.current) {
            audioRef.current.playbackRate = rate;
        }
    };

    return (
        <div className="bg-white/5 backdrop-blur-xl p-3 sm:p-4 rounded-lg border border-white/10 space-y-2 sm:space-y-3">
            <div className="flex justify-between items-center gap-2">
                <h3 className="text-sm sm:text-lg font-bold text-white whitespace-nowrap shrink-0">
                    클립 #{index + 1}
                </h3>
                <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                        onClick={onRegenerateSrt}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 bg-yellow-600 text-white font-semibold py-1.5 px-2 sm:py-2 sm:px-3 rounded-md hover:bg-yellow-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors text-xs sm:text-sm"
                        title="자막 재생성"
                    >
                        <RefreshIcon className="w-4 h-4 shrink-0" />
                        <span className="hidden sm:inline">자막 재생성</span>
                    </button>
                    {item.contextDuration > 0 && !item.isTrimmed && (
                        <button onClick={onTrim} className="flex items-center gap-1.5 bg-cyan-600 text-white font-semibold py-1.5 px-2 sm:py-2 sm:px-3 rounded-md hover:bg-cyan-700 transition-colors text-xs sm:text-sm">
                            <ScissorsIcon className="w-4 h-4 shrink-0" />
                            <span className="hidden sm:inline">앞부분 잘라내기</span>
                        </button>
                    )}
                    <button onClick={handleDownload} className="flex items-center gap-1.5 bg-green-600 text-white font-semibold py-1.5 px-2 sm:py-2 sm:px-3 rounded-md hover:bg-green-700 transition-colors text-xs sm:text-sm">
                        <DownloadIcon className="w-4 h-4 shrink-0" />
                        <span className="hidden sm:inline">다운로드</span>
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
                <button onClick={togglePlayPause} className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 shrink-0">
                    {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
                </button>
                <div className="hidden sm:block w-28 text-center font-mono text-sm text-gray-300 shrink-0">
                    {formatTime(currentTime)} / {formatTime(duration)}
                </div>
                <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    step="0.01"
                    value={currentTime}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    className="w-full min-w-0 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                    <button onClick={() => setZoom(z => Math.max(1, z / 1.5))} className="p-1.5 bg-white/10 rounded-md hover:bg-white/15" aria-label="파형 축소"><MinusIcon className="w-4 h-4" /></button>
                    <button onClick={() => setZoom(z => Math.min(100, z * 1.5))} className="p-1.5 bg-white/10 rounded-md hover:bg-white/15" aria-label="파형 확대"><PlusIcon className="w-4 h-4" /></button>
                </div>
                <audio ref={audioRef} src={item.src} preload="auto"></audio>
            </div>

            <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 shrink-0">속도:</span>
                <div className="flex items-center gap-1">
                    {PLAYBACK_RATES.map(rate => (
                        <button
                            key={rate}
                            onClick={() => handlePlaybackRateChange(rate)}
                            className={`px-2 py-1 text-xs rounded-md transition-colors ${
                                playbackRate === rate
                                    ? 'bg-indigo-600 text-white font-semibold'
                                    : 'bg-white/10 text-gray-300 hover:bg-white/15'
                            }`}
                        >
                            {rate}x
                        </button>
                    ))}
                </div>
            </div>

            {item.audioBuffer && (
                 <Waveform
                    audioBuffer={item.audioBuffer}
                    currentTime={currentTime}
                    duration={duration}
                    onSeek={handleSeek}
                    srtLines={srtLines}
                    activeSrtLineId={activeSrtLineId}
                    zoom={zoom}
                    onZoomChange={setZoom}
                 />
            )}
        </div>
    );
});