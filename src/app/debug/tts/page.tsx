/**
 * TTS Debug Page
 * Displays TTS configuration status and diagnostics
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DebugData {
  status: 'OK' | 'ERROR';
  debug: {
    timestamp: string;
    environment: string;
    credentials: {
      hasGoogleApplicationCredentials: boolean;
      hasGoogleTtsCredentialsBase64: boolean;
      googleApplicationCredentialsValue: string;
      base64Length: number;
      base64Preview: string;
    };
    parsedCredentials: {
      canParse: boolean;
      error: string | null;
      projectId: string | null;
      clientEmail: string | null;
    };
  };
  clientStatus: {
    canInitialize: boolean;
    error: string | null;
  };
}

export default function TTSDebugPage() {
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDebugInfo();
  }, []);

  const fetchDebugInfo = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/tts/debug');
      const data = await response.json();
      setDebugData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch debug info');
    } finally {
      setIsLoading(false);
    }
  };

  const StatusBadge = ({ status }: { status: boolean }) => (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
        status ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {status ? '✓ OK' : '✗ FAILED'}
    </span>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="text-purple-600 hover:text-purple-800 mb-4 inline-flex items-center gap-2"
          >
            ← முகப்புக்குத் திரும்பு
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🔧 TTS Configuration Debug
          </h1>
          <p className="text-gray-600">
            Google Cloud Text-to-Speech configuration status and diagnostics
          </p>
        </div>

        {/* Refresh Button */}
        <button
          onClick={fetchDebugInfo}
          disabled={isLoading}
          className="mb-6 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
        >
          {isLoading ? 'Loading...' : '🔄 Refresh'}
        </button>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Debug Information */}
        {debugData && (
          <div className="space-y-6">
            {/* Overall Status */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Overall Status</h2>
                <StatusBadge status={debugData.status === 'OK'} />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Environment:</span>
                  <span className="ml-2 font-mono font-semibold">{debugData.debug.environment}</span>
                </div>
                <div>
                  <span className="text-gray-600">Timestamp:</span>
                  <span className="ml-2 font-mono text-xs">
                    {new Date(debugData.debug.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Credentials Configuration */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Credentials Configuration</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-semibold text-gray-900">
                      GOOGLE_APPLICATION_CREDENTIALS
                    </div>
                    <div className="text-sm text-gray-600 font-mono mt-1">
                      {debugData.debug.credentials.googleApplicationCredentialsValue}
                    </div>
                  </div>
                  <StatusBadge status={debugData.debug.credentials.hasGoogleApplicationCredentials} />
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">
                      GOOGLE_TTS_CREDENTIALS_BASE64
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      Length: {debugData.debug.credentials.base64Length} characters
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-1 break-all">
                      Preview: {debugData.debug.credentials.base64Preview}
                    </div>
                  </div>
                  <StatusBadge status={debugData.debug.credentials.hasGoogleTtsCredentialsBase64} />
                </div>
              </div>
            </div>

            {/* Parsed Credentials */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Parsed Credentials</h2>
                <StatusBadge status={debugData.debug.parsedCredentials.canParse} />
              </div>
              {debugData.debug.parsedCredentials.canParse ? (
                <div className="space-y-2 text-sm">
                  <div className="p-3 bg-green-50 rounded-lg">
                    <span className="text-gray-600">Project ID:</span>
                    <span className="ml-2 font-mono font-semibold text-green-800">
                      {debugData.debug.parsedCredentials.projectId}
                    </span>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <span className="text-gray-600">Client Email:</span>
                    <span className="ml-2 font-mono text-xs text-green-800">
                      {debugData.debug.parsedCredentials.clientEmail}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="font-semibold text-red-800 mb-2">Parse Error</div>
                  <div className="text-sm text-red-700 font-mono">
                    {debugData.debug.parsedCredentials.error || 'Unknown error'}
                  </div>
                </div>
              )}
            </div>

            {/* Client Initialization */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">TTS Client Status</h2>
                <StatusBadge status={debugData.clientStatus.canInitialize} />
              </div>
              {debugData.clientStatus.canInitialize ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-green-800 font-semibold mb-2">
                    ✓ Successfully connected to Google Cloud TTS API
                  </div>
                  <div className="text-sm text-green-700">
                    Tamil voices are available and API is responding correctly.
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="font-semibold text-red-800 mb-2">✗ Failed to initialize TTS client</div>
                  <div className="text-sm text-red-700 font-mono">
                    {debugData.clientStatus.error || 'Unknown error'}
                  </div>
                </div>
              )}
            </div>

            {/* Troubleshooting Tips */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
              <h2 className="text-xl font-bold text-blue-900 mb-4">💡 Troubleshooting Tips</h2>
              <ul className="space-y-2 text-sm text-blue-800">
                <li>
                  <strong>If base64 credentials are missing:</strong> Add GOOGLE_TTS_CREDENTIALS_BASE64
                  environment variable in AWS Amplify Console
                </li>
                <li>
                  <strong>If parse fails:</strong> Check that the base64 string is complete and has no extra
                  spaces or line breaks
                </li>
                <li>
                  <strong>If client initialization fails:</strong> Verify the Google Cloud TTS API is enabled
                  and the service account has correct permissions
                </li>
                <li>
                  <strong>After making changes:</strong> Redeploy your Amplify app for changes to take effect
                </li>
              </ul>
            </div>

            {/* Test Audio Generation */}
            {debugData.status === 'OK' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">🎵 Test Audio Generation</h2>
                <p className="text-gray-600 mb-4">
                  Configuration looks good! Try generating test audio:
                </p>
                <button
                  onClick={async () => {
                    try {
                      const response = await fetch('/api/tts/synthesize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: 'வணக்கம்', voice: 'female' }),
                      });

                      if (response.ok) {
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const audio = new Audio(url);
                        audio.play();
                        alert('✓ Audio generated successfully!');
                      } else {
                        const error = await response.json();
                        alert(`✗ Failed: ${JSON.stringify(error)}`);
                      }
                    } catch (err) {
                      alert(`✗ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
                    }
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  🔊 Generate Test Audio (வணக்கம்)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {isLoading && !debugData && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            <p className="mt-4 text-gray-600">Loading debug information...</p>
          </div>
        )}
      </div>
    </div>
  );
}
