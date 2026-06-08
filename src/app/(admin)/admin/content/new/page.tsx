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
      <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">{label}</label>
      <input
        type="url"
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      />
    </div>
  );
}
import { Music, Feather, Mic, BookOpen, PenTool, Star } from 'lucide-react';
import { FEATURES } from '@/config/features';
import showToast from '@/lib/toast';
import { FIELD_LIMITS } from '@/lib/content/authoring';
import { useFormDraft } from '@/components/admin/authoring/useFormDraft';
import { useUnsavedGuard } from '@/components/admin/authoring/useUnsavedGuard';
import { DraftBanner } from '@/components/admin/authoring/DraftBanner';
import { SlugPreview } from '@/components/admin/authoring/SlugPreview';
import { TextMetricsBar } from '@/components/admin/authoring/TextMetricsBar';
import { ContentPreview } from '@/components/admin/authoring/ContentPreview';
import { SeoSnippet } from '@/components/admin/authoring/SeoSnippet';

/** A selectable category/tag — only the fields this form renders. */
interface TaxonomyOption {
  id: string;
  name: string;
}

/**
 * Build a human-readable message from an API error body. The create endpoint
 * returns Zod `fieldErrors` under `errors` on a 400 — surface them per-field so
 * the admin sees exactly what to fix instead of a generic "Unknown error".
 */
