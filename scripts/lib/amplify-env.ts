/**
 * The app's runtime environment, as the deployed site sees it.
 *
 * WHY THIS EXISTS. `aws amplify get-app` returns only the PLAINTEXT
 * environment variables. Every secret the site uses — the YouTube API key, the
 * OAuth client secret, both refresh tokens — lives in SSM as a SecureString
 * under `/amplify/<appId>/<branch>/`, and Amplify injects it at build time. A
 * script reading `app.environmentVariables` alone therefore sees a partial
 * environment and fails on whichever secret it happens to need first.
 *
 * That is not hypothetical: `release-sweep.ts` — the scheduled guard against
 * YouTube re-adding wrong-language auto-caption tracks — had been dying on
 * `YOUTUBE_API_KEY missing from the Amplify env` since the secrets moved,
 * which means the sweep silently stopped running. The shell ops scripts had
 * already been updated to read SSM directly; the TypeScript ones had not.
 *
 * SSM wins over the plaintext map, so a value that exists in both resolves to
 * the secret. Nothing is written to disk — values live in memory for the life
 * of the process, exactly as they do in the worker.
 */

import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { AmplifyClient, GetAppCommand } from '@aws-sdk/client-amplify';

export const APP_ID = 'd3rkmepk4popv0';
export const APP_REGION = 'ca-central-1';

export async function amplifyEnv(
  appId = APP_ID,
  branch = 'master',
  region = APP_REGION,
): Promise<Record<string, string>> {
  const amplify = new AmplifyClient({ region });
  const app = await amplify.send(new GetAppCommand({ appId }));
  const env: Record<string, string> = { ...(app.app?.environmentVariables ?? {}) };

  const ssm = new SSMClient({ region });
  let token: string | undefined;
  do {
    const page = await ssm.send(new GetParametersByPathCommand({
      Path: `/amplify/${appId}/${branch}/`,
      WithDecryption: true,
      NextToken: token,
    }));
    for (const p of page.Parameters ?? []) {
      const name = p.Name?.split('/').pop();
      if (name && p.Value) env[name] = p.Value;
    }
    token = page.NextToken;
  } while (token);

  return env;
}

/**
 * The YouTube Data API key, from wherever it actually lives.
 *
 * ⚠️ `process.env.YOUTUBE_API_KEY` IS EMPTY ON THIS BOX. The key is an SSM
 * SecureString that Amplify injects at build time, so a script reading only
 * the process env dies with "YOUTUBE_API_KEY is required" — which is how
 * `release-sweep` silently stopped running for weeks, and how five more
 * scripts were found broken the same way on 2026-09-20.
 *
 * An explicit env var still wins, so a one-off run can override it.
 */
export async function youtubeApiKey(): Promise<string> {
  const fromEnv = process.env.YOUTUBE_API_KEY;
  if (fromEnv) return fromEnv;
  const key = (await amplifyEnv()).YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY found in neither the environment nor SSM');
  return key;
}
