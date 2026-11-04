/**
 * FakeVideoProvider — permanent test double (spec 6.1). Costs nothing and
 * needs no credential. Each task reports `pending`, then `running` (for any
 * remaining polls), then `succeeded` once `pollsUntilDone` polls have
 * returned a non-terminal state.
 */
import type {
  PollResult,
  SubmitResult,
  VideoGenRequest,
  VideoGenerationProvider,
} from './types';

export const FAKE_PROVIDER_ID = 'fake';

export interface FakeVideoProviderOptions {
  /** Non-terminal polls before success (default 2: pending, running). */
  pollsUntilDone?: number;
}

export class FakeVideoProvider implements VideoGenerationProvider {
  readonly id = FAKE_PROVIDER_ID;
  readonly model = 'fake-video-1';
  private readonly pollsUntilDone: number;
  private readonly polls = new Map<string, number>();
  private counter = 0;

  constructor(opts: FakeVideoProviderOptions = {}) {
    this.pollsUntilDone = Math.max(0, opts.pollsUntilDone ?? 2);
  }

  async isConfigured(): Promise<boolean> {
    return true;
  }

  estimateCostUsd(_req: VideoGenRequest): number {
    return 0;
  }

  async submit(_req: VideoGenRequest): Promise<SubmitResult> {
    const providerTaskId = `fake-task-${++this.counter}`;
    this.polls.set(providerTaskId, 0);
    return { ok: true, providerTaskId, estimatedCostUsd: 0 };
  }

  async poll(providerTaskId: string): Promise<PollResult> {
    const n = this.polls.get(providerTaskId);
    if (n === undefined) {
      return { ok: false, code: 'bad_response', error: 'Unknown task' };
    }
    if (n < this.pollsUntilDone) {
      this.polls.set(providerTaskId, n + 1);
      return { ok: true, state: n === 0 ? 'pending' : 'running' };
    }
    return {
      ok: true,
      state: 'succeeded',
      assets: [
        {
          kind: 'video',
          url: `https://fake.invalid/${providerTaskId}.mp4`,
          contentType: 'video/mp4',
        },
      ],
      actualCostUsd: 0,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    this.polls.delete(providerTaskId);
  }
}
