/**
 * Status clips — the curated set of vertical 1080×1920 clips cut from songs for
 * sharing to WhatsApp **Status** (the #1 dark-social surface for the diaspora
 * audience; see project_tamilagaval_whatsapp). Same shape as the other per-song
 * config modules (song-heroes, vanity-paths): the catalogue stays the source of
 * truth for a song's title/cover, while THIS module records which songs have a
 * Status clip and where the file lives.
 *
 * The clips are served **same-origin** from `/public/clips/…` on purpose: the
 * "Share to Status" card hands the raw video file to `navigator.share({files})`
 * (and a download fallback), and fetching the file from the cross-origin media
 * CDN would be blocked by CORS. Same-origin keeps the Web Share file path and
 * the download robust with zero CORS/infra work. The files are small (~1.3 MB).
 *
 * **Posters are the short's OWN thumbnail** (a 1080×1920 frame extracted from the
 * clip, sitting next to it as `<slug>-short.jpg`), NOT the song's square cover or
 * the 16:9 YouTube thumbnail. The short already bakes in the matching cover, the
 * Tamil title and the "Lyrics: Raj | Music: TamilAgaval.com" branding in the
 * correct vertical frame, so it's both the truest preview of what gets shared and
 * the right shape for these 9:16 cards — and it needs no YouTube video id (so
 * songs without one, e.g. எங்கள் தேசம், can still appear). See `posterForClip`.
 */

export interface StatusClip {
  /** The published song this clip was cut from (joins to the Songs catalogue). */
  songId: string;
  /** Root-relative, same-origin path under /public (CORS-free for share/download). */
  clip: string;
  /**
   * The EXACT master the clip was rendered from, and where in it the 29 seconds
   * begin. Optional only because the 12 hand-made clips predate the renderer.
   *
   * ⚠️ THESE TWO BELONG TOGETHER AND TO EACH OTHER. Master duration does NOT
   * match published-video duration — measured on ஈழத்து மண்ணே: master 6:41 vs
   * video 6:02 — so a timestamp is meaningful ONLY against the WAV it was chosen
   * in. Never carry a start time over from a video, and never reuse one across
   * master variants of the same song (ஈழத்து மண்ணே has TEN in S3). Recording the
   * asset alongside the timestamp is what makes a re-render reproducible.
   */
  masterAsset?: string;
  /** Seconds into `masterAsset` where the chosen 29s passage starts. */
  clipStart?: number;
  /**
   * `portrait` when real 9:16 art was supplied (PREFERRED), `blurred-fill` for
   * the automated landscape-thumbnail fallback. Absent = hand-made, pre-renderer.
   */
  artworkMode?: 'portrait' | 'blurred-fill';
}

/**
 * 12 clips staged for WhatsApp Status. Each `songId` is a PUBLISHED song; the
 * page joins on it to pull the live title/cover, and silently drops any whose
 * song is missing/unpublished (so this list can never surface a dead tile).
 */
export const STATUS_CLIPS: StatusClip[] = [
  { songId: 'cnt_1780067292516_rpxtdnhoa', clip: '/clips/akkam-short.mp4' },        // அக்கம் பக்கம்
  { songId: 'cnt_1780067292560_ixhyejnr3', clip: '/clips/anbenum-short.mp4' },      // அன்பெனும் தேரில்
  { songId: 'cnt_1779939400084_vgk04g3q9', clip: '/clips/andhi-megame-short.mp4' }, // அந்தி மேகமே
  { songId: 'cnt_1780419293978_31gt0nq13', clip: '/clips/aridhana-short.mp4' },      // அரிதான பெரும் பாசம்
  { songId: 'cnt_1781049094952_wstyqacm4', clip: '/clips/engaldesam-short.mp4' },    // எங்கள் தேசம் (poster = short's own frame; no YT id needed)
  { songId: 'cnt_1780067292588_frlxbwfzh', clip: '/clips/irai-short.mp4' },          // இரை தேட சென்றதாய்
  { songId: 'cnt_1780855949386_2y4i1y64d', clip: '/clips/kannodu-short.mp4' },       // கண்ணோடு நீர் அள்ளி
  { songId: 'cnt_1780066149948_61fwvj451', clip: '/clips/mudivilla-short.mp4' },     // முடிவில்லா முகத்தினில்
  { songId: 'cnt_1780066149991_18z5eyynd', clip: '/clips/muthamizhin-short.mp4' },   // முத்தமிழின் மூன்றெழுத்தில்
  { songId: 'cnt_1780067292613_jdgzm3ojb', clip: '/clips/orunal-short.mp4' },        // ஒரு நாள் திருநாள்
  { songId: 'cnt_1780856529972_6vrbl2icr', clip: '/clips/sevvizhi-short.mp4' },      // செவ்விழி ஓவியமே
  { songId: 'cnt_1780856975880_4cxek8s3f', clip: '/clips/chithira-short.mp4' },      // சித்திர செவ்வானம் (44.5 shares/1k — high-advocacy)
];

/** The Status clip for a song, or undefined if the song has none. */
export function clipForSong(songId: string): string | undefined {
  return STATUS_CLIPS.find((c) => c.songId === songId)?.clip;
}

/**
 * The same-origin poster for a clip — the short's OWN thumbnail, a frame
 * extracted next to it as `<slug>-short.jpg`. Used as the `<video poster>` so the
 * card preview matches exactly what gets shared (and is correctly vertical),
 * independent of the song's cover / YouTube thumbnail.
 */
export function posterForClip(clip: string): string {
  return clip.replace(/\.mp4$/, '.jpg');
}
