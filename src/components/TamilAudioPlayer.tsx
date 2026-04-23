'use client';

import { useState, useRef, useEffect } from 'react';
import { SpeakerWaveIcon, PauseIcon, PlayIcon } from '@heroicons/react/24/solid';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

interface TamilAudioPlayerProps {
  text: string;
  title?: string;
  voice?: 'female' | 'male';
  autoGenerate?: boolean;
}

export function TamilAudioPlayer({ text, title, voice = 'female', autoGenerate = false }: TamilAudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Generate audio on mount if autoGenerate is true
  useEffect(() => {
    if (autoGenerate && !audioUrl) {
      generateAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate]);

  const generateAudio = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate audio');
      }

      const audioDuration = response.headers.get('X-Audio-Duration');
      if (audioDuration) {
        setDuration(parseInt(audioDuration));
      }

      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);

      // Cleanup old URL
      return () => {
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
        }
      };
    } catch (err) {
      console.error('Error generating audio:', err);
      setError('ஒலி உருவாக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.');
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const progress = (audioRef.current.currentTime / audioRef.current.duration) * 100;
    setProgress(progress || 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const newTime = (parseFloat(e.target.value) / 100) * audioRef.current.duration;
    audioRef.current.currentTime = newTime;
    setProgress(parseFloat(e.target.value));
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-6 border-2 border-purple-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-purple-600 rounded-full">
          <SpeakerWaveIcon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 font-tamil">
            {title || 'கவிதையைக் கேளுங்கள்'}
          </h3>
          <p className="text-sm text-gray-600 font-tamil">
            Google Tamil குரல்
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm font-tamil">
          {error}
        </div>
      )}

      {/* Audio Player or Generate Button */}
      {!audioUrl ? (
        <button
          onClick={generateAudio}
          disabled={isLoading}
          className="w-full py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors font-tamil flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <ArrowPathIcon className="w-5 h-5 animate-spin" />
              ஒலி உருவாக்கப்படுகிறது...
            </>
          ) : (
            <>
              <PlayIcon className="w-5 h-5" />
              கவிதையை கேட்க உருவாக்கு
            </>
          )}
        </button>
      ) : (
        <div className="space-y-4">
          {/* Audio Element */}
          <audio
            ref={audioRef}
            src={audioUrl}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />

          {/* Play/Pause Button */}
          <div className="flex items-center gap-4">
            <button
              onClick={togglePlay}
              className="p-3 bg-purple-600 text-white rounded-full hover:bg-purple-700 transition-colors"
            >
              {isPlaying ? (
                <PauseIcon className="w-6 h-6" />
              ) : (
                <PlayIcon className="w-6 h-6" />
              )}
            </button>

            {/* Progress Bar */}
            <div className="flex-1">
              <input
                type="range"
                min="0"
                max="100"
                value={progress}
                onChange={handleSeek}
                className="w-full h-2 bg-purple-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                style={{
                  background: `linear-gradient(to right, #9333ea ${progress}%, #e9d5ff ${progress}%)`,
                }}
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1 font-tamil">
                <span>{audioRef.current ? formatTime(audioRef.current.currentTime) : '0:00'}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>

          {/* Regenerate Button */}
          <button
            onClick={generateAudio}
            disabled={isLoading}
            className="text-sm text-purple-600 hover:text-purple-800 font-tamil flex items-center gap-1"
          >
            <ArrowPathIcon className="w-4 h-4" />
            மீண்டும் உருவாக்கு
          </button>
        </div>
      )}

      {/* Voice Info */}
      <div className="mt-4 pt-4 border-t border-purple-200">
        <p className="text-xs text-gray-600 font-tamil">
          🎙️ குரல்: {voice === 'female' ? 'பெண் குரல்' : 'ஆண் குரல்'} •
          ⚡ Powered by Google Cloud TTS
        </p>
      </div>
    </div>
  );
}
