/**
 * Tests for AI Poem Analysis API
 */

import { POST } from '@/app/api/ai/analyze-poem/route';
import { NextRequest } from 'next/server';

describe('AI Poem Analysis API', () => {
  const mockPoemData = {
    title: 'அம்மா',
    body: 'அம்மா என்றால் அன்பு\nஅம்மா என்றால் அரவணைப்பு\nஅம்மா இல்லாத வாழ்க்கை\nவெறும் பாழடைந்த நிலம்',
    author: 'Test Author',
  };

  it('should analyze Tamil poem and return emotion data', async () => {
    const request = new NextRequest('http://localhost:3000/api/ai/analyze-poem', {
      method: 'POST',
      body: JSON.stringify(mockPoemData),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.analysis).toBeDefined();
    expect(data.analysis.emotion).toBeDefined();
    expect(data.analysis.mood).toBeDefined();
  });

  it('should return 400 if title is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/ai/analyze-poem', {
      method: 'POST',
      body: JSON.stringify({ body: 'test', author: 'test' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('should return 400 if body is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/ai/analyze-poem', {
      method: 'POST',
      body: JSON.stringify({ title: 'test', author: 'test' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('should handle OpenAI API errors gracefully', async () => {
    // Test with invalid API key scenario
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'invalid-key';

    const request = new NextRequest('http://localhost:3000/api/ai/analyze-poem', {
      method: 'POST',
      body: JSON.stringify(mockPoemData),
    });

    const response = await POST(request);

    // Restore original key
    process.env.OPENAI_API_KEY = originalKey;

    expect(response.status).toBe(500);
  }, 10000);
});
