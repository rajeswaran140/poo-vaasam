/**
 * Tamil Transliteration Utility
 *
 * Converts romanized Tamil (English letters) to Tamil script
 * Based on phonetic mapping and common typing patterns
 */

// Tamil character mappings
const TAMIL_VOWELS: Record<string, string> = {
  'a': 'அ',
  'aa': 'ஆ',
  'i': 'இ',
  'ii': 'ஈ',
  'u': 'உ',
  'uu': 'ஊ',
  'e': 'எ',
  'ee': 'ஏ',
  'ai': 'ஐ',
  'o': 'ஒ',
  'oo': 'ஓ',
  'au': 'ஔ',
};

const TAMIL_CONSONANTS: Record<string, string> = {
  'k': 'க்',
  'ng': 'ங்',
  'ch': 'ச்',
  'nj': 'ஞ்',
  't': 'ட்',
  'n': 'ந்',
  'p': 'ப்',
  'm': 'ம்',
  'y': 'ய்',
  'r': 'ர்',
  'l': 'ல்',
  'v': 'வ்',
  'zh': 'ழ்',
  'L': 'ள்',
  'R': 'ற்',
  'N': 'ண்',
};

const TAMIL_CONSONANT_VOWEL: Record<string, Record<string, string>> = {
  'k': { 'a': 'க', 'aa': 'கா', 'i': 'கி', 'ii': 'கீ', 'u': 'கு', 'uu': 'கூ', 'e': 'கெ', 'ee': 'கே', 'ai': 'கை', 'o': 'கொ', 'oo': 'கோ', 'au': 'கௌ' },
  'ng': { 'a': 'ங', 'aa': 'ஙா', 'i': 'ஙி', 'ii': 'ஙீ', 'u': 'ஙு', 'uu': 'ஙூ', 'e': 'ஙெ', 'ee': 'ஙே', 'ai': 'ஙை', 'o': 'ஙொ', 'oo': 'ஙோ', 'au': 'ஙௌ' },
  'ch': { 'a': 'ச', 'aa': 'சா', 'i': 'சி', 'ii': 'சீ', 'u': 'சு', 'uu': 'சூ', 'e': 'செ', 'ee': 'சே', 'ai': 'சை', 'o': 'சொ', 'oo': 'சோ', 'au': 'சௌ' },
  'nj': { 'a': 'ஞ', 'aa': 'ஞா', 'i': 'ஞி', 'ii': 'ஞீ', 'u': 'ஞு', 'uu': 'ஞூ', 'e': 'ஞெ', 'ee': 'ஞே', 'ai': 'ஞை', 'o': 'ஞொ', 'oo': 'ஞோ', 'au': 'ஞௌ' },
  't': { 'a': 'த', 'aa': 'தா', 'i': 'தி', 'ii': 'தீ', 'u': 'து', 'uu': 'தூ', 'e': 'தெ', 'ee': 'தே', 'ai': 'தை', 'o': 'தொ', 'oo': 'தோ', 'au': 'தௌ' },
  'n': { 'a': 'ந', 'aa': 'நா', 'i': 'நி', 'ii': 'நீ', 'u': 'நு', 'uu': 'நூ', 'e': 'நெ', 'ee': 'நே', 'ai': 'நை', 'o': 'நொ', 'oo': 'நோ', 'au': 'நௌ' },
  'p': { 'a': 'ப', 'aa': 'பா', 'i': 'பி', 'ii': 'பீ', 'u': 'பு', 'uu': 'பூ', 'e': 'பெ', 'ee': 'பே', 'ai': 'பை', 'o': 'பொ', 'oo': 'போ', 'au': 'பௌ' },
  'm': { 'a': 'ம', 'aa': 'மா', 'i': 'மி', 'ii': 'மீ', 'u': 'மு', 'uu': 'மூ', 'e': 'மெ', 'ee': 'மே', 'ai': 'மை', 'o': 'மொ', 'oo': 'மோ', 'au': 'மௌ' },
  'y': { 'a': 'ய', 'aa': 'யா', 'i': 'யி', 'ii': 'யீ', 'u': 'யு', 'uu': 'யூ', 'e': 'யெ', 'ee': 'யே', 'ai': 'யை', 'o': 'யொ', 'oo': 'யோ', 'au': 'யௌ' },
  'r': { 'a': 'ர', 'aa': 'ரா', 'i': 'ரி', 'ii': 'ரீ', 'u': 'ரு', 'uu': 'ரூ', 'e': 'ரெ', 'ee': 'ரே', 'ai': 'ரை', 'o': 'ரொ', 'oo': 'ரோ', 'au': 'ரௌ' },
  'l': { 'a': 'ல', 'aa': 'லா', 'i': 'லி', 'ii': 'லீ', 'u': 'லு', 'uu': 'லூ', 'e': 'லெ', 'ee': 'லே', 'ai': 'லை', 'o': 'லொ', 'oo': 'லோ', 'au': 'லௌ' },
  'v': { 'a': 'வ', 'aa': 'வா', 'i': 'வி', 'ii': 'வீ', 'u': 'வு', 'uu': 'வூ', 'e': 'வெ', 'ee': 'வே', 'ai': 'வை', 'o': 'வொ', 'oo': 'வோ', 'au': 'வௌ' },
  'zh': { 'a': 'ழ', 'aa': 'ழா', 'i': 'ழி', 'ii': 'ழீ', 'u': 'ழு', 'uu': 'ழூ', 'e': 'ழெ', 'ee': 'ழே', 'ai': 'ழை', 'o': 'ழொ', 'oo': 'ழோ', 'au': 'ழௌ' },
  'L': { 'a': 'ள', 'aa': 'ளா', 'i': 'ளி', 'ii': 'ளீ', 'u': 'ளு', 'uu': 'ளூ', 'e': 'ளெ', 'ee': 'ளே', 'ai': 'ளை', 'o': 'ளொ', 'oo': 'ளோ', 'au': 'ளௌ' },
  'R': { 'a': 'ற', 'aa': 'றா', 'i': 'றி', 'ii': 'றீ', 'u': 'று', 'uu': 'றூ', 'e': 'றெ', 'ee': 'றே', 'ai': 'றை', 'o': 'றொ', 'oo': 'றோ', 'au': 'றௌ' },
  'N': { 'a': 'ண', 'aa': 'ணா', 'i': 'ணி', 'ii': 'ணீ', 'u': 'ணு', 'uu': 'ணூ', 'e': 'ணெ', 'ee': 'ணே', 'ai': 'ணை', 'o': 'ணொ', 'oo': 'ணோ', 'au': 'ணௌ' },
};

