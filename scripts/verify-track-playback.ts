/**
 * verify-track-playback — go-live check for the gated karaoke stream route
 * GET /api/performers/songs/[id]/track.
 *
 * READ-ONLY (GET only) — it never publishes or mutates anything. It asserts BOTH
 * halves of the design:
 *   • the gate: an unauthenticated request is refused (401);
 *   • streaming: an authenticated performer gets the audio (200) and a Range
 *     request seeks (206 Partial Content) — the behaviour the <audio> player and
 *     the gated-bucket read path depend on.
 *
 * `requirePerformer` accepts a Bearer Cognito ID token (preferred) or the
 * session cookie. This harness uses a Bearer token, so it works against a LOCAL
 * `npm run dev` server too — where the <audio> cookie path can't reach — letting
 * you validate end-to-end BEFORE the production APP_AWS_* IAM grant (local reads
 * the gated bucket with this box's own credentials).
 *
 * Usage:
 *   npx tsx scripts/verify-track-playback.ts \
 *     --base http://localhost:3002 --song cnt_xxxxx --token "<cognito-id-token>"
 *
 *   # token via env instead of --token:
 *   PERFORMER_ID_TOKEN=... npx tsx scripts/verify-track-playback.ts --song cnt_xxxxx
 *
 * Mint an ID token for a VERIFIED performer (USER_PASSWORD_AUTH must be enabled
 * on the app client):
 *   aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH \
 *     --client-id "$NEXT_PUBLIC_USER_POOL_CLIENT_ID" \
 *     --auth-parameters USERNAME=<email>,PASSWORD=<pw> \
 *     --query 'AuthenticationResult.IdToken' --output text
 */

interface Args {
  base: string;
  song: string;
  token: string;
}

function parseArgs(argv: string[]): Args {
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const base = (get('--base') ?? 'http://localhost:3002').replace(/\/+$/, '');
  const song = get('--song');
  const token = get('--token') ?? process.env.PERFORMER_ID_TOKEN ?? '';
  if (!song) throw new Error('Usage: --song <cnt_id> [--base <url>] [--token <idToken> | PERFORMER_ID_TOKEN]');
  if (!token) throw new Error('No performer token: pass --token or set PERFORMER_ID_TOKEN (see the header for how to mint one).');
  return { base, song, token };
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function run(args: Args): Promise<Check[]> {
  const url = `${args.base}/api/performers/songs/${args.song}/track`;
  const auth = { Authorization: `Bearer ${args.token}` };
  const checks: Check[] = [];

  // 1. The gate — no auth must be refused.
  {
    const r = await fetch(url);
    checks.push({ name: 'unauthenticated → 401', ok: r.status === 401, detail: `got ${r.status}` });
  }

  // 2. Authenticated full stream — 200 + audio bytes.
  {
    const r = await fetch(url, { headers: auth });
    const ct = r.headers.get('content-type') ?? '';
    const bytes = r.ok ? (await r.arrayBuffer()).byteLength : 0;
    const ok = r.status === 200 && ct.startsWith('audio/') && bytes > 0;
    checks.push({
      name: 'authenticated full → 200 + audio bytes',
      ok,
      detail: `status ${r.status}, content-type "${ct}", ${bytes} bytes, accept-ranges "${r.headers.get('accept-ranges') ?? ''}"`,
    });
  }

  // 3. Range request — 206 Partial Content (seeking).
  {
    const r = await fetch(url, { headers: { ...auth, Range: 'bytes=0-2047' } });
    const cr = r.headers.get('content-range') ?? '';
    const bytes = r.status === 206 ? (await r.arrayBuffer()).byteLength : 0;
    const ok = r.status === 206 && cr.startsWith('bytes 0-') && bytes > 0 && bytes <= 2048;
    checks.push({
      name: 'authenticated Range → 206 Partial Content',
      ok,
      detail: `status ${r.status}, content-range "${cr}", ${bytes} bytes`,
    });
  }

  // 4. Malformed song id — rejected (400) even when authenticated.
  {
    const r = await fetch(`${args.base}/api/performers/songs/not-a-valid-id/track`, { headers: auth });
    checks.push({ name: 'bad song id → 400', ok: r.status === 400, detail: `got ${r.status}` });
  }

  return checks;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Verifying gated /track for ${args.song} @ ${args.base}\n`);
  const checks = await run(args);
  for (const c of checks) console.log(`${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${failed === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failed} CHECK(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
