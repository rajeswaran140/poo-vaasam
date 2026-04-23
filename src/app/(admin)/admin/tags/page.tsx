/**
 * Tag Management Page
 *
 * Manage content tags
 */

'use client';

import { useState, useEffect } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import showToast from '@/lib/toast';

export default function TagsPage() {
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [tagName, setTagName] = useState('');
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; tagId: string; tagName: string }>({
    isOpen: false,
    tagId: '',
    tagName: '',
  });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadTags();
  }, []);

  async function loadTags() {
    try {
      const response = await fetch('/api/test/content?action=tags', {
        credentials: 'include', // Send cookies for authentication
      });
      const data = await response.json();
      if (data.success) {
        setTags(data.data);
      }
    } catch (error) {
      console.error('Failed to load tags:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    try {
      const response = await fetch('/api/test/content', {
        method: 'POST',
        credentials: 'include', // Send cookies for authentication
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-tag',
          name: tagName,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showToast.success('குறிச்சொல் வெற்றிகரமாக உருவாக்கப்பட்டது!');
        setTagName('');
        setShowForm(false);
        loadTags();
      } else {
        showToast.error('குறிச்சொல்லை உருவாக்க முடியவில்லை');
      }
    } catch (error) {
      console.error('Error:', error);
      showToast.error('குறிச்சொல்லை உருவாக்க முடியவில்லை');
    }
  }

  async function handleDeleteTag() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/test/content?action=delete-tag&id=${deleteModal.tagId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success) {
        showToast.success('குறிச்சொல் நீக்கப்பட்டது!');
        setDeleteModal({ isOpen: false, tagId: '', tagName: '' });
        loadTags();
      } else {
        showToast.error('குறிச்சொல்லை நீக்க முடியவில்லை');
      }
    } catch (error) {
      console.error('Error deleting tag:', error);
      showToast.error('குறிச்சொல்லை நீக்க முடியவில்லை');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tags</h1>
          <p className="text-gray-500 mt-1">Label your content</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
        >
          {showForm ? 'Cancel' : '+ New Tag'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold text-gray-900">
            Create New Tag
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tag Name (குறிச்சொல் பெயர்) *
            </label>
            <input
              type="text"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              required
              placeholder="காதல்"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 font-tamil text-lg"
            />
            <p className="text-sm text-gray-500 mt-1">
              Enter a single word or phrase
            </p>
          </div>

          <button
            type="submit"
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            Create Tag
          </button>
        </form>
      )}

      {/* Tags List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : tags.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-6xl mb-4">🏷️</div>
            <p className="text-lg">No tags yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              Create First Tag
            </button>
          </div>
        ) : (
          <div className="p-6">
            <div className="flex flex-wrap gap-3">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="group relative inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-full hover:from-purple-600 hover:to-purple-700 transition-all shadow-sm"
                >
                  <span className="font-tamil font-medium">#{tag.name}</span>
                  <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-semibold">
                    {tag.contentCount || 0}
                  </span>
                  <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setDeleteModal({ isOpen: true, tagId: tag.id, tagName: tag.name })}
                      className="w-6 h-6 bg-red-500 rounded-full text-white text-xs hover:bg-red-600 transition-colors"
                      title="Delete tag"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Tag Details
              </h3>
              <div className="space-y-2">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center justify-between py-2 px-4 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <span className="font-tamil font-medium text-gray-900">
                        {tag.name}
                      </span>
                      <span className="text-sm text-gray-500 ml-2">
                        (slug: {tag.slug})
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {tag.contentCount || 0} items
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, tagId: '', tagName: '' })}
        onConfirm={handleDeleteTag}
        title="Delete Tag?"
        message={`நீங்கள் "${deleteModal.tagName}" குறிச்சொல்லை நிரந்தரமாக நீக்க விரும்புகிறீர்களா? இந்த செயலை மாற்ற முடியாது.`}
        confirmText="Delete Tag"
        cancelText="Cancel"
        isDangerous={true}
        isLoading={deleting}
      />
    </div>
  );
}