// Common word mappings for better accuracy
const COMMON_WORDS: Record<string, string> = {
  'vanakkam': 'வணக்கம்',
  'nandri': 'நன்றி',
  'poo': 'பூ',
  'vaasam': 'வாசம்',
  'tamil': 'தமிழ்',
  'ahaval': 'அகவல்',
};

/**
 * Transliterate romanized Tamil to Tamil script
 */
export function transliterateTamil(input: string): string {
  if (!input) return '';

  // Check for common words first
  const lowerInput = input.toLowerCase();
  if (COMMON_WORDS[lowerInput]) {
    return COMMON_WORDS[lowerInput];
  }

  let result = '';
  let i = 0;

  while (i < input.length) {
    let matched = false;

    // Try to match consonant + vowel combinations (longest first)
    for (const consonant of ['zh', 'ng', 'nj', 'ch']) {
      if (input.substring(i).startsWith(consonant)) {
        // Check for vowel after consonant
        for (const vowel of ['au', 'aa', 'ii', 'uu', 'ee', 'oo', 'ai', 'a', 'i', 'u', 'e', 'o']) {
          if (input.substring(i + consonant.length).startsWith(vowel)) {
            if (TAMIL_CONSONANT_VOWEL[consonant]?.[vowel]) {
              result += TAMIL_CONSONANT_VOWEL[consonant][vowel];
              i += consonant.length + vowel.length;
              matched = true;
              break;
            }
          }
        }
        if (matched) break;

        // Consonant without vowel
        if (TAMIL_CONSONANTS[consonant]) {
          result += TAMIL_CONSONANTS[consonant];
          i += consonant.length;
          matched = true;
          break;
        }
      }
    }

    if (matched) continue;

    // Try single character consonants
    const char = input[i];
    if (TAMIL_CONSONANT_VOWEL[char]) {
      // Check for vowel after consonant
      for (const vowel of ['au', 'aa', 'ii', 'uu', 'ee', 'oo', 'ai', 'a', 'i', 'u', 'e', 'o']) {
        if (input.substring(i + 1).startsWith(vowel)) {
          result += TAMIL_CONSONANT_VOWEL[char][vowel];
          i += 1 + vowel.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Consonant without vowel
      if (TAMIL_CONSONANTS[char]) {
        result += TAMIL_CONSONANTS[char];
        i++;
        matched = true;
      }
    }

    if (matched) continue;

    // Try vowels
    for (const vowel of ['au', 'aa', 'ii', 'uu', 'ee', 'oo', 'ai', 'a', 'i', 'u', 'e', 'o']) {
      if (input.substring(i).startsWith(vowel)) {
        result += TAMIL_VOWELS[vowel] || vowel;
        i += vowel.length;
        matched = true;
        break;
      }
    }

    if (matched) continue;

    // No match - keep original character (space, punctuation, etc.)
    result += input[i];
    i++;
  }

  return result;
}

/**
 * Check if text contains Tamil characters
 */
export function containsTamil(text: string): boolean {
  // Tamil Unicode range: U+0B80 to U+0BFF
  return /[\u0B80-\u0BFF]/.test(text);
}

/**
 * Get transliteration suggestions for current word
 */
export function getTransliterationSuggestions(word: string): string[] {
  const suggestions: string[] = [];

  // Try exact transliteration
  const exactMatch = transliterateTamil(word);
  if (exactMatch !== word) {
    suggestions.push(exactMatch);
  }

  // Check common words
  const lowerWord = word.toLowerCase();
  for (const [key, value] of Object.entries(COMMON_WORDS)) {
    if (key.startsWith(lowerWord)) {
      suggestions.push(value);
    }
  }

  return suggestions.slice(0, 5); // Return max 5 suggestions
}
