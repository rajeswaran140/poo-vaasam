/**
 * Fonts the Video Text tool can draw with, beyond the three the whole site
 * already loads in src/app/layout.tsx (Noto Sans Tamil, Kavivanar, Baloo
 * Thambi 2). Self-hosted from @fontsource like those — see the comment in
 * layout.tsx for why not next/font/google.
 *
 * - Bold (700) only: the canvas draws every part bold (lib/video-text/fonts.ts).
 * - preload: false — the files download only when a part uses that font.
 * - unicode-range: the Tamil faces cover Tamil only and the English faces
 *   Latin only, so `English, Tamil` stacks split a mixed line by script.
 *   U+200C/U+200D (ZWNJ/ZWJ) belong to Tamil shaping, so they are kept OUT
 *   of the Latin range.
 * - Each defines the CSS variable named in lib/video-text/fonts.ts. The
 *   variables are set on the editor's wrapper (VIDEO_TEXT_FONT_VARS), and the
 *   drawing code reads them from there.
 *
 * ⚠️ next/font parses this file statically: every path must be a literal.
 */
import localFont from 'next/font/local';

const notoSerifTamil = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/noto-serif-tamil/files/noto-serif-tamil-tamil-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC' }],
  display: 'swap',
  preload: false,
  variable: '--vt-noto-serif-tamil',
});

const muktaMalar = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/mukta-malar/files/mukta-malar-tamil-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC' }],
  display: 'swap',
  preload: false,
  variable: '--vt-mukta-malar',
});

const arima = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/arima/files/arima-tamil-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC' }],
  display: 'swap',
  preload: false,
  variable: '--vt-arima',
});

const montserrat = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/montserrat/files/montserrat-latin-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-200B, U+2010-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  display: 'swap',
  preload: false,
  variable: '--vt-montserrat',
});

const poppins = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/poppins/files/poppins-latin-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-200B, U+2010-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  display: 'swap',
  preload: false,
  variable: '--vt-poppins',
});

const playfairDisplay = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-200B, U+2010-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  display: 'swap',
  preload: false,
  variable: '--vt-playfair-display',
});

const lora = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/lora/files/lora-latin-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-200B, U+2010-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  display: 'swap',
  preload: false,
  variable: '--vt-lora',
});

const oswald = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/oswald/files/oswald-latin-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-200B, U+2010-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  display: 'swap',
  preload: false,
  variable: '--vt-oswald',
});

const dancingScript = localFont({
  src: [{ path: '../../../../node_modules/@fontsource/dancing-script/files/dancing-script-latin-700-normal.woff2', weight: '700', style: 'normal' }],
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-200B, U+2010-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  display: 'swap',
  preload: false,
  variable: '--vt-dancing-script',
});

/** Class names that define every Video Text font variable; put them on the editor wrapper. */
export const VIDEO_TEXT_FONT_VARS = [notoSerifTamil.variable, muktaMalar.variable, arima.variable, montserrat.variable, poppins.variable, playfairDisplay.variable, lora.variable, oswald.variable, dancingScript.variable].join(' ');
