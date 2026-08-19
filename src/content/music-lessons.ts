/**
 * Lesson content for Music Composition & Theory.
 *
 * A static registry, deliberately mirroring `admin-docs.ts` rather than
 * inventing a second content system: lessons are authored text, they version
 * with the code, and putting them in DynamoDB would buy nothing but a network
 * round trip and a migration.
 *
 * WRITING RULES, from the spec:
 *  - Short and focused. A lesson is a page, not a chapter.
 *  - Bilingual where a Tamil term is genuinely standard — NOT invented Tamil
 *    for its own sake. Where the English or established Indian term is what a
 *    musician actually says (BPM, chord), that is what we say.
 *  - Every lesson ends in songwriting, not in theory for its own sake.
 *  - Nothing uncertain stated as fact.
 */

export type LessonSection = 'foundations' | 'rhythm' | 'melody' | 'tamil-lyrics';
export type LessonDifficulty = 'beginner' | 'intermediate';

export interface MusicLesson {
  id: string;
  section: LessonSection;
  tamilTitle: string;
  englishTitle: string;
  difficulty: LessonDifficulty;
  minutes: number;
  theory: string[];
  /** Bilingual terminology pairs shown as a glossary strip. */
  terms?: Array<{ tamil: string; english: string }>;
  /** How a songwriter uses this — every lesson must land here. */
  application?: string;
}

