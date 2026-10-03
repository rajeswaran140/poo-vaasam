/**
 * /admin/suno-prompts — the OLD address of the prompts page.
 *
 * The admin names the song source as TamilAgaval Music (2026-10-03), so the
 * page moved to /admin/music-prompts. This keeps bookmarks and old links
 * working rather than leaving them on a 404.
 */

import { redirect } from 'next/navigation';

export default function OldSunoPromptsPage() {
  redirect('/admin/music-prompts');
}
