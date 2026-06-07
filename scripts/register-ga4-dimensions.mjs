/**
 * Register the GA4 event-scoped custom dimensions the site's tracking sends
 * (see src/lib/analytics-events.ts) so the admin dashboards can break events
 * down by them. Idempotent: skips any that already exist.
 *
 *   source       → subscribe_click / youtube_open attribution (which CTA converts)
 *   song_id      → audio_play (survives song renames; dashboard prefers it)
 *   destination  → youtube_open (what was opened: channel / video:<id> / grid)
 *
 * Reads the SAME env the app uses:
 *   GA4_SERVICE_ACCOUNT_KEY (base64 JSON), GA4_PROPERTY_ID
 *
 * REQUIRES the service account to have the **Editor** role on the GA4 property
 * (the read-only `...ga4-reader@...` SA gets 403 on create — grant Editor in
 * GA4 Admin → Property Access Management, or run this as an Editor principal).
 *
 *   node scripts/register-ga4-dimensions.mjs
 */

import { JWT } from 'google-auth-library';

const encoded = process.env.GA4_SERVICE_ACCOUNT_KEY;
const propertyId = process.env.GA4_PROPERTY_ID;
if (!encoded || !propertyId) {
  console.error('Set GA4_SERVICE_ACCOUNT_KEY and GA4_PROPERTY_ID in the environment.');
  process.exit(1);
}

const sa = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
const base = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/customDimensions`;

const WANT = [
  { parameterName: 'source', displayName: 'CTA Source' },
  { parameterName: 'song_id', displayName: 'Song ID' },
  { parameterName: 'destination', displayName: 'YouTube Destination' },
  { parameterName: 'song_title', displayName: 'Song Title' },
];

const client = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/analytics.edit'],
});

const res = await client.request({ url: base });
const existing = (res.data.customDimensions || []).map((d) => d.parameterName);
console.log('existing:', existing.length ? existing.join(', ') : '(none)');

for (const d of WANT) {
  if (existing.includes(d.parameterName)) {
    console.log(`= ${d.parameterName}: already registered`);
    continue;
  }
  try {
    await client.request({ url: base, method: 'POST', data: { ...d, scope: 'EVENT' } });
    console.log(`+ ${d.parameterName}: CREATED (${d.displayName}, EVENT)`);
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.error?.message || e.message;
    console.log(`x ${d.parameterName}: FAILED ${status} — ${msg}`);
    if (status === 403) console.log('  → grant the service account Editor on the GA4 property, then re-run.');
  }
}
