/**
 * Edit Content Page
 *
 * Edit existing Tamil content
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TamilInput } from '@/components/admin/TamilInput';
import showToast from '@/lib/toast';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditContentPage({ params }: PageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contentId, setContentId] = useState<string>('');
  const [categories, setCategories] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    type: 'SONGS',
    title: '',
    body: '',
    description: '',
    author: '',
    status: 'DRAFT',
    categoryIds: [] as string[],
    tagIds: [] as string[],
    featuredImage: '',
    audioUrl: '',
    audioDuration: 0,
  });

  useEffect(() => {
    async function loadData() {
      const resolvedParams = await params;
      setContentId(resolvedParams.id);

      try {
        // Load content
        const contentRes = await fetch(`/api/test/content?id=${resolvedParams.id}`, {
          credentials: 'include', // Send cookies for authentication
        });
        const contentData = await contentRes.json();

        if (contentData.success) {
          const content = contentData.data;
          setFormData({
            type: content.type,
            title: content.title,
            body: content.body,
            description: content.description || '',
            author: content.author,
            status: content.status,
            categoryIds: content.categoryIds || [],
            tagIds: content.tagIds || [],
            featuredImage: content.featuredImage || '',
            audioUrl: content.audioUrl || '',
            audioDuration: content.audioDuration || 0,
          });
        }

        // Load categories and tags
        const [categoriesRes, tagsRes] = await Promise.all([
          fetch('/api/test/content?action=categories', {
            credentials: 'include', // Send cookies for authentication
          }),
          fetch('/api/test/content?action=tags', {
            credentials: 'include', // Send cookies for authentication
          }),
        ]);

        const categoriesData = await categoriesRes.json();
        const tagsData = await tagsRes.json();

        if (categoriesData.success) setCategories(categoriesData.data);
        if (tagsData.success) setTags(tagsData.data);
      } catch (error) {
        console.error('Failed to load data:', error);
        showToast.error('உள்ளடக்கத்தை ஏற்ற முடியவில்லை');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [params]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch('/api/content', {
        method: 'PUT',
        credentials: 'include', // Send cookies for authentication
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: contentId,
          ...formData,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showToast.success('உள்ளடக்கம் வெற்றிகரமாக புதுப்பிக்கப்பட்டது!');
        router.push('/admin/content');
      } else {
        showToast.error('புதுப்பிக்க முடியவில்லை: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error updating content:', error);
      showToast.error('உள்ளடக்கத்தை புதுப்பிக்க முடியவில்லை');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const toggleCategory = (categoryId: string) => {
    setFormData((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(categoryId)
        ? prev.categoryIds.filter((id) => id !== categoryId)
        : [...prev.categoryIds, categoryId],
    }));
  };

  const toggleTag = (tagId: string) => {
    setFormData((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter((id) => id !== tagId)
        : [...prev.tagIds, tagId],
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-6xl mb-4">⏳</div>
          <p className="text-xl text-gray-600">Loading content...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Edit Content</h1>
        <p className="text-gray-500 mt-1">Update Tamil content</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Content Type */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Content Type</h2>
          <div className="grid grid-cols-5 gap-3">
            {['SONGS', 'POEMS', 'LYRICS', 'STORIES', 'ESSAYS'].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, type }))}
                className={`p-4 rounded-lg border-2 transition-all ${
                  formData.type === type
                    ? 'border-purple-600 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-2xl mb-1">
                  {type === 'SONGS' && '🎵'}
                  {type === 'POEMS' && '📝'}
                  {type === 'LYRICS' && '🎤'}
                  {type === 'STORIES' && '📖'}
                  {type === 'ESSAYS' && '✍️'}
                </div>
                <div className="text-sm font-medium">{type}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>

          <TamilInput
            value={formData.title}
            onChange={(value) => setFormData((prev) => ({ ...prev, title: value }))}
            label="Title (தலைப்பு)"
            placeholder="உள்ளடக்க தலைப்பை உள்ளிடவும்..."
            required
          />

          <TamilInput
            value={formData.body}
            onChange={(value) => setFormData((prev) => ({ ...prev, body: value }))}
            label="Content (உள்ளடக்கம்)"
            placeholder="உங்கள் உள்ளடக்கத்தை இங்கே எழுதவும்..."
            multiline
            rows={10}
            required
          />

          <TamilInput
            value={formData.description}
            onChange={(value) => setFormData((prev) => ({ ...prev, description: value }))}
            label="Description (விளக்கம்)"
            placeholder="சுருக்கமான விளக்கம்..."
            multiline
            rows={3}
          />

          <div className="grid grid-cols-2 gap-4">
            <TamilInput
              value={formData.author}
              onChange={(value) => setFormData((prev) => ({ ...prev, author: value }))}
              label="Author (ஆசிரியர்)"
              placeholder="ஆசிரியர் பெயர்..."
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Status *
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Categories</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => toggleCategory(category.id)}
                className={`px-4 py-2 rounded-lg border-2 transition-all font-tamil ${
                  formData.categoryIds.includes(category.id)
                    ? 'border-purple-600 bg-purple-50 text-purple-700'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-all font-tamil ${
                  formData.tagIds.includes(tag.id)
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                #{tag.name}
              </button>
            ))}
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="flex items-center justify-between bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-8 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Update Content'}
          </button>
        </div>
      </form>
    </div>
  );
}
