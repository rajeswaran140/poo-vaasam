/**
 * One-time OAuth helper — generates a refresh token for the YouTube
 * Analytics API so the Amplify Lambda can pull owner-scoped per-video
 * metrics on /admin/youtube.
 *
 * Prereqs (done in GCP Console, once):
 *   1. Create a Desktop OAuth client in tamilagaval-prod-2026:
 *        APIs & Services → Credentials → Create credentials →
 *        OAuth client ID → Application type: Desktop app.
 *   2. Note the client_id + client_secret it generates.
 *   3. Enable the YouTube Analytics API on the same project:
 *        APIs & Services → Library → "YouTube Analytics API" → Enable.
 *
 * Then run this script (paste the two values when prompted):
 *
 *   npx tsx scripts/get-youtube-refresh-token.ts
 *
 * It prints a URL → open it in a browser → sign in as the channel
 * owner (rajeswaran.pro@gmail.com) → grant the requested scopes →
 * the browser redirects to a localhost callback that this script
 * intercepts → prints the refresh token.
 *
 * Paste the three values into Amplify env vars:
 *   YOUTUBE_OAUTH_CLIENT_ID
 *   YOUTUBE_OAUTH_CLIENT_SECRET
 *   YOUTUBE_ANALYTICS_REFRESH_TOKEN
 *
 * Then redeploy. /admin/youtube grows the Analytics + AI cards.
 */

import http from 'node:http';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';

const REDIRECT_URI = 'http://127.0.0.1:8765/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
];

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  const a = (await rl.question(q)).trim();
  if (!a) throw new Error(`${q.replace(/[?:].*$/, '')} is required`);
  return a;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  const clientId = await prompt(rl, 'OAuth client ID: ');
  const clientSecret = await prompt(rl, 'OAuth client secret: ');
  rl.close();

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  console.log('\n1) Open this URL in a browser, sign in as the channel owner, and approve:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for the redirect to', REDIRECT_URI, '…');

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        if (!req.url) return;
        const u = new URL(req.url, REDIRECT_URI);
        const incomingState = u.searchParams.get('state');
        const incomingCode = u.searchParams.get('code');
        const incomingError = u.searchParams.get('error');
        if (incomingError) {
          res.end(`Error: ${incomingError}. Close this tab and rerun.`);
          server.close();
          reject(new Error(incomingError));
          return;
        }
        if (incomingState !== state || !incomingCode) {
          res.end('State mismatch or missing code. Close this tab and rerun.');
          server.close();
          reject(new Error('state mismatch'));
          return;
        }
        res.end('OK — refresh token captured. You can close this tab.');
        server.close();
        resolve(incomingCode);
      } catch (e) {
        reject(e);
      }
    });
    server.listen(8765, '127.0.0.1');
  });

  console.log('\n2) Exchanging authorization code for tokens…');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) {
    console.error('\nToken exchange failed:', tokenRes.status, await tokenRes.text());
    process.exit(1);
  }
  const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string };
  if (!tokens.refresh_token) {
    console.error('\nNo refresh_token returned. (Did you revoke prior access? prompt=consent + access_type=offline should force one.)');
    process.exit(1);
  }

  console.log('\n3) DONE. Set these in Amplify env vars (server-only):\n');
  console.log(`YOUTUBE_OAUTH_CLIENT_ID     = ${clientId}`);
  console.log(`YOUTUBE_OAUTH_CLIENT_SECRET = ${clientSecret}`);
  console.log(`YOUTUBE_ANALYTICS_REFRESH_TOKEN       = ${tokens.refresh_token}`);
  console.log('\nThen redeploy. /admin/youtube grows the Analytics + AI cards.\n');
}

main().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
