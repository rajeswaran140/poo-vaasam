/**
 * Tamil Fonts Reference Component
 *
 * Displays available Tamil fonts with examples for content creators
 */

'use client';

import { useState } from 'react';

const fonts = [
  {
    name: 'Noto Sans Tamil',
    className: 'font-tamil',
    variable: '--font-tamil',
    type: 'Sans-serif',
    weights: ['400 (Regular)', '500 (Medium)', '600 (Semi-Bold)', '700 (Bold)'],
    bestFor: ['Body text', 'UI elements', 'General content', 'High readability'],
    description: 'Clean, modern sans-serif design optimized for digital displays. Excellent screen readability.',
    example: 'தமிழ் இலக்கியத்தின் எல்லையற்ற உலகம். படியுங்கள், கேளுங்கள், அனுபவியுங்கள்.',
  },
  {
    name: 'Kavivanar',
    className: 'font-kavivanar',
    variable: '--font-kavivanar',
    type: 'Cursive/Handwritten',
    weights: ['400 (Regular)'],
    bestFor: ['Logo text', 'Headlines', 'Poetic content', 'Decorative elements'],
    description: 'Handwritten, flowing style. Artistic and elegant, great for short text.',
    example: 'தமிழகவல் - கவிதைகள் மற்றும் பாடல்கள்',
  },
  {
    name: 'Baloo Thambi 2',
    className: 'font-poem',
    variable: '--font-baloo-thambi',
    type: 'Rounded Sans-serif',
    weights: ['400 (Regular)', '500 (Medium)', '600 (Semi-Bold)', '700 (Bold)', '800 (Extra-Bold)'],
    bestFor: ['Poetry', 'Creative writing', 'Children&apos;s content', 'Friendly tone'],
    description: 'Rounded, friendly appearance. Playful and warm, great for creative content.',
    example: 'காற்றில் மிதந்து வந்த மலரே, உன் வாசம் என்னை கவர்ந்ததடி.',
  },
];

export function FontsReference() {
  const [selectedFont, setSelectedFont] = useState(0);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 p-6">
        <h2 className="text-2xl font-bold text-white mb-2">Tamil Fonts Reference</h2>
        <p className="text-purple-100">Available Google Fonts for your content</p>
      </div>

      <div className="p-6">
        {/* Font Tabs */}
        <div className="flex flex-wrap gap-3 mb-6">
          {fonts.map((font, idx) => (
            <button
              key={font.name}
              onClick={() => setSelectedFont(idx)}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                selectedFont === idx
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {font.name}
            </button>
          ))}
        </div>

        {/* Selected Font Details */}
        <div className="space-y-6">
          {/* Font Preview */}
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-8 border-2 border-gray-200">
            <div className="text-sm text-gray-500 mb-3">Preview:</div>
            <div className={`${fonts[selectedFont].className} text-3xl sm:text-4xl font-tamil leading-relaxed`}>
              {fonts[selectedFont].example}
            </div>
          </div>

          {/* Font Information Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Details */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Font Details
                </h3>
                <div className="space-y-2 bg-gray-50 rounded-lg p-4">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <span className="font-medium text-gray-900">{fonts[selectedFont].type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">CSS Class:</span>
                    <code className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-sm font-mono">
                      {fonts[selectedFont].className}
                    </code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">CSS Variable:</span>
                    <code className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm font-mono">
                      {fonts[selectedFont].variable}
                    </code>
                  </div>
                </div>
              </div>

              {/* Available Weights */}
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Available Weights
                </h3>
                <div className="flex flex-wrap gap-2">
                  {fonts[selectedFont].weights.map((weight) => (
                    <span
                      key={weight}
                      className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium"
                    >
                      {weight}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Best For */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Best For
                </h3>
                <div className="space-y-2">
                  {fonts[selectedFont].bestFor.map((use, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <svg
                        className="w-5 h-5 text-green-500 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="text-gray-700">{use}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Description
                </h3>
                <p className="text-gray-700 leading-relaxed">
                  {fonts[selectedFont].description}
                </p>
              </div>
            </div>
          </div>

          {/* Code Example */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Usage Example
            </h3>
            <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
              <pre className="text-sm text-gray-100 font-mono">
                <code>{`<p className="${fonts[selectedFont].className}">
  தமிழ் உள்ளடக்கம்
</p>`}</code>
              </pre>
            </div>
          </div>

          {/* Weight Examples */}
          {fonts[selectedFont].weights.length > 1 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Weight Examples
              </h3>
              <div className="space-y-3">
                {fonts[selectedFont].weights.map((weight) => {
                  const weightClass =
                    weight.includes('400') ? 'font-normal' :
                    weight.includes('500') ? 'font-medium' :
                    weight.includes('600') ? 'font-semibold' :
                    weight.includes('700') ? 'font-bold' :
                    weight.includes('800') ? 'font-extrabold' : 'font-normal';

                  return (
                    <div
                      key={weight}
                      className="flex items-center gap-4 bg-gray-50 rounded-lg p-3"
                    >
                      <span className="text-sm text-gray-500 w-32">{weight}</span>
                      <span className={`${fonts[selectedFont].className} ${weightClass} text-xl flex-1`}>
                        தமிழகவல் - தமிழ் இலக்கிய தளம்
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Note */}
      <div className="bg-blue-50 border-t border-blue-100 p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Font Loading Strategy</p>
            <p className="text-blue-700">
              All fonts are loaded from Google Fonts CDN with <code className="px-1 bg-blue-100 rounded">display: &apos;swap&apos;</code> for optimal performance.
              Tamil characters are prioritized for fast rendering.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
