'use client';

/**
 * Error Boundary for Admin Routes
 *
 * Catches errors in admin pages and provides recovery UI
 */

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AdminError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log error to monitoring service (e.g., Sentry, DataDog)
    console.error('Admin Error:', error);

    // You can add error reporting here
    // Example: reportError({ error, context: 'admin-panel' });
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Error Card */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Error Header */}
          <div className="bg-gradient-to-r from-red-500 to-red-600 p-8 text-white">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 p-4 rounded-full">
                <AlertTriangle className="w-12 h-12" />
              </div>
              <div>
                <h1 className="text-3xl font-bold mb-2">Oops! Something went wrong</h1>
                <p className="text-red-100">
                  We encountered an error in the admin panel
                </p>
              </div>
            </div>
          </div>

          {/* Error Details */}
          <div className="p-8">
            <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-lg mb-6">
              <h3 className="font-semibold text-red-800 mb-2">Error Details:</h3>
              <p className="text-red-700 font-mono text-sm break-all">
                {error.message || 'Unknown error occurred'}
              </p>
              {error.digest && (
                <p className="text-red-600 text-xs mt-2">
                  Error ID: {error.digest}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={reset}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold"
              >
                <RefreshCw className="w-5 h-5" />
                Try Again
              </button>

              <Link
                href="/admin"
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-semibold"
              >
                <Home className="w-5 h-5" />
                Go to Dashboard
              </Link>
            </div>

            {/* Help Section */}
            <div className="mt-8 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold text-gray-900 mb-2">What can you do?</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 font-bold">•</span>
                  <span>Click <strong>Try Again</strong> to retry the action</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 font-bold">•</span>
                  <span>Go back to <strong>Dashboard</strong> and try a different action</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 font-bold">•</span>
                  <span>If the problem persists, refresh the page</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-600 font-bold">•</span>
                  <span>Check your internet connection</span>
                </li>
              </ul>
            </div>

            {/* Debug Info (Development Only) */}
            {process.env.NODE_ENV === 'development' && (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Show Stack Trace (Development Only)
                </summary>
                <pre className="mt-2 p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto text-xs">
                  {error.stack || 'No stack trace available'}
                </pre>
              </details>
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-8 py-4 border-t border-gray-200">
            <p className="text-sm text-gray-600 text-center">
              This error has been logged. Our team will investigate if it continues to occur.
            </p>
          </div>
        </div>

        {/* Tamil Branding */}
        <div className="text-center mt-6">
          <p className="text-gray-500 font-tamil">
            © 2026 தமிழகவல் - Admin Dashboard
          </p>
        </div>
      </div>
    </div>
  );
}
