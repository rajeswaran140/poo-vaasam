'use client';

/**
 * Tamil Transliteration Input Component
 *
 * Provides English-to-Tamil transliteration as you type
 * with toggle between transliteration and direct Tamil input
 */

import { useState } from 'react';
import { ReactTransliterate } from 'react-transliterate';
import 'react-transliterate/dist/index.css';
import { Languages, Keyboard } from 'lucide-react';

interface TamilInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
  required?: boolean;
  error?: string;
  maxLength?: number;
}

export function TamilInput({
  value,
  onChange,
  placeholder = 'Type in English to get Tamil...',
  className = '',
  label,
  required = false,
  error,
  maxLength,
}: TamilInputProps) {
  const [isTransliterationEnabled, setIsTransliterationEnabled] = useState(true);

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <button
            type="button"
            onClick={() => setIsTransliterationEnabled(!isTransliterationEnabled)}
            className="flex items-center gap-2 text-xs px-3 py-1 rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
            title={
              isTransliterationEnabled
                ? 'Switch to direct Tamil input'
                : 'Switch to English transliteration'
            }
          >
            {isTransliterationEnabled ? (
              <>
                <Languages className="w-3 h-3" />
                English → Tamil
              </>
            ) : (
              <>
                <Keyboard className="w-3 h-3" />
                Direct Tamil
              </>
            )}
          </button>
        </div>
      )}

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
          renderComponent={(props: any) => (
            <input
              {...props}
              type="text"
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-tamil ${
                error ? 'border-red-500' : 'border-gray-300'
              } ${className}`}
              maxLength={maxLength}
              required={required}
            />
          )}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-tamil ${
            error ? 'border-red-500' : 'border-gray-300'
          } ${className}`}
          maxLength={maxLength}
          required={required}
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {maxLength && (
        <p className="text-xs text-gray-500 text-right">
          {value.length} / {maxLength}
        </p>
      )}
    </div>
  );
}
