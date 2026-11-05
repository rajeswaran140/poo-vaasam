/**
 * FakeVideoProvider — permanent test double (spec 6.1). Costs nothing and
 * needs no credential.
 *
 * STATELESS by design: submit and poll normally run in different calls, and
 * on different Lambda containers, so no instance state may carry a task.
 * poll() receives only the id and cannot rewrite it, so the id encodes
 * `fake-task-<createdAtMs>-<durationMs>-<nonce>` and poll() is a pure
 * function of (id, now): elapsed < duration/2 -> pending, < duration ->
 * running, otherwise succeeded. Tests inject `now`/`durationMs`.
 */
import type {
  PollResult,
  SubmitResult,
  VideoGenRequest,
  VideoGenerationProvider,
} from './types';

export const FAKE_PROVIDER_ID = 'fake';

export interface FakeVideoProviderOptions {
  /** Total simulated generation time in ms (default 3000; 0 = done at once). */
  durationMs?: number;
  /** Clock, injectable for deterministic tests. */
  now?: () => number;
}

const ID_RE = /^fake-task-(\d+)-(\d+)-[a-z0-9]+$/;

export class FakeVideoProvider implements VideoGenerationProvider {
  readonly id = FAKE_PROVIDER_ID;
  readonly model = 'fake-video-1';
  private readonly durationMs: number;
  private readonly now: () => number;

  constructor(opts: FakeVideoProviderOptions = {}) {
    this.durationMs = Math.max(0, opts.durationMs ?? 3000);
    this.now = opts.now ?? Date.now;
  }

  async isConfigured(): Promise<boolean> {
    return true;
  }

  estimateCostUsd(_req: VideoGenRequest): number {
    return 0;
  }

  async submit(_req: VideoGenRequest): Promise<SubmitResult> {
    const nonce = Math.random().toString(36).slice(2, 10) || 'x';
    const providerTaskId = `fake-task-${this.now()}-${this.durationMs}-${nonce}`;
    return { ok: true, providerTaskId, estimatedCostUsd: 0 };
  }

  async poll(providerTaskId: string): Promise<PollResult> {
    const m = ID_RE.exec(providerTaskId);
    if (!m) return { ok: false, code: 'bad_response', error: 'Unknown task' };
    const createdAt = Number(m[1]);
    const duration = Number(m[2]);
    const elapsed = this.now() - createdAt;
    if (elapsed < duration / 2) return { ok: true, state: 'pending' };
    if (elapsed < duration) return { ok: true, state: 'running' };
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

  /** Stateless: nothing to cancel; the caller stops polling. */
  async cancel(_providerTaskId: string): Promise<void> {}
}
