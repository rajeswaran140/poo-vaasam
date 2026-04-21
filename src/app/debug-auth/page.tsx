'use client';

/**
 * Debug page to verify Cognito configuration
 */

import { useEffect, useState } from 'react';

export default function DebugAuthPage() {
  const [config, setConfig] = useState({
    userPoolId: 'Loading...',
    clientId: 'Loading...',
    region: 'Loading...',
  });

  useEffect(() => {
    // Access env vars in useEffect to ensure client-side execution
    setConfig({
      userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID || 'NOT SET',
      clientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || 'NOT SET',
      region: process.env.NEXT_PUBLIC_AWS_REGION || 'NOT SET',
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold mb-6 text-purple-800">
          🔍 Cognito Configuration Debug
        </h1>

        <div className="space-y-4">
          <div className="border-l-4 border-purple-500 pl-4 py-2">
            <h2 className="font-bold text-gray-700">User Pool ID:</h2>
            <code className="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">
              {config.userPoolId}
            </code>
            <p className="text-xs mt-1">
              {config.userPoolId === 'NOT SET' ?
                '❌ Environment variable not loaded' :
                '✅ Loaded correctly'
              }
            </p>
          </div>

          <div className="border-l-4 border-purple-500 pl-4 py-2">
            <h2 className="font-bold text-gray-700">Client ID:</h2>
            <code className="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">
              {config.clientId}
            </code>
            <p className="text-xs mt-1">
              {config.clientId === 'NOT SET' ?
                '❌ Environment variable not loaded' :
                '✅ Loaded correctly'
              }
            </p>
          </div>

          <div className="border-l-4 border-purple-500 pl-4 py-2">
            <h2 className="font-bold text-gray-700">Region:</h2>
            <code className="text-sm bg-gray-100 px-2 py-1 rounded block mt-1">
              {config.region}
            </code>
            <p className="text-xs mt-1">
              {config.region === 'NOT SET' ?
                '❌ Environment variable not loaded' :
                '✅ Loaded correctly'
              }
            </p>
          </div>

          <div className="mt-8 p-4 bg-blue-50 rounded">
            <h3 className="font-bold text-blue-900 mb-2">Expected Values:</h3>
            <ul className="text-sm space-y-1 text-blue-800">
              <li>• User Pool ID: ca-central-1_JPXdswqHE</li>
              <li>• Client ID: 6vogmhkao3godccmj0o91ker0a</li>
              <li>• Region: ca-central-1</li>
            </ul>
          </div>

          <div className="mt-4 p-4 bg-yellow-50 rounded">
            <h3 className="font-bold text-yellow-900 mb-2">If values show "NOT SET":</h3>
            <ul className="text-sm space-y-1 text-yellow-800">
              <li>• Local: Restart dev server to load .env.local changes</li>
              <li>• Production: Verify environment variables in AWS Amplify Console</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex gap-4">
          <a
            href="/login"
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Go to Login Page
          </a>
          <a
            href="/"
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Go to Home
          </a>
        </div>
      </div>
    </div>
  );
}
