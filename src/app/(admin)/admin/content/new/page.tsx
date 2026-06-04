/**
 * Create New Content Page
 *
 * Form to create new Tamil content
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TamilInput } from '@/components/admin/TamilInput';
import { MediaUploadField } from '@/components/admin/MediaUploadField';
import { adminFetch } from '@/lib/client-auth';
import { getYouTubeId } from '@/lib/utils/youtube';
import { WORKFLOW_STATES, WORKFLOW_LABELS } from '@/types/content';

// Small reusable input for the Studio asset URLs.
function AssetInput({ name, label, placeholder, value, onChange }: {
  name: string; label: string; placeholder: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        type="url"
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
    </div>
  );
}
import { Music, Feather, Mic, BookOpen, PenTool, Star } from 'lucide-react';
import { FEATURES } from '@/config/features';
import showToast from '@/lib/toast';

/** A selectable category/tag — only the fields this form renders. */
interface TaxonomyOption {
  id: string;
  name: string;
}

export default function NewContentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<TaxonomyOption[]>([]);
  const [tags, setTags] = useState<TaxonomyOption[]>([]);
  // True when the categories/tags load failed (e.g. an expired session), so the
  // panels show an actionable message instead of an endless "Loading…".
  const [dataError, setDataError] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    type: 'SONGS',
    title: '',
    body: '',
    description: '',
    author: '',
    status: 'PUBLISHED',
    categoryIds: [] as string[],
    tagIds: [] as string[],
    featuredImage: '',
    audioUrl: '',
    videoUrl: '',
    previewVideoUrl: '',
    youtubeVideoId: '',
    wavUrl: '',
    stemsUrl: '',
    midiUrl: '',
    thumbnailUrl: '',
    workflowState: '',
    audioDuration: 0,
    seoTitle: '',
    seoDescription: '',
  });

  // Load categories and tags
  useEffect(() => {
    async function loadData() {
      try {
        // adminFetch attaches the fresh Cognito Bearer token (the cookie token
        // is often stale) and triggers re-login on 401 — both endpoints require
        // auth, so a plain cookie-only fetch would silently 401 and leave these
        // panels stuck on "Loading…".
        const [categoriesRes, tagsRes] = await Promise.all([
          adminFetch('/api/categories'),
          adminFetch('/api/tags'),
        ]);

        if (!categoriesRes.ok || !tagsRes.ok) {
          throw new Error(`categories ${categoriesRes.status} / tags ${tagsRes.status}`);
        }

        const categoriesData = await categoriesRes.json();
        const tagsData = await tagsRes.json();

        if (categoriesData.success) setCategories(categoriesData.data);
        if (tagsData.success) setTags(tagsData.data);
      } catch (error) {
        console.error('Failed to load data:', error);
        setDataError(true);
      }
    }
    loadData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await adminFetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success) {
        showToast.success('உள்ளடக்கம் வெற்றிகரமாக உருவாக்கப்பட்டது!');
        router.push('/admin/content');
      } else {
        showToast.error('உருவாக்க முடியவில்லை: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error creating content:', error);
      showToast.error('உள்ளடக்கத்தை உருவாக்க முடியவில்லை');
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
            <p className="text-gray-500">
              {dataError
                ? 'Could not load categories — your session may have expired. Try reloading.'
                : 'Loading categories...'}
            </p>
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
            <p className="text-gray-500">
              {dataError
                ? 'Could not load tags — your session may have expired. Try reloading.'
                : 'Loading tags...'}
            </p>
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

          <MediaUploadField
            kind="audio"
            label="Audio File (song)"
            value={formData.audioUrl}
            onChange={(url) => setFormData((prev) => ({ ...prev, audioUrl: url }))}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Audio Duration (seconds)
            </label>
            <input
              type="number"
              name="audioDuration"
              min={0}
              // A number input's onChange value is a string; store it as a
              // number so the API's numeric schema accepts it (otherwise the
              // whole create 400s on "Validation failed").
              value={formData.audioDuration || ''}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  audioDuration: e.target.value === '' ? 0 : Number(e.target.value),
                }))
              }
              placeholder="180"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <MediaUploadField
            kind="video"
            label="Preview Video (short clip)"
            value={formData.previewVideoUrl}
            onChange={(url) => setFormData((prev) => ({ ...prev, previewVideoUrl: url }))}
            helpText="Short teaser clip played on the page. Keep the full video on YouTube and link it below."
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Full Video — YouTube link (முழு காணொளி)
            </label>
            <input
              type="url"
              name="videoUrl"
              value={formData.videoUrl}
              onChange={(e) => {
                const url = e.target.value;
                // Auto-derive the canonical ID from the URL whenever the
                // dedicated field is still empty — so paste-and-save just works.
                setFormData((prev) => ({
                  ...prev,
                  videoUrl: url,
                  youtubeVideoId: prev.youtubeVideoId || getYouTubeId(url) || '',
                }));
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Viewers watching the preview are sent here for the full video — promoting the website and your YouTube channel.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              YouTube Video ID
            </label>
            <input
              type="text"
              name="youtubeVideoId"
              value={formData.youtubeVideoId}
              onChange={handleChange}
              placeholder="dQw4w9WgXcQ"
              pattern="[A-Za-z0-9_\-]{11}"
              maxLength={11}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              The 11-char ID from the YouTube URL (auto-filled when you paste a link above). Used by{' '}
              <code>/admin/youtube</code> to match channel uploads to this content with zero ambiguity.
            </p>
          </div>

          {/* Studio asset library — Phase 1 of the AI Studio roadmap */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AssetInput name="wavUrl" label="WAV (master)" placeholder="https://… .wav" value={formData.wavUrl} onChange={handleChange} />
            <AssetInput name="stemsUrl" label="Stems (zip)" placeholder="https://… stems.zip" value={formData.stemsUrl} onChange={handleChange} />
            <AssetInput name="midiUrl" label="MIDI" placeholder="https://… .mid" value={formData.midiUrl} onChange={handleChange} />
            <AssetInput name="thumbnailUrl" label="Thumbnail (1280×720)" placeholder="https://… thumb.jpg" value={formData.thumbnailUrl} onChange={handleChange} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Workflow state</label>
            <select
              name="workflowState"
              value={formData.workflowState}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">— (inferred from status)</option>
              {WORKFLOW_STATES.map((s) => (
                <option key={s} value={s}>{WORKFLOW_LABELS[s]}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Optional. If left blank, the workflow kanban places PUBLISHED items in <em>Live</em> and everything else in <em>Draft</em>.
            </p>
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
