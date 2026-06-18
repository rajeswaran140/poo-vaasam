/**
 * New-song email digest — the content builder (subject + HTML + text).
 *
 * This is the unblocked core of the email component: it turns recently-published
 * songs into a ready-to-send email. The only thing left for an actual send is a
 * provider adapter (SES vs Resend — a decision), so this stays provider-agnostic
 * and fully unit-tested. Owning a direct line to the diaspora (vs renting reach
 * from the YouTube algorithm) is the point.
 *
 * Pure, no I/O. HTML is inline-styled and escaped for email-client safety.
 */

import type { PublicSongDTO } from '@/domain/songs/PublicSong';
import { SITE_URL } from '@/lib/seo';
import { contentPath } from '@/config/vanity-paths';

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
}

export interface DigestOptions {
  /** Absolute base URL (defaults to the production site). */
  siteUrl?: string;
  /** When provided, a footer unsubscribe link is rendered. */
  unsubscribeUrl?: string;
}

/** Minimal HTML escape for interpolated song text in the email body. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function songUrl(song: PublicSongDTO, base: string): string {
  return `${base}${contentPath(song.id)}`;
}

/**
 * Build the digest email for newly published songs. Returns null when there are
 * no songs (nothing to send). Subject scales from one named song to a count.
 */
export function buildNewSongDigest(
  songs: PublicSongDTO[],
  opts: DigestOptions = {}
): DigestEmail | null {
  if (!songs || songs.length === 0) return null;
  const base = (opts.siteUrl ?? SITE_URL).replace(/\/+$/, '');

  const subject =
    songs.length === 1
      ? `புதிய பாடல்: ${songs[0].title}`
      : `${songs.length} புதிய பாடல்கள் — Tamilagaval`;

  const intro =
    songs.length === 1
      ? 'ஒரு புதிய பாடல் வெளியாகியுள்ளது:'
      : `${songs.length} புதிய பாடல்கள் வெளியாகியுள்ளன:`;

  // --- Plain text ---
  const textLines = [
    intro,
    '',
    ...songs.map((s) => `• ${s.title} — ${s.artist}\n  ${songUrl(s, base)}`),
    '',
    `தமிழகவல்: ${base}`,
  ];
  if (opts.unsubscribeUrl) textLines.push('', `Unsubscribe: ${opts.unsubscribeUrl}`);
  const text = textLines.join('\n');

  // --- HTML (inline-styled, email-client safe) ---
  const cards = songs
    .map((s) => {
      const url = esc(songUrl(s, base));
      const cover = s.coverUrl
        ? `<img src="${esc(s.coverUrl)}" width="96" height="96" alt="${esc(s.title)}" style="border-radius:8px;display:block;" />`
        : '';
      return `
      <tr>
        <td style="padding:12px 0;vertical-align:top;width:96px;">${cover}</td>
        <td style="padding:12px 0 12px 16px;vertical-align:top;">
          <a href="${url}" style="font-size:18px;font-weight:bold;color:#c2410c;text-decoration:none;">${esc(s.title)}</a>
          <div style="font-size:14px;color:#555;margin-top:4px;">${esc(s.artist)}</div>
          <a href="${url}" style="display:inline-block;margin-top:8px;font-size:14px;color:#ffffff;background:#ea580c;padding:6px 14px;border-radius:9999px;text-decoration:none;">▶ கேளுங்கள்</a>
        </td>
      </tr>`;
    })
    .join('');

  const unsubscribe = opts.unsubscribeUrl
    ? `<div style="margin-top:24px;font-size:12px;color:#999;">இந்த மின்னஞ்சல்களை வேண்டாமெனில் <a href="${esc(opts.unsubscribeUrl)}" style="color:#999;">Unsubscribe</a>.</div>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f7f7f7;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:20px;color:#111;margin:0 0 4px;">தமிழகவல்</h1>
    <p style="font-size:15px;color:#333;margin:0 0 16px;">${esc(intro)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${cards}</table>
    <div style="margin-top:24px;">
      <a href="${esc(base)}" style="font-size:14px;color:#c2410c;text-decoration:none;">அனைத்து பாடல்களையும் பார்க்கவும் →</a>
    </div>
    ${unsubscribe}
  </div></body></html>`;

  return { subject, html, text };
}
