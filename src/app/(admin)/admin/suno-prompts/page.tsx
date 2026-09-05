/**
 * /admin/suno-prompts — build a SUNO prompt pack from a lyric and keep it.
 *
 * The compose flow already generates this pack, but only inside a job result
 * that is handed to the export pack and then lost. This page is the durable
 * home: server-rendered initial list (runtime DynamoDB via APP_AWS_* creds,
 * like /admin/lexicon), then the client studio handles generate and save.
 */

import { SunoPromptRepository } from '@/infrastructure/database/SunoPromptRepository';
import { SunoPromptStudio, type SunoPromptRow } from '@/components/admin/SunoPromptStudio';

export const dynamic = 'force-dynamic';

async function getPrompts(): Promise<SunoPromptRow[]> {
  try {
    const prompts = await new SunoPromptRepository().findAll();
    // Everything except the Dates, so the row stays a plain serialisable object
    // across the server/client boundary. Listed explicitly rather than spread so
    // a field added to the domain type has to be considered before it reaches
    // the browser.
    return prompts.map((p) => ({
      id: p.id,
      title: p.title,
      lyrics: p.lyrics,
      style: p.style,
      styleBox: p.styleBox,
      exclude: p.exclude,
      lyricsBlock: p.lyricsBlock,
      weirdness: p.weirdness,
      styleInfluence: p.styleInfluence,
      usesAudioUpload: p.usesAudioUpload,
      ...(p.audioInfluence !== undefined ? { audioInfluence: p.audioInfluence } : {}),
    }));
  } catch (e) {
    console.error('[admin/suno-prompts] load failed', e);
    return [];
  }
}

export default async function AdminSunoPromptsPage() {
  const initial = await getPrompts();
  return <SunoPromptStudio initial={initial} />;
}
