'use client';

/**
 * Settings Page
 *
 * Admin settings and configuration
 */

import Link from 'next/link';
import { Settings as SettingsIcon, Database, Shield, Bell, Globe } from 'lucide-react';
import { FontsReference } from '@/components/admin/FontsReference';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center gap-3 mb-2">
          <SettingsIcon className="w-8 h-8 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        </div>
        <p className="text-gray-600">Manage your Tamil content platform settings</p>
      </div>

      {/* Settings Categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* General Settings */}
        <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-purple-500">
          <div className="flex items-center gap-3 mb-4">
            <Globe className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-semibold text-gray-900">General Settings</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Configure site name, logo, and basic information
          </p>
          <div className="space-y-3 text-sm text-gray-500">
            <div>• Site Title: <span className="font-tamil">தமிழகவல்</span></div>
            <div>• Default Language: Tamil (ta)</div>
            <div>• Time Zone: Asia/Kolkata</div>
          </div>
          <button className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
            Coming Soon
          </button>
        </div>

        {/* Database Settings */}
        <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-blue-500">
          <div className="flex items-center gap-3 mb-4">
            <Database className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">Database</h2>
          </div>
          <p className="text-gray-600 mb-4">
            DynamoDB configuration and backup settings
          </p>
          <div className="space-y-3 text-sm text-gray-500">
            <div>• Table: TamilWebContent</div>
            <div>• Region: ca-central-1</div>
            <div>• Read Capacity: On-demand</div>
          </div>
          <button className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
            Coming Soon
          </button>
        </div>

        {/* Security Settings */}
        <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-red-500">
          <div className="flex items-center gap-3 mb-4">
            <Shield className="w-6 h-6 text-red-600" />
            <h2 className="text-xl font-semibold text-gray-900">Security</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Authentication and authorization settings
          </p>
          <div className="space-y-3 text-sm text-gray-500">
            <div>• Auth Provider: AWS Cognito</div>
            <div>• User Pool: ca-central-1_JPXdswqHE</div>
            <div>• MFA: Disabled</div>
          </div>
          <button className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
            Coming Soon
          </button>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-lg shadow-sm p-6 border-l-4 border-green-500">
          <div className="flex items-center gap-3 mb-4">
            <Bell className="w-6 h-6 text-green-600" />
            <h2 className="text-xl font-semibold text-gray-900">Notifications</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Email and system notification preferences
          </p>
          <div className="space-y-3 text-sm text-gray-500">
            <div>• Email Notifications: Enabled</div>
            <div>• New Content Alerts: Enabled</div>
            <div>• Comment Moderation: Enabled</div>
          </div>
          <button className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
            Coming Soon
          </button>
        </div>
      </div>

      {/* Tamil Fonts Reference */}
      <FontsReference />

      {/* Development Notice */}
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 rounded-lg">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-6 h-6 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-yellow-800 mb-1">Under Development</h3>
            <p className="text-yellow-700">
              Settings functionality is currently under development. You can view current configuration
              but cannot modify settings yet. Check back soon for updates!
            </p>
            <Link
              href="/admin"
              className="inline-block mt-3 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
