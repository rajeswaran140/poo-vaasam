'use client';

/**
 * Tamil Input Component
 *
 * Smart input field with English-to-Tamil transliteration
 * Type in English, get Tamil output automatically
 */

import { useState, useEffect, ChangeEvent } from 'react';
import { transliterateTamil } from '@/lib/utils/tamil-transliteration';

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
  placeholder = 'Type in English (e.g., "vanakkam")',
  multiline = false,
  rows = 4,
  className = '',
  label,
  required = false,
}: TamilInputProps) {
  const [transliterationEnabled, setTransliterationEnabled] = useState(true);
  const [romanizedInput, setRomanizedInput] = useState('');

  // Reset romanized input when value changes externally
  useEffect(() => {
    if (!transliterationEnabled) {
      setRomanizedInput(value);
    }
  }, [value, transliterationEnabled]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const inputValue = e.target.value;

    if (transliterationEnabled) {
      // Store romanized input
      setRomanizedInput(inputValue);

      // Convert to Tamil and pass to parent
      const tamilText = transliterateTamil(inputValue);
      onChange(tamilText);
    } else {
      // Direct Tamil input
      onChange(inputValue);
    }
  };

  const toggleTransliteration = () => {
    const newState = !transliterationEnabled;
    setTransliterationEnabled(newState);

    if (newState) {
      // Switching to transliteration mode - convert current value
      setRomanizedInput('');
    } else {
      // Switching to direct Tamil mode
      setRomanizedInput(value);
    }
  };

  const inputClasses = `
    w-full px-4 py-3 border border-gray-300 rounded-lg
    focus:ring-2 focus:ring-purple-500 focus:border-transparent
    transition-all duration-200
    font-tamil
    ${transliterationEnabled ? 'bg-purple-50 border-purple-300' : 'bg-white'}
    ${className}
  `;

  return (
    <div className="space-y-2">
      {/* Label and Toggle */}
      <div className="flex items-center justify-between">
        {label && (
          <label className="block text-sm font-medium text-gray-700">
            {label} {required && <span className="text-red-500">*</span>}
          </label>
        )}

        {/* Transliteration Toggle */}
        <button
          type="button"
          onClick={toggleTransliteration}
          className={`
            flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium
            transition-all duration-200
            ${
              transliterationEnabled
                ? 'bg-purple-100 text-purple-700 border-2 border-purple-300'
                : 'bg-gray-100 text-gray-600 border-2 border-gray-300'
            }
            hover:shadow-md
          `}
          title={transliterationEnabled ? 'Transliteration: ON (English → Tamil)' : 'Transliteration: OFF (Direct Tamil)'}
        >
          <span className="text-lg">🔤</span>
          <span>{transliterationEnabled ? 'EN → தமிழ்' : 'Direct தமிழ்'}</span>
        </button>
      </div>

      {/* Input Field */}
      {multiline ? (
        <textarea
          value={transliterationEnabled ? romanizedInput : value}
          onChange={handleInputChange}
          placeholder={transliterationEnabled ? placeholder : 'Type in Tamil directly'}
          rows={rows}
          className={inputClasses}
          required={required}
        />
      ) : (
        <input
          type="text"
          value={transliterationEnabled ? romanizedInput : value}
          onChange={handleInputChange}
          placeholder={transliterationEnabled ? placeholder : 'Type in Tamil directly'}
          className={inputClasses}
          required={required}
        />
      )}

      {/* Preview and Help */}
      {transliterationEnabled && romanizedInput && (
        <div className="flex items-start gap-2 text-sm">
          <span className="text-gray-500">தமிழ் Output:</span>
          <span className="font-tamil text-purple-700 font-medium">{value || '...'}</span>
        </div>
      )}

      {transliterationEnabled && (
        <div className="text-xs text-gray-500">
          💡 <strong>Tip:</strong> Type &quot;vanakkam&quot; → வணக்கம், &quot;poo&quot; → பூ, &quot;tamil&quot; → தமிழ்
        </div>
      )}
    </div>
  );
}
