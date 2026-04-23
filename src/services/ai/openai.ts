/**
 * OpenAI Service for Semantic Search and Embeddings
 */

import OpenAI from 'openai';

// Lazy initialize OpenAI client
function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-build',
  });
}

/**
 * Generate embedding vector for text
 * Using text-embedding-3-small for cost-effectiveness
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const openai = getOpenAIClient();
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  try {
    const openai = getOpenAIClient();
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
      encoding_format: 'float',
    });

    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('Error generating batch embeddings:', error);
    throw new Error('Failed to generate batch embeddings');
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Prepare text for embedding (combine title and body)
 */
export function prepareTextForEmbedding(content: {
  title: string;
  body: string;
  description?: string;
  author?: string;
}): string {
  const parts = [
    content.title,
    content.description || '',
    content.body.substring(0, 1000), // Limit body to first 1000 chars
    content.author ? `ஆசிரியர்: ${content.author}` : '',
  ];

  return parts.filter(Boolean).join('\n\n');
}

/**
 * Semantic search across content
 */
export async function semanticSearch(
  query: string,
  contentItems: Array<{
    id: string;
    title: string;
    body: string;
    description?: string;
    author?: string;
    embedding?: number[];
  }>,
  limit: number = 10
): Promise<Array<{ id: string; similarity: number }>> {
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // Calculate similarities
  const results = contentItems
    .filter(item => item.embedding) // Only items with embeddings
    .map(item => ({
      id: item.id,
      similarity: cosineSimilarity(queryEmbedding, item.embedding!),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return results;
}
