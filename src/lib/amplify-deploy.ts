/**
 * amplify-deploy — trigger an Amplify Hosting "RELEASE" build so newly-published
 * content goes live (the public pages are generated at deploy time). Amplify's
 * CDN auto-invalidates on each deploy.
 *
 * The runtime app identity needs `amplify:StartJob` on the app's branch jobs
 * (granted out-of-band); without it the SDK call fails and triggerRelease
 * returns a non-ok result rather than throwing.
 */

import { AmplifyClient, StartJobCommand, type StartJobCommandInput } from '@aws-sdk/client-amplify';
import { awsConfig } from '@/lib/aws-config';

/** Pure builder for the StartJob input (RELEASE = redeploy the latest commit). */
export function buildStartJobInput(appId: string, branchName: string): StartJobCommandInput {
  return { appId, branchName, jobType: 'RELEASE' };
}

let client: AmplifyClient | null = null;
function getClient(): AmplifyClient {
  if (!client) {
    client = new AmplifyClient({ region: awsConfig.region, credentials: awsConfig.credentials });
  }
  return client;
}

export interface TriggerDeployResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

export async function triggerRelease(appId: string, branchName: string): Promise<TriggerDeployResult> {
  try {
    const out = await getClient().send(new StartJobCommand(buildStartJobInput(appId, branchName)));
    return { ok: true, jobId: out.jobSummary?.jobId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Trigger a release using the app id/branch from env (AMPLIFY_APP_ID /
 *  AMPLIFY_BRANCH). Best-effort: returns a non-ok result, never throws. */
export async function triggerReleaseFromEnv(): Promise<TriggerDeployResult> {
  const appId = process.env.AMPLIFY_APP_ID;
  if (!appId) return { ok: false, error: 'AMPLIFY_APP_ID not configured' };
  return triggerRelease(appId, process.env.AMPLIFY_BRANCH || 'master');
}

/**
 * Whether a content create/update should trigger a go-live deploy. The public
 * pages are built at deploy time, so any change to what's PUBLISHED must
 * rebuild: publishing, editing a live item, or unpublishing all change the
 * static site. Pure draft work does not.
 */
export function shouldDeployForContent(wasPublished: boolean, isPublished: boolean): boolean {
  return wasPublished || isPublished;
}
