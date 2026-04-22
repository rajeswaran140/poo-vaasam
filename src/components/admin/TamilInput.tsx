'use client';

/**
 * Tamil Input Component with React Transliterate
 *
 * Provides accurate English-to-Tamil transliteration using Google's algorithm
 * Type in English, get accurate Tamil output with word suggestions
 */

import { useState } from 'react';
import { ReactTransliterate } from 'react-transliterate';
import 'react-transliterate/dist/index.css';
import { Languages, Keyboard } from 'lucide-react';

interface TamilInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  label?: string;
  required?: boolean;
}

export function TamilInput({
  value,
  onChange,
  placeholder = 'Type in English to get Tamil...',
  multiline = false,
  rows = 4,
  className = '',
  label,
  required = false,
}: TamilInputProps) {
  const [isTransliterationEnabled, setIsTransliterationEnabled] = useState(true);

  return (
    <div className="space-y-2">
      {/* Label and Toggle */}
      {label && (
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <button
            type="button"
            onClick={() => setIsTransliterationEnabled(!isTransliterationEnabled)}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-purple-50 text-purple-700 hover:bg-purple-100 transition-all border-2 border-purple-200 font-medium"
            title={
              isTransliterationEnabled
                ? 'Switch to direct Tamil input'
                : 'Switch to English transliteration'
            }
          >
            {isTransliterationEnabled ? (
              <>
                <Languages className="w-3.5 h-3.5" />
                EN → தமிழ்
              </>
            ) : (
              <>
                <Keyboard className="w-3.5 h-3.5" />
                Direct தமிழ்
              </>
            )}
          </button>
        </div>
      )}

      {/* Input Field with Transliteration */}
      {isTransliterationEnabled ? (
        <ReactTransliterate
          value={value}
          onChangeText={onChange}
          lang="ta"
          placeholder={placeholder}
          containerClassName="relative"
          activeItemStyles={{
            backgroundColor: '#7C3AED',
            color: 'white',
          }}
          renderComponent={(props: any) =>
            multiline ? (
              <textarea
                {...props}
                rows={rows}
                className={`w-full px-4 py-3 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-tamil resize-y bg-purple-50 transition-all ${className}`}
                required={required}
              />
            ) : (
              <input
                {...props}
                type="text"
                className={`w-full px-4 py-3 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-tamil bg-purple-50 transition-all ${className}`}
                required={required}
              />
            )
          }
        />
      ) : (
        // Direct Tamil Input (no transliteration)
        <>
          {multiline ? (
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Type in Tamil directly using your keyboard"
              rows={rows}
              className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-tamil resize-y transition-all ${className}`}
              required={required}
            />
          ) : (
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Type in Tamil directly using your keyboard"
              className={`w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-tamil transition-all ${className}`}
              required={required}
            />
          )}
        </>
      )}

      {/* Help Text */}
      {isTransliterationEnabled && (
        <div className="flex items-start gap-2 text-xs text-purple-700 bg-purple-50 px-3 py-2 rounded-md border border-purple-200">
          <span className="text-base">💡</span>
          <div>
            <strong>How it works:</strong> Type in English and press <kbd className="px-1 py-0.5 bg-white border border-purple-300 rounded text-xs">Space</kbd> to see Tamil suggestions.
            <br />
            <span className="text-purple-600">Examples: vanakkam → வணக்கம், poo → பூ, tamil → தமிழ், ilayaraja → இளையராஜா</span>
          </div>
        </div>
      )}
    </div>
  );
}
