import { Studio } from '@/components/admin/visual-story/Studio';

/** /admin/visual-story/[vsId] — the studio for one visual story. */
export default async function VisualStoryStudioPage({ params }: { params: Promise<{ vsId: string }> }) {
  const { vsId } = await params;
  return <Studio vsId={vsId} />;
}
