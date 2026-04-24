'use client';

import { useState, useEffect, useRef } from 'react';
import { BookmarkIcon, PrinterIcon, SpeakerWaveIcon, ClipboardDocumentIcon, ShareIcon, MusicalNoteIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon, MusicalNoteIcon as MusicalNoteSolidIcon } from '@heroicons/react/24/solid';
import { getAllMusicSources, getMusicDescription } from '@/utils/musicLibrary';

interface PoemReaderProps {
  content: any; // Accept any content object from the database
}

type ReadingMode = 'light' | 'dark' | 'sepia';

interface PoemAnalysis {
  emotion: string;
  mood: string;
  themes: string[];
  musicRecommendation: string;
  ttsSpeed: number;
  ttsPitch: number;
  summary: string;
}

export function PoemReader({ content }: PoemReaderProps) {
  const [readingMode, setReadingMode] = useState<ReadingMode>('light');
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [volume, setVolume] = useState(0.3);
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const [poemAnalysis, setPoemAnalysis] = useState<PoemAnalysis | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Analyze poem on mount
  useEffect(() => {
    const analyzePoemContext = async () => {
      try {
        const response = await fetch('/api/ai/analyze-poem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: content.title,
            body: content.body,
            author: content.author,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          setPoemAnalysis(data.analysis);
        }
      } catch (error) {
        console.error('Failed to analyze poem:', error);
        // Use default sad/reflective analysis
        setPoemAnalysis({
          emotion: 'sad',
          mood: 'somber',
          themes: ['இழப்பு', 'நினைவுகள்'],
          musicRecommendation: 'sad_piano',
          ttsSpeed: 0.85,
          ttsPitch: -1.0,
          summary: 'உணர்ச்சிபூர்வமான கவிதை',
        });
      }
    };

    analyzePoemContext();
  }, [content.id, content.title, content.body, content.author]);

  // Check if already bookmarked
  useEffect(() => {
    const bookmarks = JSON.parse(localStorage.getItem('poem-bookmarks') || '[]');
    setIsBookmarked(bookmarks.includes(content.id));
  }, [content.id]);

  // Load reading mode preference
  useEffect(() => {
    const savedMode = localStorage.getItem('reading-mode') as ReadingMode;
    if (savedMode) {
      setReadingMode(savedMode);
    }
  }, []);

  const handleReadingModeChange = (mode: ReadingMode) => {
    setReadingMode(mode);
    localStorage.setItem('reading-mode', mode);
  };

  const handleBookmark = () => {
    const bookmarks = JSON.parse(localStorage.getItem('poem-bookmarks') || '[]');
    if (isBookmarked) {
      const updated = bookmarks.filter((id: string) => id !== content.id);
      localStorage.setItem('poem-bookmarks', JSON.stringify(updated));
      setIsBookmarked(false);
    } else {
      bookmarks.push(content.id);
      localStorage.setItem('poem-bookmarks', JSON.stringify(bookmarks));
      setIsBookmarked(true);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleTextToSpeech = async () => {
    if (isSpeaking) {
      // Stop current speech
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      const textToSpeak = selectedText || content.body;

      // Try Google Cloud TTS API first (if available)
      try {
        setIsSpeaking(true);

        const response = await fetch('/api/tts/context-aware', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: textToSpeak,
            emotion: poemAnalysis?.emotion || 'reflective',
            mood: poemAnalysis?.mood || 'somber',
            voice: 'female',
          }),
        });

        if (response.ok) {
          // Google Cloud TTS succeeded
          const audioBlob = await response.blob();
          const audioUrl = URL.createObjectURL(audioBlob);

          ttsAudioRef.current = new Audio(audioUrl);
          ttsAudioRef.current.onended = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(audioUrl);
          };
          ttsAudioRef.current.onerror = () => {
            setIsSpeaking(false);
            URL.revokeObjectURL(audioUrl);
          };

          await ttsAudioRef.current.play();
          return; // Success, exit
        } else {
          throw new Error('Google TTS unavailable');
        }
      } catch {
        console.log('Google TTS unavailable, falling back to browser TTS');

        // Fallback to browser Web Speech API with emotion-aware parameters
        if ('speechSynthesis' in window) {
          try {
            const utterance = new SpeechSynthesisUtterance(textToSpeak);
            utterance.lang = 'ta-IN';

            // Apply emotion-aware parameters
            if (poemAnalysis) {
              switch (poemAnalysis.emotion) {
                case 'sad':
                case 'melancholic':
                  utterance.rate = 0.75;
                  utterance.pitch = 0.8;
                  break;
                case 'joyful':
                case 'hopeful':
                  utterance.rate = 1.0;
                  utterance.pitch = 1.2;
                  break;
                case 'reflective':
                case 'longing':
                  utterance.rate = 0.85;
                  utterance.pitch = 0.9;
                  break;
                default:
                  utterance.rate = 0.9;
                  utterance.pitch = 1.0;
              }
            } else {
              utterance.rate = 0.85;
              utterance.pitch = 0.9;
            }

            // Try to use Tamil voice
            const voices = window.speechSynthesis.getVoices();
            const tamilVoice = voices.find(voice => voice.lang.includes('ta'));
            if (tamilVoice) {
              utterance.voice = tamilVoice;
            }

            utterance.onend = () => setIsSpeaking(false);
            utterance.onerror = () => {
              setIsSpeaking(false);
              alert('குரல் வாசிப்பு தோல்வியடைந்தது.');
            };

            window.speechSynthesis.speak(utterance);
          } catch (browserError) {
            console.error('Browser TTS error:', browserError);
            setIsSpeaking(false);
            alert('குரல் வாசிப்பு தோல்வியடைந்தது. உங்கள் உலாவி தமிழ் குரல்களை ஆதரிக்கவில்லை.');
          }
        } else {
          setIsSpeaking(false);
          alert('உங்கள் உலாவி உரை-குரல் அம்சத்தை ஆதரிக்கவில்லை');
        }
      }
    }
  };

  const handleCopyText = async () => {
    try {
      const textToCopy = selectedText || content.body;
      await navigator.clipboard.writeText(textToCopy);
      setShowCopyNotification(true);
      setTimeout(() => setShowCopyNotification(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleTextSelection = () => {
    const selection = window.getSelection();
    setSelectedText(selection?.toString() || '');
  };

  const handleShareStanza = async () => {
    const textToShare = selectedText || content.body;
    const shareData = {
      title: content.title,
      text: `${textToShare}\n\n- ${content.author}`,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      setShowShareMenu(!showShareMenu);
    }
  };

  const handleBackgroundMusic = () => {
    if (!audioRef.current) {
      // Create audio element with context-aware music selection
      audioRef.current = new Audio();
      audioRef.current.loop = true;
      audioRef.current.volume = volume;

      // Get intelligent music sources based on poem analysis
      const sources = poemAnalysis
        ? getAllMusicSources(poemAnalysis.emotion, poemAnalysis.mood)
        : getAllMusicSources('sad', 'somber'); // Default fallback

      // Set the first source
      audioRef.current.src = sources[0];

      // Add error handler to try next source
      let sourceIndex = 0;
      audioRef.current.onerror = () => {
        sourceIndex++;
        if (sourceIndex < sources.length) {
          if (audioRef.current) {
            audioRef.current.src = sources[sourceIndex];
            if (isMusicPlaying) {
              audioRef.current.play().catch(err => {
                console.error('Failed to play background music:', err);
              });
            }
          }
        }
      };
    }

    if (isMusicPlaying) {
      audioRef.current.pause();
      setIsMusicPlaying(false);
      setShowVolumeControl(false);
    } else {
      audioRef.current.play().catch(err => {
        console.error('Failed to play background music:', err);
        alert('இசையை இயக்க முடியவில்லை. மற்றொரு முறை முயற்சிக்கவும்.');
        setIsMusicPlaying(false);
      });
      setIsMusicPlaying(true);
      setShowVolumeControl(true);
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const modeStyles = {
    light: 'bg-white text-gray-900',
    dark: 'bg-gray-900 text-gray-100',
    sepia: 'bg-amber-50 text-amber-950',
  };

  const modeBorders = {
    light: 'border-gray-200',
    dark: 'border-gray-700',
    sepia: 'border-amber-200',
  };

  return (
    <div className={`relative ${modeStyles[readingMode]} transition-colors duration-300`}>
      {/* Reading Mode Toolbar */}
      <div className={`sticky top-0 z-10 border-b ${modeBorders[readingMode]} backdrop-blur-sm bg-opacity-95 ${modeStyles[readingMode]}`}>
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-3">
          {/* Mobile: Stack layout */}
          <div className="flex flex-col gap-2 sm:hidden">
            {/* Reading Mode Buttons Row */}
            <div className="flex gap-1.5 justify-center">
              <button
                onClick={() => handleReadingModeChange('light')}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium font-tamil transition-all ${
                  readingMode === 'light'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-200 text-gray-700'
                }`}
                aria-label="வெளிச்சம் பயன்முறை"
              >
                ☀️
              </button>
              <button
                onClick={() => handleReadingModeChange('dark')}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium font-tamil transition-all ${
                  readingMode === 'dark'
                    ? 'bg-white text-gray-900'
                    : 'bg-gray-700 text-gray-100'
                }`}
                aria-label="இருட்டு பயன்முறை"
              >
                🌙
              </button>
              <button
                onClick={() => handleReadingModeChange('sepia')}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium font-tamil transition-all ${
                  readingMode === 'sepia'
                    ? 'bg-amber-900 text-amber-50'
                    : 'bg-amber-100 text-amber-900'
                }`}
                aria-label="செப்பியா பயன்முறை"
              >
                📜
              </button>
            </div>

            {/* Action Buttons Row */}
            <div className="flex gap-1.5 justify-center overflow-x-auto">
              <button
                onClick={handleBackgroundMusic}
                className={`p-1.5 rounded-lg transition-all ${
                  isMusicPlaying ? 'bg-purple-100 text-purple-700' : ''
                } ${
                  readingMode === 'dark' ? 'hover:bg-gray-800' : readingMode === 'sepia' ? 'hover:bg-amber-100' : 'hover:bg-gray-100'
                }`}
                title={isMusicPlaying ? 'இசையை நிறுத்து' : 'பின்னணி இசை'}
                aria-label={isMusicPlaying ? 'பின்னணி இசையை நிறுத்து' : 'பின்னணி இசையை இயக்கு'}
              >
                {isMusicPlaying ? (
                  <MusicalNoteSolidIcon className="w-5 h-5 animate-pulse" />
                ) : (
                  <MusicalNoteIcon className="w-5 h-5" />
                )}
              </button>
              <button
                onClick={handleBookmark}
                className={`p-1.5 rounded-lg transition-all ${
                  readingMode === 'dark' ? 'hover:bg-gray-800' : readingMode === 'sepia' ? 'hover:bg-amber-100' : 'hover:bg-gray-100'
                }`}
                aria-label={isBookmarked ? 'புத்தகக்குறியை அகற்று' : 'புத்தகக்குறியாக சேமி'}
              >
                {isBookmarked ? (
                  <BookmarkSolidIcon className="w-5 h-5 text-green-600" />
                ) : (
                  <BookmarkIcon className="w-5 h-5" />
                )}
              </button>
              <button
                onClick={handleTextToSpeech}
                className={`p-1.5 rounded-lg transition-all ${
                  isSpeaking ? 'bg-green-100 text-green-700' : ''
                } ${
                  readingMode === 'dark' ? 'hover:bg-gray-800' : readingMode === 'sepia' ? 'hover:bg-amber-100' : 'hover:bg-gray-100'
                }`}
                aria-label={isSpeaking ? 'குரல் வாசிப்பை நிறுத்து' : 'குரல் வாசிப்பைத் தொடங்கு'}
              >
                <SpeakerWaveIcon className={`w-5 h-5 ${isSpeaking ? 'animate-pulse' : ''}`} />
              </button>
              <button
                onClick={handleCopyText}
                className={`p-1.5 rounded-lg transition-all ${
                  readingMode === 'dark' ? 'hover:bg-gray-800' : readingMode === 'sepia' ? 'hover:bg-amber-100' : 'hover:bg-gray-100'
                }`}
                aria-label="கவிதையை நகலெடு"
              >
                <ClipboardDocumentIcon className="w-5 h-5" />
              </button>
              <button
                onClick={handlePrint}
                className={`p-1.5 rounded-lg transition-all ${
                  readingMode === 'dark' ? 'hover:bg-gray-800' : readingMode === 'sepia' ? 'hover:bg-amber-100' : 'hover:bg-gray-100'
                }`}
                aria-label="கவிதையை அச்சிடு"
              >
                <PrinterIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Desktop: Original horizontal layout */}
          <div className="hidden sm:flex flex-wrap items-center justify-between gap-3 sm:gap-4">
            {/* Reading Mode Selector */}
            <div className="flex gap-1.5 sm:gap-2">
            <button
              onClick={() => handleReadingModeChange('light')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium font-tamil transition-all ${
                readingMode === 'light'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              title="வெள்ளை பின்னணி"
              aria-label="வெளிச்சம் பயன்முறை"
            >
              <span className="hidden sm:inline">☀️ வெளிச்சம்</span>
              <span className="sm:hidden">☀️</span>
            </button>
            <button
              onClick={() => handleReadingModeChange('dark')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium font-tamil transition-all ${
                readingMode === 'dark'
                  ? 'bg-white text-gray-900'
                  : 'bg-gray-700 text-gray-100 hover:bg-gray-600'
              }`}
              title="கருப்பு பின்னணி"
              aria-label="இருட்டு பயன்முறை"
            >
              <span className="hidden sm:inline">🌙 இருட்டு</span>
              <span className="sm:hidden">🌙</span>
            </button>
            <button
              onClick={() => handleReadingModeChange('sepia')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium font-tamil transition-all ${
                readingMode === 'sepia'
                  ? 'bg-amber-900 text-amber-50'
                  : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
              }`}
              title="செப்பியா பின்னணி"
              aria-label="செப்பியா பயன்முறை"
            >
              <span className="hidden sm:inline">📜 செப்பியா</span>
              <span className="sm:hidden">📜</span>
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-1.5 sm:gap-2">
            <button
              onClick={handleBackgroundMusic}
              className={`p-2 rounded-lg transition-all ${
                isMusicPlaying ? 'bg-purple-100 text-purple-700' : ''
              } ${
                readingMode === 'dark'
                  ? 'hover:bg-gray-800'
                  : readingMode === 'sepia'
                  ? 'hover:bg-amber-100'
                  : 'hover:bg-gray-100'
              }`}
              title={isMusicPlaying ? 'இசையை நிறுத்து' : 'பின்னணி இசை'}
              aria-label={isMusicPlaying ? 'பின்னணி இசையை நிறுத்து' : 'பின்னணி இசையை இயக்கு'}
            >
              {isMusicPlaying ? (
                <MusicalNoteSolidIcon className="w-5 h-5 animate-pulse" />
              ) : (
                <MusicalNoteIcon className="w-5 h-5" />
              )}
            </button>

            <button
              onClick={handleBookmark}
              className={`p-2 rounded-lg transition-all ${
                readingMode === 'dark'
                  ? 'hover:bg-gray-800'
                  : readingMode === 'sepia'
                  ? 'hover:bg-amber-100'
                  : 'hover:bg-gray-100'
              }`}
              title={isBookmarked ? 'புத்தகக்குறியை அகற்று' : 'புத்தகக்குறியாக சேமி'}
              aria-label={isBookmarked ? 'புத்தகக்குறியை அகற்று' : 'புத்தகக்குறியாக சேமி'}
            >
              {isBookmarked ? (
                <BookmarkSolidIcon className="w-5 h-5 text-green-600" />
              ) : (
                <BookmarkIcon className="w-5 h-5" />
              )}
            </button>

            <button
              onClick={handleTextToSpeech}
              className={`p-2 rounded-lg transition-all ${
                isSpeaking ? 'bg-green-100 text-green-700' : ''
              } ${
                readingMode === 'dark'
                  ? 'hover:bg-gray-800'
                  : readingMode === 'sepia'
                  ? 'hover:bg-amber-100'
                  : 'hover:bg-gray-100'
              }`}
              title={isSpeaking ? 'நிறுத்து' : 'உரை-குரல்'}
              aria-label={isSpeaking ? 'குரல் வாசிப்பை நிறுத்து' : 'குரல் வாசிப்பைத் தொடங்கு'}
            >
              <SpeakerWaveIcon className={`w-5 h-5 ${isSpeaking ? 'animate-pulse' : ''}`} />
            </button>

            <button
              onClick={handleCopyText}
              className={`p-2 rounded-lg transition-all ${
                readingMode === 'dark'
                  ? 'hover:bg-gray-800'
                  : readingMode === 'sepia'
                  ? 'hover:bg-amber-100'
                  : 'hover:bg-gray-100'
              }`}
              title={selectedText ? 'தேர்ந்தெடுத்த உரையை நகலெடு' : 'கவிதையை நகலெடு'}
              aria-label={selectedText ? 'தேர்ந்தெடுத்த உரையை நகலெடு' : 'கவிதையை நகலெடு'}
            >
              <ClipboardDocumentIcon className="w-5 h-5" />
            </button>

            {selectedText && (
              <button
                onClick={handleShareStanza}
                className={`p-2 rounded-lg transition-all bg-green-100 text-green-700 ${
                  readingMode === 'dark'
                    ? 'hover:bg-gray-800'
                    : readingMode === 'sepia'
                    ? 'hover:bg-amber-100'
                    : 'hover:bg-gray-100'
                }`}
                title="தேர்ந்தெடுத்த பகுதியை பகிர்"
                aria-label="தேர்ந்தெடுத்த பகுதியை பகிர்"
              >
                <ShareIcon className="w-5 h-5" />
              </button>
            )}

            <button
              onClick={handlePrint}
              className={`p-2 rounded-lg transition-all ${
                readingMode === 'dark'
                  ? 'hover:bg-gray-800'
                  : readingMode === 'sepia'
                  ? 'hover:bg-amber-100'
                  : 'hover:bg-gray-100'
              }`}
              title="அச்சிடு"
              aria-label="கவிதையை அச்சிடு"
            >
              <PrinterIcon className="w-5 h-5" />
            </button>
          </div>
          </div>
        </div>
      </div>

      {/* Poem Content with Enhanced Typography */}
      <div className="container mx-auto px-2 sm:px-6 md:px-8 lg:px-12 py-8 sm:py-10 md:py-12 lg:py-16 max-w-7xl">
        {/* Poem Title */}
        <h1 className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold font-poem mb-6 sm:mb-8 md:mb-10 leading-tight ${
          readingMode === 'dark' ? 'text-gray-100' : readingMode === 'sepia' ? 'text-amber-950' : 'text-gray-900'
        }`}>
          {content.title}
        </h1>

        {/* Poem Body - Responsive Layout with Enhanced Typography */}
        <div
          ref={contentRef}
          onMouseUp={handleTextSelection}
          className={`poem-text font-poem whitespace-pre-wrap lg:grid lg:grid-cols-2 lg:gap-16 ${
            readingMode === 'dark' ? 'text-gray-100 lg:divide-x lg:divide-gray-700' : readingMode === 'sepia' ? 'text-amber-950 lg:divide-x lg:divide-amber-300' : 'text-gray-900 lg:divide-x lg:divide-gray-300'
          }`}
        >
          {/* Mobile & Tablet: Full poem in single column */}
          <div className="lg:hidden">
            {content.body}
          </div>

          {/* Desktop: Split content into two columns, keeping stanzas together */}
          <div className="hidden lg:block lg:pr-8">
            {(() => {
              // Split by stanzas (groups separated by blank lines)
              const stanzas = content.body.split(/\n\s*\n/);
              const midPoint = Math.ceil(stanzas.length / 2);
              const firstHalf = stanzas.slice(0, midPoint).join('\n\n');
              return <>{firstHalf}</>;
            })()}
          </div>
          <div className="hidden lg:block lg:pl-8">
            {(() => {
              // Split by stanzas (groups separated by blank lines)
              const stanzas = content.body.split(/\n\s*\n/);
              const midPoint = Math.ceil(stanzas.length / 2);
              const secondHalf = stanzas.slice(midPoint).join('\n\n');
              return <>{secondHalf}</>;
            })()}
          </div>
        </div>

        {/* Author Attribution - Consistent placement for all devices */}
        {content.author && (
          <div className={`mt-12 pt-8 ${
            readingMode === 'dark' ? 'border-t border-gray-700' : readingMode === 'sepia' ? 'border-t border-amber-300' : 'border-t border-gray-300'
          }`} style={{
            fontSize: 'clamp(0.9rem, 1.5vw, 1.05rem)',
            lineHeight: '1.7',
            opacity: 0.85
          }}>
            <div className="text-right font-poem">
              <div className="mb-1">ஊக்கம்: தமிழ்</div>
              <div className="font-semibold">ஆக்கம்: {content.author}</div>
            </div>
          </div>
        )}
      </div>

      {/* Copy Notification */}
      {showCopyNotification && (
        <div className="fixed bottom-8 right-8 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg font-tamil animate-fade-in-up z-50">
          ✓ நகலெடுக்கப்பட்டது!
        </div>
      )}

      {/* Volume Control - Shows when music is playing */}
      {showVolumeControl && isMusicPlaying && (
        <div className="fixed bottom-8 left-8 bg-white dark:bg-gray-800 px-6 py-4 rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="flex items-center gap-4">
            <MusicalNoteSolidIcon className="w-5 h-5 text-purple-600 animate-pulse" />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 font-tamil">
                ஒலி அளவு
              </span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">🔉</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-32 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  aria-label="இசை ஒலி அளவு"
                />
                <span className="text-xs text-gray-500">🔊</span>
                <span className="text-xs font-semibold text-purple-600 min-w-[3ch]">
                  {Math.round(volume * 100)}%
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowVolumeControl(false)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              aria-label="மூடு"
            >
              <span className="text-gray-400 text-lg">×</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