export const MUSIC_LESSONS: readonly MusicLesson[] = [
  // ---- Foundations ------------------------------------------------------
  {
    id: 'sound-and-pitch',
    section: 'foundations',
    tamilTitle: 'ஒலியும் சுருதியும்',
    englishTitle: 'Sound, frequency and pitch',
    difficulty: 'beginner',
    minutes: 5,
    theory: [
      'A sound is air vibrating. How FAST it vibrates is its frequency, measured in hertz (Hz) — 440 vibrations a second is the A that orchestras tune to. Faster vibration is heard as a higher pitch.',
      'Double the frequency and you get the same note again, higher: 220 Hz, 440 Hz and 880 Hz are all A. That doubling is the octave, and it is why a man and a woman singing "the same note" can sound an octave apart and still be in tune.',
      'A note is a pitch we have agreed to name. Between one A and the next there are twelve steps in the system most instruments are built around, and each step is a semitone.',
    ],
    terms: [
      { tamil: 'சுருதி', english: 'Pitch / tonic — depending on context' },
      { tamil: 'ஸ்வரம்', english: 'Swara — a named scale degree' },
      { tamil: 'ஸ்தாயி', english: 'Octave register' },
    ],
    application:
      'When a singer says a song is "too high", they are not asking you to rewrite the melody — they are asking you to move the tonic. Same tune, different starting pitch.',
  },
  {
    id: 'sa-is-not-c',
    section: 'foundations',
    tamilTitle: 'ஸ என்பது C அல்ல',
    englishTitle: 'Swaras and Western notes are not the same kind of thing',
    difficulty: 'beginner',
    minutes: 6,
    theory: [
      'C, D, E are ABSOLUTE pitches. C is 261.63 Hz in the middle octave, today and always, on every piano in the world.',
      'Sa, Ri, Ga are RELATIVE positions. Sa is wherever the singer\'s tonic is — their சுருதி. Ri is the step above it, Pa is the fifth above it, and so on. Move the tonic and every swara moves with it.',
      'So "Sa = C" is true only while your tonic happens to be C. Learn it as a fixed equivalence and everything breaks the moment a singer asks for a different pitch — which is most of the time.',
      'On the keyboard above, change the tonic and watch the labels move. With tonic C, middle C is Sa. With tonic G, that same key is Ma₁. The key did not change; the question being asked of it did.',
    ],
    terms: [
      { tamil: 'ஆதார சுருதி', english: 'The tonic — the reference pitch everything is measured from' },
    ],
    application:
      'This is why "what key is it in?" and "what is your sruti?" are the same question asked by two traditions, and why a musician can answer one and not the other.',
  },

  // ---- Rhythm -----------------------------------------------------------
  {
    id: 'pulse-and-tempo',
    section: 'rhythm',
    tamilTitle: 'துடிப்பும் வேகமும்',
    englishTitle: 'Pulse, beat and tempo',
    difficulty: 'beginner',
    minutes: 5,
    theory: [
      'The pulse is the steady throb you tap your foot to. Tempo is how fast that pulse runs, counted in beats per minute (BPM). 60 BPM is one beat a second; 120 BPM is two.',
      'Not every beat carries the same weight. Some are strong, some weak, and that pattern of strong and weak is what gives music its gait — the difference between a march and a lullaby is mostly where the stresses fall.',
      'A bar (or measure) is one full cycle of that pattern. When the pattern restarts, a new bar has begun.',
    ],
    terms: [
      { tamil: 'தாளம்', english: 'Rhythm / tala' },
      { tamil: 'வேகம்', english: 'Tempo' },
      { tamil: 'நடை', english: 'Gait — the feel of the rhythm' },
    ],
    application:
      'Before writing a melody, set the metronome and speak your lyric over it. If you are rushing to fit the words in, the line is too dense for that tempo — the fix is usually fewer syllables, not a faster singer.',
  },
  {
    id: 'three-four-vs-six-eight',
    section: 'rhythm',
    tamilTitle: '3/4-ம் 6/8-ம் ஒன்றல்ல',
    englishTitle: '3/4 and 6/8 both have six — and are not the same',
    difficulty: 'intermediate',
    minutes: 7,
    theory: [
      'Both fit six eighth-notes in a bar. That is where the similarity ends, and confusing them is the most common rhythm mistake a songwriter makes.',
      '3/4 is THREE beats, each splitting in two: ONE-and TWO-and THREE-and. Stress every second pulse. This is the waltz.',
      '6/8 is TWO beats, each splitting in three: ONE-two-three FOUR-five-six. Stress every third pulse. This is the lilt you hear in a great many folk and devotional songs.',
      'Play them back to back on the metronome at the same BPM. What stays constant is the BEAT you tap — BPM always counts felt beats. What changes is how each beat divides: 3/4 splits it in two, 6/8 in three, so at 90 BPM you hear 180 pulses a minute in 3/4 and 270 in 6/8. Listen past the speed to where the stresses land — that grouping is what your body hears, and it changes the song completely.',
    ],
    application:
      'If a melody feels like it is limping, check whether you wrote it in one and are singing it in the other. A three-syllable Tamil word sits naturally on a 6/8 beat and awkwardly across a 3/4 one.',
  },

  // ---- Melody -----------------------------------------------------------
  {
    id: 'phrase-and-motif',
    section: 'melody',
    tamilTitle: 'தொடரும் கருவும்',
    englishTitle: 'Phrase, motif, repetition and variation',
    difficulty: 'beginner',
    minutes: 6,
    theory: [
      'A melodic phrase is a musical sentence — roughly as much as one breath carries. A motif is a short shape inside it, a few notes with a recognisable contour.',
      'Melodies work by repeating a motif and then changing it. Pure repetition becomes dull; pure novelty becomes unmemorable. Almost every song you can hum is repetition with small, deliberate variation.',
      'Contour is the SHAPE of a line — rising, falling, arching. A rising line builds tension; a falling one releases it. Ending a phrase on the tonic feels settled; ending it elsewhere leaves the listener waiting.',
      'Rests and long notes are part of the melody, not gaps in it. The space after a phrase is what lets the previous line register.',
    ],
    terms: [
      { tamil: 'மெட்டு', english: 'Melody / tune' },
      { tamil: 'சஞ்சாரம்', english: 'Characteristic melodic movement' },
    ],
    application:
      'Write the melody for your first line, then reuse its shape for the second with one note changed. That single change is usually what makes a hook feel both familiar and alive.',
  },

  // ---- Tamil lyrics -----------------------------------------------------
  {
    id: 'kuril-nedil',
    section: 'tamil-lyrics',
    tamilTitle: 'குறிலும் நெடிலும்',
    englishTitle: 'Short and long vowels decide what you can sustain',
    difficulty: 'beginner',
    minutes: 7,
    theory: [
      'Tamil vowels are short (குறில்) or long (நெடில்). அ இ உ எ ஒ are short; ஆ ஈ ஊ ஏ ஐ ஓ ஔ are long. This is not decoration — it is the length of the sound.',
      'A long vowel can be held. A short one cannot be stretched without sounding wrong to a Tamil ear: hold the உ in "மது" and you have said a different word badly.',
      'A syllable ending in a bare consonant (மெய், a letter carrying புள்ளி) is closed — the sound stops. An open syllable ends in its vowel and can be sustained and ornamented.',
      'So the words at the END of your lines decide whether the singer can hold the note. A line ending in a long open vowel gives them somewhere to go; one ending in a hard consonant clips the phrase shut.',
    ],
    terms: [
      { tamil: 'குறில்', english: 'Short vowel' },
      { tamil: 'நெடில்', english: 'Long vowel' },
      { tamil: 'மெய்', english: 'Consonant with புள்ளி — closes the syllable' },
      { tamil: 'கமகம்', english: 'Gamaka — the ornament a sustained note carries' },
    ],
    application:
      'When a line will not sing, look at its last word before you blame the tune. Swapping it for one ending in a long open vowel often fixes the phrase without touching a single note.',
  },
  {
    id: 'natural-pronunciation',
    section: 'tamil-lyrics',
    tamilTitle: 'இயல்பான உச்சரிப்பு',
    englishTitle: 'Never break a Tamil word to fit the tune',
    difficulty: 'beginner',
    minutes: 5,
    theory: [
      'A melody can be rewritten. A word cannot. Tamil words carry their own stress and length, and forcing a word across a beat boundary that splits it makes the line sound foreign even when every note is correct.',
      'If a word will not fit, the honest options are: change the word, change the rhythm, or change how many syllables the line carries. Splitting the word is not on the list.',
      'Lyric density is the count of syllables per beat. Too many and the singer rushes and the words blur; too few and the line drags. Neither is fixed by singing harder.',
    ],
    application:
      'Paste the line into the Lyric Meter Lab and speak it against the metronome. Where you stumble is where the density is wrong — and the Lexicon can offer a shorter word with the same meaning.',
  },
];

/** Lessons belonging to one section, in authored order. */
export function lessonsForSection(section: LessonSection): MusicLesson[] {
  return MUSIC_LESSONS.filter((l) => l.section === section);
}

export function getLesson(id: string): MusicLesson | undefined {
  return MUSIC_LESSONS.find((l) => l.id === id);
}
