/**
 * Context-aware Music Library
 * Intelligent music selection based on poem emotion and mood
 */

export interface MusicTrack {
  url: string;
  emotion: string;
  mood: string;
  description: string;
  duration?: number;
}

// Curated music library for different emotional contexts
export const MUSIC_LIBRARY: Record<string, MusicTrack[]> = {
  sad: [
    {
      url: 'https://www.bensound.com/bensound-music/bensound-sadday.mp3',
      emotion: 'sad',
      mood: 'somber',
      description: 'Sad Day - Melancholic piano piece',
    },
    {
      url: 'https://www.bensound.com/bensound-music/bensound-memories.mp3',
      emotion: 'sad',
      mood: 'reflective',
      description: 'Memories - Emotional and nostalgic',
    },
  ],

  melancholic: [
    {
      url: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/music/no_curator/Kevin_MacLeod/Impact/Kevin_MacLeod_-_Sonatina_in_C_minor.mp3',
      emotion: 'melancholic',
      mood: 'somber',
      description: 'Sonatina in C minor - Classical melancholic',
    },
  ],

  reflective: [
    {
      url: 'https://www.bensound.com/bensound-music/bensound-slowmotion.mp3',
      emotion: 'reflective',
      mood: 'peaceful',
      description: 'Slow Motion - Contemplative ambient',
    },
  ],

  devotional: [
    {
      url: 'https://www.bensound.com/bensound-music/bensound-india.mp3',
      emotion: 'devotional',
      mood: 'peaceful',
      description: 'India - Traditional spiritual ambiance',
    },
  ],

  joyful: [
    {
      url: 'https://www.bensound.com/bensound-music/bensound-ukulele.mp3',
      emotion: 'joyful',
      mood: 'uplifting',
      description: 'Ukulele - Light and cheerful',
    },
  ],

  hopeful: [
    {
      url: 'https://www.bensound.com/bensound-music/bensound-betterdays.mp3',
      emotion: 'hopeful',
      mood: 'uplifting',
      description: 'Better Days - Inspirational and optimistic',
    },
  ],

  romantic: [
    {
      url: 'https://www.bensound.com/bensound-music/bensound-love.mp3',
      emotion: 'romantic',
      mood: 'gentle',
      description: 'Love - Tender and emotional',
    },
  ],

  patriotic: [
    {
      url: 'https://www.bensound.com/bensound-music/bensound-epic.mp3',
      emotion: 'patriotic',
      mood: 'powerful',
      description: 'Epic - Majestic and inspiring',
    },
  ],
};

/**
 * Select appropriate music based on poem analysis
 */
export function selectMusicForPoem(emotion?: string, mood?: string): MusicTrack {
  // Default to sad music if no emotion specified (most common for poetry)
  const emotionKey = (emotion?.toLowerCase() || 'sad') as keyof typeof MUSIC_LIBRARY;

  // Get tracks for the emotion
  const tracks = MUSIC_LIBRARY[emotionKey] || MUSIC_LIBRARY.sad;

  // If mood is specified, try to find a matching track
  if (mood) {
    const moodMatch = tracks.find(track =>
      track.mood.toLowerCase() === mood.toLowerCase()
    );
    if (moodMatch) return moodMatch;
  }

  // Return first track for the emotion
  return tracks[0];
}

/**
 * Get all available music tracks with fallbacks
 */
export function getAllMusicSources(emotion?: string, mood?: string): string[] {
  const primary = selectMusicForPoem(emotion, mood);

  // Build fallback list
  const fallbacks: string[] = [primary.url];

  // Add other tracks from same emotion
  const emotionKey = (emotion?.toLowerCase() || 'sad') as keyof typeof MUSIC_LIBRARY;
  const emotionTracks = MUSIC_LIBRARY[emotionKey] || MUSIC_LIBRARY.sad;

  emotionTracks.forEach(track => {
    if (track.url !== primary.url) {
      fallbacks.push(track.url);
    }
  });

  // Add sad music as final fallback (always reliable)
  if (emotionKey !== 'sad') {
    MUSIC_LIBRARY.sad.forEach(track => {
      if (!fallbacks.includes(track.url)) {
        fallbacks.push(track.url);
      }
    });
  }

  return fallbacks;
}

/**
 * Get music description for display
 */
export function getMusicDescription(emotion?: string, mood?: string): string {
  const track = selectMusicForPoem(emotion, mood);
  return track.description;
}
