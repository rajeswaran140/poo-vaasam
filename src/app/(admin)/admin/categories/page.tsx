/**
 * Category Management Page
 *
 * Manage content categories
 */

'use client';

import { useState, useEffect } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { adminFetch } from '@/lib/client-auth';
import showToast from '@/lib/toast';

/** A content category — only the fields this page renders. */
interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  description?: string;
  contentCount?: number;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinguishes "load failed" (e.g. expired session) from a genuine "no
  // categories" empty state — otherwise a 401 looks like an empty list.
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; categoryId: string; categoryName: string }>({
    isOpen: false,
    categoryId: '',
    categoryName: '',
  });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadCategories();
  }, []);

  async function loadCategories() {
    try {
      // adminFetch attaches the fresh Cognito Bearer token (the cookie token is
      // often stale) and recovers from a 401 by bouncing to re-login — a plain
      // cookie-only fetch would silently 401 and look like an empty list.
      const response = await adminFetch('/api/categories');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to load categories');
      setCategories(data.data);
      setLoadError(false);
    } catch (error) {
      console.error('Failed to load categories:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    try {
      const response = await adminFetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        showToast.success('Category created successfully');
        setFormData({ name: '', description: '' });
        setShowForm(false);
        loadCategories();
      } else {
        // Surface the API's reason (e.g. a category that "already exists").
        showToast.error(data.error || 'Failed to create category');
      }
    } catch (error) {
      console.error('Error:', error);
      showToast.error('Failed to create category');
    }
  }

  async function handleDeleteCategory() {
    setDeleting(true);
    try {
      const response = await adminFetch(`/api/categories?id=${encodeURIComponent(deleteModal.categoryId)}`, {
        method: 'DELETE',
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        showToast.success('Category deleted');
        setDeleteModal({ isOpen: false, categoryId: '', categoryName: '' });
        loadCategories();
      } else {
        showToast.error(data.error || 'Failed to delete category');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
      showToast.error('Failed to delete category');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Categories</h1>
          <p className="text-gray-500 mt-1 dark:text-gray-400">Organize your content</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
        >
          {showForm ? 'Cancel' : '+ New Category'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4 dark:bg-gray-900 dark:border-gray-800"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Create New Category
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">
              Category Name (வகை பெயர்) *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              required
              placeholder="தமிழ் பாடல்கள்"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 font-tamil text-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">
              Description (விளக்கம்)
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              rows={3}
              placeholder="தமிழ் திரைப்பட பாடல்கள்"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 font-tamil dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <button
            type="submit"
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            Create Category
          </button>
        </form>
      )}

      {/* Categories List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        {loading ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</div>
        ) : loadError ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <div className="text-6xl mb-4">⚠️</div>
            <p className="text-lg">Could not load categories</p>
            <p className="text-sm mt-1">Your session may have expired. Try reloading.</p>
          </div>
        ) : categories.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <div className="text-6xl mb-4">📚</div>
            <p className="text-lg">No categories yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              Create First Category
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
            {categories.map((category) => (
              <div
                key={category.id}
                className="group relative border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow dark:border-gray-800"
              >
                <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setDeleteModal({ isOpen: true, categoryId: category.id, categoryName: category.name })}
                    className="w-6 h-6 bg-red-500 rounded-full text-white text-xs hover:bg-red-600 transition-colors"
                    title="Delete category"
                    aria-label={`Delete ${category.name}`}
                  >
                    ×
                  </button>
                </div>
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg font-semibold text-gray-900 font-tamil dark:text-gray-100">
                    {category.name}
                  </h3>
                  <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full dark:bg-purple-500/20 dark:text-purple-300">
                    {category.contentCount || 0}
                  </span>
                </div>
                <p className="text-sm text-gray-600 font-tamil mb-3 dark:text-gray-400">
                  {category.description}
                </p>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Slug: {category.slug}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, categoryId: '', categoryName: '' })}
        onConfirm={handleDeleteCategory}
        title="Delete Category?"
        message={`நீங்கள் "${deleteModal.categoryName}" வகையை நிரந்தரமாக நீக்க விரும்புகிறீர்களா? இந்த செயலை மாற்ற முடியாது.`}
        confirmText="Delete Category"
        cancelText="Cancel"
        isDangerous={true}
        isLoading={deleting}
      />
    </div>
  );
}
