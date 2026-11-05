/**
 * Video generation provider port — the model-agnostic seam (spec section 6).
 * Modelled on the ComposerEngine port; adapters live beside this file.
 */
import type { AspectRatio, ShotMode } from '@/types/visualStory';

export type VideoErrorCode =
  | 'not_configured'   // credential missing or placeholder
  | 'auth'             // credential present but rejected
  | 'rate_limit'       // provider 429 / quota exhausted
  | 'upstream'         // any other API or network failure, incl. timeout
  | 'bad_response'     // call succeeded but returned nothing usable
  | 'content_policy'   // provider refused the prompt
  | 'billing';         // provider account is out of credit

export interface VideoGenRequest {
  prompt: string;
  negativePrompt?: string;
  mode: ShotMode;
  durationSec: number;
  aspectRatio: AspectRatio;
  referenceImageUrls?: string[];   // short-lived signed S3 URLs
  firstFrameUrl?: string;          // a STILL candidate pinned as the opening frame
  seed?: number;
  signal?: AbortSignal;
}

export interface ProviderAsset {
  kind: 'video' | 'poster';
  url: string;                     // provider-hosted, expiring
  contentType: string;
}

export type SubmitResult =
  | { ok: true; providerTaskId: string; estimatedCostUsd: number }
  | { ok: false; code: VideoErrorCode; error: string };

export type PollResult =
  | { ok: true; state: 'pending' | 'running' }
  | { ok: true; state: 'succeeded'; assets: ProviderAsset[]; actualCostUsd: number | null }
  | { ok: true; state: 'failed'; code: VideoErrorCode; error: string; billed: boolean }
  | { ok: false; code: VideoErrorCode; error: string };

export interface VideoGenerationProvider {
  readonly id: string;
  readonly model: string;
  isConfigured(): Promise<boolean>;
  estimateCostUsd(req: VideoGenRequest): number;
  submit(req: VideoGenRequest): Promise<SubmitResult>;
  poll(providerTaskId: string): Promise<PollResult>;
  cancel?(providerTaskId: string): Promise<void>;
}
