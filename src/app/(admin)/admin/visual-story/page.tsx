'use client';

/** /admin/visual-story — stories list + "New from master". */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/client-auth';
import { StoryList, type StoryRow } from '@/components/admin/visual-story/StoryList';
import { NewStoryForm } from '@/components/admin/visual-story/NewStoryForm';

export default function VisualStoryListPage() {
  const router = useRouter();
  const [stories, setStories] = useState<StoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminFetch('/api/admin/visual-story');
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) throw new Error(body?.error || 'Could not load your stories.');
        setStories(body.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your stories.');
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Visual Story Studio</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Storyboard and generate music videos</p>
      </header>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {stories === null && !error ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading stories…</p> : stories && <StoryList stories={stories} />}
      <NewStoryForm onCreated={(vsId) => router.push(`/admin/visual-story/${vsId}`)} />
    </div>
  );
}
