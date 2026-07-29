/**
 * Sparkline geometry — pure, so the chart maths is unit-tested without a DOM.
 *
 * There is no charting library here on purpose (house rule): a line chart is
 * an SVG path, and pulling in a chart dependency to draw one would be a large
 * amount of code for a `<path d="…">`.
 *
 * Everything works in a fixed viewBox coordinate space and the SVG scales via
 * `preserveAspectRatio`, so the caller never has to measure the container.
 */

export interface SeriesPoint {
  date: string;
  value: number;
  /**
   * False for YouTube's still-settling trailing days. Rendered dashed so a
   * provisional tail is never mistaken for a confirmed decline — the single
   * most common misreading of this channel's dashboards.
   */
  isFinalized?: boolean;
}

export interface Scale {
  x: (i: number) => number;
  y: (v: number) => number;
  min: number;
  max: number;
}

/**
 * Build the coordinate mapping.
 *
 * The y-axis is deliberately NOT zero-based: daily views on this channel sit in
 * a narrow band (4.3k–5.9k), and anchoring at zero would flatten every real
 * movement into a straight line. A padded min/max makes the shape legible. The
 * caller must therefore label the axis — a non-zero baseline that isn't stated
 * exaggerates apparent volatility.
 */
export function buildScale(points: SeriesPoint[], width: number, height: number, pad = 4): Scale {
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  // Guard a flat series: a zero span would divide by zero.
  const span = rawMax - rawMin || Math.max(1, Math.abs(rawMax) * 0.1);
  const min = rawMin - span * 0.1;
  const max = rawMax + span * 0.1;
  const n = points.length;
  return {
    min,
    max,
    x: (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width),
    y: (v: number) => {
      const t = (v - min) / (max - min || 1);
      return height - pad - t * (height - pad * 2);
    },
  };
}

/** SVG path `d` for a slice of the series. Empty string for fewer than 2 points. */
export function buildPath(points: SeriesPoint[], scale: Scale, from = 0, to?: number): string {
  const end = to ?? points.length;
  const slice = points.slice(from, end);
  if (slice.length < 2) return '';
  return slice
    .map((p, k) => `${k === 0 ? 'M' : 'L'}${scale.x(from + k).toFixed(1)},${scale.y(p.value).toFixed(1)}`)
    .join(' ');
}

/**
 * Index of the first non-finalized point, or -1 when all are confirmed.
 * The dashed tail starts one point EARLIER so the solid and dashed segments
 * join rather than leaving a visual gap.
 */
export function provisionalFrom(points: SeriesPoint[]): number {
  const i = points.findIndex((p) => p.isFinalized === false);
  if (i < 0) return -1;
  return Math.max(0, i - 1);
}

/**
 * Nearest point to a pointer position, for the hover tooltip.
 * `ratio` is the pointer's x as a 0–1 fraction of the chart width, which lets
 * the caller avoid passing pixel geometry in.
 */
export function nearestIndex(points: SeriesPoint[], ratio: number): number {
  if (!points.length) return -1;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return Math.round(clamped * (points.length - 1));
}

/** Plain-language summary used as the chart's screen-reader alternative. */
export function describeSeries(points: SeriesPoint[], label: string): string {
  if (!points.length) return `${label}: no data`;
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((p) => p.value);
  const peak = Math.max(...values);
  const low = Math.min(...values);
  const dir = last.value > first.value ? 'up' : last.value < first.value ? 'down' : 'flat';
  return `${label} from ${first.date} to ${last.date}: ${dir}, ${Math.round(first.value)} to ${Math.round(last.value)}, peak ${Math.round(peak)}, low ${Math.round(low)}.`;
}
