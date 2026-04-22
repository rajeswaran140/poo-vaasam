/**
 * Create New Content Page
 *
 * Form to create new Tamil content
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TamilInput } from '@/components/admin/TamilInput';
import { Music, Feather, Mic, BookOpen, PenTool, Star } from 'lucide-react';
import { FEATURES } from '@/config/features';

export default function NewContentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);

  // Form state
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
    seoTitle: '',
    seoDescription: '',
  });

  // Load categories and tags
  useEffect(() => {
    async function loadData() {
      try {
        const [categoriesRes, tagsRes] = await Promise.all([
          fetch('/api/test/content?action=categories'),
          fetch('/api/test/content?action=tags'),
        ]);

        const categoriesData = await categoriesRes.json();
        const tagsData = await tagsRes.json();

        if (categoriesData.success) setCategories(categoriesData.data);
        if (tagsData.success) setTags(tagsData.data);
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    }
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/test/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-content',
          ...formData,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert('✅ Content created successfully!');
        router.push('/admin/content');
      } else {
        alert('❌ Failed to create content: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error creating content:', error);
      alert('❌ Failed to create content');
    } finally {
      setLoading(false);
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

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Create New Content</h1>
        <p className="text-gray-500 mt-1">
          Add new Tamil content to your platform
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Content Type */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Content Type
          </h2>
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
                <div className="mb-2 flex justify-center">
                  {type === 'SONGS' && <Music className="w-8 h-8" />}
                  {type === 'POEMS' && <Feather className="w-8 h-8" />}
                  {type === 'LYRICS' && <Mic className="w-8 h-8" />}
                  {type === 'STORIES' && <BookOpen className="w-8 h-8" />}
                  {type === 'ESSAYS' && <PenTool className="w-8 h-8" />}
                </div>
                <div className="text-sm font-medium">{type}</div>
              </button>
            ))}
          </div>
          {formData.type === 'POEMS' && (
            <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg flex items-start gap-2">
              <Star className="w-5 h-5 mt-0.5" />
              <p className="text-sm text-purple-700 font-tamil">
                <strong>Poem Mode:</strong> Your title and content will use the beautiful Baloo Thambi 2 font for an artistic poetry display!
              </p>
            </div>
          )}
        </div>

        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Basic Information
          </h2>

          <TamilInput
            label="Title (தலைப்பு)"
            value={formData.title}
            onChange={(value) => setFormData({ ...formData, title: value })}
            placeholder="Type: vanakkam, poo, tamil"
            className={formData.type === 'POEMS' ? 'poem-title' : ''}
            required
          />

          <TamilInput
            label="Content (உள்ளடக்கம்)"
            value={formData.body}
            onChange={(value) => setFormData({ ...formData, body: value })}
            placeholder="Type your lyrics, poem, or story..."
            className={formData.type === 'POEMS' ? 'poem-text' : ''}
            multiline
            rows={12}
            required
          />

          <TamilInput
            label="Description (விளக்கம்)"
            value={formData.description}
            onChange={(value) => setFormData({ ...formData, description: value })}
            placeholder="Brief description about this content"
            multiline
            rows={3}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <TamilInput
                label="Author (ஆசிரியர்)"
                value={formData.author}
                onChange={(value) => setFormData({ ...formData, author: value })}
                placeholder="Type: ilaiyaraaja, kannadasan"
                required
              />
            </div>

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
                <option value="DRAFT">Draft (வரைவு)</option>
                <option value="PUBLISHED">Published (வெளியிடப்பட்டது)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Categories (வகைகள்)
          </h2>
          {categories.length === 0 ? (
            <p className="text-gray-500">Loading categories...</p>
          ) : (
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
          )}
        </div>

        {/* Tags */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Tags (குறிச்சொற்கள்)
          </h2>
          {tags.length === 0 ? (
            <p className="text-gray-500">Loading tags...</p>
          ) : (
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
          )}
        </div>

        {/* Media */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Media (ஊடகம்)
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Featured Image URL
            </label>
            <input
              type="text"
              name="featuredImage"
              value={formData.featuredImage}
              onChange={handleChange}
              placeholder="https://example.com/image.jpg"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional: Enter image URL or upload to S3 first
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Audio File URL
              </label>
              <input
                type="text"
                name="audioUrl"
                value={formData.audioUrl}
                onChange={handleChange}
                placeholder="https://example.com/audio.mp3"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Audio Duration (seconds)
              </label>
              <input
                type="number"
                name="audioDuration"
                value={formData.audioDuration}
                onChange={handleChange}
                placeholder="180"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
        </div>

        {/* SEO - Only shown if feature is enabled */}
        {FEATURES.ADMIN.SEO_FIELDS && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              SEO Settings
            </h2>

            <TamilInput
              label="SEO Title"
              value={formData.seoTitle}
              onChange={(value) => setFormData({ ...formData, seoTitle: value })}
              placeholder="Auto-generated from title if left empty"
            />

            <TamilInput
              label="SEO Description"
              value={formData.seoDescription}
              onChange={(value) => setFormData({ ...formData, seoDescription: value })}
              placeholder="Auto-generated from description if left empty"
              multiline
              rows={2}
          />
          </div>
        )}

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
            disabled={loading}
            className="px-8 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Content'}
          </button>
        </div>
      </form>
    </div>
  );
}
