'use client';

import { useState, useEffect, useRef } from 'react';
import { BookmarkIcon, PrinterIcon, SpeakerWaveIcon, ClipboardDocumentIcon, ShareIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';

interface PoemReaderProps {
  content: any; // Accept any content object from the database
}

type ReadingMode = 'light' | 'dark' | 'sepia';

export function PoemReader({ content }: PoemReaderProps) {
  const [readingMode, setReadingMode] = useState<ReadingMode>('light');
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

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

  const handleTextToSpeech = () => {
    if ('speechSynthesis' in window) {
      if (isSpeaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      } else {
        const utterance = new SpeechSynthesisUtterance(content.body);
        utterance.lang = 'ta-IN';
        utterance.rate = 0.9;
        utterance.onend = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
        setIsSpeaking(true);
      }
    } else {
      alert('உங்கள் உலாவி உரை-குரல் அம்சத்தை ஆதரிக்கவில்லை');
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
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Reading Mode Selector */}
          <div className="flex gap-2">
            <button
              onClick={() => handleReadingModeChange('light')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium font-tamil transition-all ${
                readingMode === 'light'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              title="வெள்ளை பின்னணி"
            >
              ☀️ வெளிச்சம்
            </button>
            <button
              onClick={() => handleReadingModeChange('dark')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium font-tamil transition-all ${
                readingMode === 'dark'
                  ? 'bg-white text-gray-900'
                  : 'bg-gray-700 text-gray-100 hover:bg-gray-600'
              }`}
              title="கருப்பு பின்னணி"
            >
              🌙 இருட்டு
            </button>
            <button
              onClick={() => handleReadingModeChange('sepia')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium font-tamil transition-all ${
                readingMode === 'sepia'
                  ? 'bg-amber-900 text-amber-50'
                  : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
              }`}
              title="செப்பியா பின்னணி"
            >
              📜 செப்பியா
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
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
            >
              <PrinterIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Poem Content with Enhanced Typography */}
      <div className="container mx-auto px-4 sm:px-6 md:px-8 py-8 sm:py-10 md:py-12 max-w-3xl lg:max-w-4xl">
        {/* Poem Title */}
        <h1 className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold font-poem mb-6 sm:mb-8 leading-tight ${
          readingMode === 'dark' ? 'text-gray-100' : readingMode === 'sepia' ? 'text-amber-950' : 'text-gray-900'
        }`}>
          {content.title}
        </h1>

        {/* Poem Body */}
        <div
          ref={contentRef}
          onMouseUp={handleTextSelection}
          className={`poem-text font-poem whitespace-pre-wrap ${
            readingMode === 'dark' ? 'text-gray-100' : readingMode === 'sepia' ? 'text-amber-950' : 'text-gray-900'
          }`}
          style={{
            // Mobile-first responsive font sizes
            fontSize: 'clamp(1rem, 2.5vw, 1.375rem)',
            lineHeight: '2.2',
            letterSpacing: '0.5px',
            wordSpacing: '0.1em',
            // Better readability on all devices
            textRendering: 'optimizeLegibility',
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            // Prevent text overflow on small screens
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            hyphens: 'auto',
            // Optimal reading width
            maxWidth: '65ch',
          }}
        >
          {content.body}
        </div>
      </div>

      {/* Copy Notification */}
      {showCopyNotification && (
        <div className="fixed bottom-8 right-8 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg font-tamil animate-fade-in-up z-50">
          ✓ நகலெடுக்கப்பட்டது!
        </div>
      )}
    </div>
  );
}
