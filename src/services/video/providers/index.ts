/**
 * Video provider registry. Precedence: explicit id -> VIDEO_PROVIDER env ->
 * DEFAULT_PROVIDER_ID. Unknown ids throw. Mirrors getEngine().
 */
import { FakeVideoProvider, FAKE_PROVIDER_ID } from './fake';
import { GrokProvider } from './grok';
import type { VideoGenerationProvider } from './types';

export const GROK_PROVIDER_ID = 'grok';
export const DEFAULT_PROVIDER_ID = GROK_PROVIDER_ID;

export function getVideoProvider(id?: string): VideoGenerationProvider {
  const selected = (id || process.env.VIDEO_PROVIDER || DEFAULT_PROVIDER_ID).trim().toLowerCase();
  switch (selected) {
    case FAKE_PROVIDER_ID:
      return new FakeVideoProvider();
    case GROK_PROVIDER_ID:
      return new GrokProvider();
    default:
      throw new Error(`Unknown video provider: "${selected}"`);
  }
}

export { FAKE_PROVIDER_ID };
export type {
  VideoErrorCode,
  VideoGenRequest,
  ProviderAsset,
  SubmitResult,
  PollResult,
  VideoGenerationProvider,
} from './types';