function formatApiError(data: { error?: string; errors?: Record<string, string[] | undefined> }): string {
  if (data.errors && typeof data.errors === 'object') {
    const parts = Object.entries(data.errors)
      .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
      .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`);
    if (parts.length > 0) return parts.join(' · ');
  }
  return data.error || 'Unknown error';
}

export default function NewContentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // The last submit failure, shown inline above the buttons. When the API
  // returns field-level validation errors we render them so the admin knows
  // exactly what to fix instead of a generic "Unknown error".
  const [submitError, setSubmitError] = useState<string | null>(null);
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
    // Default to DRAFT — publishing should be a deliberate choice (and on this
    // SSG site a freshly-PUBLISHED item isn't public until the next redeploy,
    // so accidental publish-on-create is a confusing footgun).
    status: 'DRAFT',
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

  // Autosave the in-progress form so a session expiry / tab close / accidental
  // navigation never loses the writer's work; warn before leaving when dirty.
  const draft = useFormDraft('new', formData, setFormData);
  useUnsavedGuard(draft.isDirty && !loading);

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
    setSubmitError(null);

    try {
      const response = await adminFetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success) {
        draft.clear(); // saved to the server — drop the local draft
        showToast.success('உள்ளடக்கம் வெற்றிகரமாக உருவாக்கப்பட்டது!');
        router.push('/admin/content');
      } else {
        const message = formatApiError(data);
        setSubmitError(message);
        showToast.error('உருவாக்க முடியவில்லை: ' + message);
      }
    } catch (error) {
      console.error('Error creating content:', error);
      const message = 'உள்ளடக்கத்தை உருவாக்க முடியவில்லை';
      setSubmitError(message);
      showToast.error(message);
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Create New Content</h1>
        <p className="text-gray-500 mt-1 dark:text-gray-400">
          Add new Tamil content to your platform
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <DraftBanner draft={draft.draftAvailable} onRestore={draft.restore} onDismiss={draft.dismiss} />

        {/* Content Type */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-gray-100">
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
                    ? 'border-purple-600 bg-purple-50 dark:border-purple-500 dark:bg-purple-950/40'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
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
            <div className="mt-4 p-3 bg-purple-50 border border-purple-200 rounded-lg flex items-start gap-2 dark:bg-purple-950/30 dark:border-purple-800">
              <Star className="w-5 h-5 mt-0.5" />
              <p className="text-sm text-purple-700 dark:text-purple-200 font-tamil">
                <strong>Poem Mode:</strong> Your title and content will use the beautiful Baloo Thambi 2 font for an artistic poetry display!
              </p>
            </div>
          )}
        </div>

        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-800 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-gray-100">
            Basic Information
          </h2>

          <div>
            <TamilInput
              label="Title (தலைப்பு)"
              value={formData.title}
              onChange={(value) => setFormData({ ...formData, title: value })}
              placeholder="Type: vanakkam, poo, tamil"
              className={formData.type === 'POEMS' ? 'poem-title' : ''}
              counterMax={FIELD_LIMITS.title}
              required
            />
            <SlugPreview title={formData.title} />
          </div>

          <div className="space-y-2">
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
            <div className="flex items-center justify-between gap-3">
              <TextMetricsBar text={formData.body} />
              <ContentPreview title={formData.title} body={formData.body} isPoem={formData.type === 'POEMS'} />
            </div>
          </div>

          <TamilInput
            label="Description (விளக்கம்)"
            value={formData.description}
            onChange={(value) => setFormData({ ...formData, description: value })}
            placeholder="Brief description about this content"
            counterMax={FIELD_LIMITS.description}
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
                counterMax={FIELD_LIMITS.author}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">
                Status *
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="DRAFT">Draft (வரைவு)</option>
                <option value="PUBLISHED">Published (வெளியிடப்பட்டது)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-gray-100">
            Categories (வகைகள்)
          </h2>
          {categories.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">
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
                      ? 'border-purple-600 bg-purple-50 dark:border-purple-500 dark:bg-purple-950/40 text-purple-700 dark:text-purple-200'
                      : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-gray-100">
            Tags (குறிச்சொற்கள்)
          </h2>
          {tags.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">
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
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Media */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-800 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-gray-100">
            Media (ஊடகம்)
          </h2>

          <MediaUploadField
            kind="audio"
            label="Audio File (song)"
            value={formData.audioUrl}
            onChange={(url) => setFormData((prev) => ({ ...prev, audioUrl: url }))}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">
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
              className="w-full px-4 py-3 border border-gray-300 rounded-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
            <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">
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
              className="w-full px-4 py-3 border border-gray-300 rounded-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1 dark:text-gray-400">
              Viewers watching the preview are sent here for the full video — promoting the website and your YouTube channel.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">
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
              className="w-full px-4 py-3 border border-gray-300 rounded-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1 dark:text-gray-400">
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
            <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">Workflow state</label>
            <select
              name="workflowState"
              value={formData.workflowState}
              onChange={handleChange}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">— (inferred from status)</option>
              {WORKFLOW_STATES.map((s) => (
                <option key={s} value={s}>{WORKFLOW_LABELS[s]}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1 dark:text-gray-400">
              Optional. If left blank, the workflow kanban places PUBLISHED items in <em>Live</em> and everything else in <em>Draft</em>.
            </p>
          </div>
        </div>

        {/* SEO - Only shown if feature is enabled */}
        {FEATURES.ADMIN.SEO_FIELDS && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-800 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-gray-100">
              SEO Settings
            </h2>

            <TamilInput
              label="SEO Title"
              value={formData.seoTitle}
              onChange={(value) => setFormData({ ...formData, seoTitle: value })}
              placeholder="Auto-generated from title if left empty"
              counterMax={FIELD_LIMITS.seoTitle}
            />

            <TamilInput
              label="SEO Description"
              value={formData.seoDescription}
              onChange={(value) => setFormData({ ...formData, seoDescription: value })}
              placeholder="Auto-generated from description if left empty"
              counterMax={FIELD_LIMITS.seoDescription}
              multiline
              rows={2}
          />

            <SeoSnippet
              title={formData.title}
              description={formData.description}
              seoTitle={formData.seoTitle}
              seoDescription={formData.seoDescription}
            />
          </div>
        )}

        {/* Inline submit error — field-level when the API returns validation details */}
        {submitError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
          >
            {submitError}
          </div>
        )}

        {/* Submit Buttons */}
        <div className="flex items-center justify-between bg-white rounded-lg shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-800">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-3 border border-gray-300 rounded-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-4">
            {draft.savedAt && (
              <span className="text-xs text-gray-400 dark:text-gray-500" aria-live="polite">
                Draft saved ✓
              </span>
            )}
            <button
              type="submit"
              disabled={loading}
              className="px-8 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Create Content'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
