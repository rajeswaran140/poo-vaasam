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
// Using Kevin MacLeod's royalty-free music from incompetech.com
export const MUSIC_LIBRARY: Record<string, MusicTrack[]> = {
  sad: [
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Heartbreaking.mp3',
      emotion: 'sad',
      mood: 'somber',
      description: 'Heartbreaking - Melancholic piano piece',
    },
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Gymnopedie%20No%201.mp3',
      emotion: 'sad',
      mood: 'reflective',
      description: 'Gymnopedie No 1 - Emotional and nostalgic',
    },
  ],

  melancholic: [
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Heartbreaking.mp3',
      emotion: 'melancholic',
      mood: 'somber',
      description: 'Heartbreaking - Classical melancholic',
    },
  ],

  reflective: [
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Meditation%20Impromptu%2001.mp3',
      emotion: 'reflective',
      mood: 'peaceful',
      description: 'Meditation Impromptu - Contemplative ambient',
    },
  ],

  devotional: [
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Meditation%20Impromptu%2002.mp3',
      emotion: 'devotional',
      mood: 'peaceful',
      description: 'Meditation Impromptu 02 - Traditional spiritual ambiance',
    },
  ],

  joyful: [
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wallpaper.mp3',
      emotion: 'joyful',
      mood: 'uplifting',
      description: 'Wallpaper - Light and cheerful',
    },
  ],

  hopeful: [
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ascending.mp3',
      emotion: 'hopeful',
      mood: 'uplifting',
      description: 'Ascending - Inspirational and optimistic',
    },
  ],

  romantic: [
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Romance%20and%20Passion.mp3',
      emotion: 'romantic',
      mood: 'gentle',
      description: 'Romance and Passion - Tender and emotional',
    },
  ],

  patriotic: [
    {
      url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Drums%20of%20the%20Deep.mp3',
      emotion: 'patriotic',
      mood: 'powerful',
      description: 'Drums of the Deep - Majestic and inspiring',
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
