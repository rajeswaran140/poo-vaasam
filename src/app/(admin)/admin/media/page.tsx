'use client';

/**
 * Media Library Page
 *
 * Manage images, audio files, and other media
 */

import Link from 'next/link';
import { Image, Music, Upload, Folder } from 'lucide-react';

export default function MediaLibraryPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Folder className="w-8 h-8 text-purple-600" />
              <h1 className="text-3xl font-bold text-gray-900">Media Library</h1>
            </div>
            <p className="text-gray-600">Manage images, audio files, and media assets</p>
          </div>
          <button className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Media
          </button>
        </div>
      </div>

      {/* Media Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Images */}
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Image className="w-6 h-6" />
                <p className="text-blue-100">Images</p>
              </div>
              <p className="text-4xl font-bold">0</p>
              <p className="text-sm text-blue-100 mt-2">Total size: 0 MB</p>
            </div>
          </div>
        </div>

        {/* Audio Files */}
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Music className="w-6 h-6" />
                <p className="text-green-100">Audio Files</p>
              </div>
              <p className="text-4xl font-bold">0</p>
              <p className="text-sm text-green-100 mt-2">Total size: 0 MB</p>
            </div>
          </div>
        </div>

        {/* Total Storage */}
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Folder className="w-6 h-6" />
                <p className="text-purple-100">Total Storage</p>
              </div>
              <p className="text-4xl font-bold">0 MB</p>
              <p className="text-sm text-purple-100 mt-2">of 10 GB used</p>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Zone (Placeholder) */}
      <div className="bg-white rounded-lg shadow-sm p-12">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">
            Drag and drop files here
          </h3>
          <p className="text-gray-500 mb-4">
            or click to browse from your computer
          </p>
          <button className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
            Select Files
          </button>
          <p className="text-sm text-gray-400 mt-4">
            Supported formats: JPG, PNG, GIF, MP3, WAV (Max 10MB)
          </p>
        </div>
      </div>

      {/* Recent Uploads (Empty State) */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Recent Uploads</h2>
        <div className="text-center py-12">
          <Folder className="w-20 h-20 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">No media files yet</h3>
          <p className="text-gray-500 mb-4">
            Upload your first image or audio file to get started
          </p>
        </div>
      </div>

      {/* Development Notice */}
      <div className="bg-blue-50 border-l-4 border-blue-400 p-6 rounded-lg">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-blue-800 mb-1">Under Development</h3>
            <p className="text-blue-700 mb-3">
              Media Library functionality is currently under development. Features coming soon:
            </p>
            <ul className="list-disc list-inside space-y-1 text-blue-700 mb-3">
              <li>Drag-and-drop file upload to AWS S3</li>
              <li>Image resizing and optimization</li>
              <li>Gallery view with thumbnails</li>
              <li>Search and filter by file type</li>
              <li>Bulk delete and organize</li>
              <li>Direct integration with content forms</li>
            </ul>
            <Link
              href="/admin"
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
