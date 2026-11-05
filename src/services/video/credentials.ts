/**
 * xAI API key — read at request time from SSM SecureString (spec 6.2), cached
 * per Lambda container. Never logged, stored or sent to the client.
 */
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { awsConfig } from '@/lib/aws-config';

// Sign with the app user's keys like every other AWS call in the site: the
// Amplify SSR server has no ambient credentials, so the default provider chain
// throws CredentialsProviderError there (seen live 2026-11-05).
const ssm = new SSMClient({
  region: awsConfig.region,
  ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
});

let cached: string | undefined;

function paramName(): string {
  const app = process.env.AWS_APP_ID || 'd3rkmepk4popv0';
  const branch = process.env.AWS_BRANCH || 'master';
  return `/amplify/${app}/${branch}/XAI_API_KEY`;
}

/** The key, or null when the parameter does not exist (feature inert). */
export async function getXaiApiKey(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: paramName(), WithDecryption: true }));
    const v = r.Parameter?.Value;
    if (v && v.length > 0) {
      cached = v;
      return v;
    }
    return null;
  } catch (err) {
    if (err instanceof Error && err.name === 'ParameterNotFound') {
      // Not cached: storing the key later must take effect without a redeploy.
      return null;
    }
    throw err;
  }
}

export function __resetXaiKeyCacheForTests(): void {
  cached = undefined;
}
