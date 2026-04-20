/**
 * Slug Generation Utility
 *
 * Generates URL-friendly slugs from Tamil and English text
 * Preserves Tamil Unicode characters while converting to lowercase
 */

/**
 * Generates a URL-friendly slug from the given text
 *
 * @param text - The input text (Tamil or English)
 * @param maxLength - Maximum length of the slug (default: 255)
 * @returns A URL-friendly slug
 *
 * @example
 * generateSlug('பூ வாசம்') // 'பூ-வாசம்'
 * generateSlug('Hello World') // 'hello-world'
 */
export function generateSlug(text: string, maxLength: number = 255): string {
  if (!text || text.trim().length === 0) {
    return '';
  }

  return text
    .trim() // Remove leading/trailing spaces
    .toLowerCase() // Convert to lowercase
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/_/g, '-') // Replace underscores with hyphens
    .replace(/[^\u0B80-\u0BFF\w\-]/g, '') // Keep Tamil Unicode, alphanumeric, and hyphens
    .replace(/-+/g, '-') // Replace consecutive hyphens with single hyphen
    .replace(/^-+/, '') // Remove leading hyphens
    .replace(/-+$/, '') // Remove trailing hyphens
    .substring(0, maxLength); // Limit length
}

/**
 * Validates if a string is a valid slug
 *
 * @param slug - The slug to validate
 * @returns True if valid, false otherwise
 *
 * @example
 * isValidSlug('பூ-வாசம்') // true
 * isValidSlug('Hello World') // false (has space)
 */
export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length === 0) {
    return false;
  }

  // Check for invalid patterns
  if (
    slug.startsWith('-') ||
    slug.endsWith('-') ||
    slug.includes('--') ||
    slug.includes(' ')
  ) {
    return false;
  }

  // Check for special characters (only allow Tamil Unicode, alphanumeric, and hyphens)
  if (/[^\u0B80-\u0BFF\w\-]/.test(slug)) {
    return false;
  }

  return true;
}

/**
 * Generates a unique slug by appending a number if the slug already exists
 *
 * @param baseSlug - The base slug
 * @param existingSlugs - Array of existing slugs to check against
 * @returns A unique slug
 *
 * @example
 * generateUniqueSlug('பூ-வாசம்', ['பூ-வாசம்']) // 'பூ-வாசம்-1'
 */
export function generateUniqueSlug(
  baseSlug: string,
  existingSlugs: string[]
): string {
  let uniqueSlug = baseSlug;
  let counter = 1;

  while (existingSlugs.includes(uniqueSlug)) {
    uniqueSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  return uniqueSlug;
}
