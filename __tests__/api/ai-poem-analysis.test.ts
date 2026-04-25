/** @jest-environment node */
/**
 * Tests for AI Poem Analysis API
 */

// Use module registry to get the shared create mock after import
const mockAnalysis = {
  emotion: 'love',
  mood: 'tender',
  themes: ['motherhood', 'love'],
  musicRecommendation: 'emotional_piano',
  ttsSpeed: 0.9,
  ttsPitch: 1.0,
  summary: 'அன்பின் கவிதை',
};

jest.mock('openai', () => {
  const createMock = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({
      emotion: 'love', mood: 'tender', themes: ['motherhood'],
      musicRecommendation: 'emotional_piano', ttsSpeed: 0.9, ttsPitch: 1.0, summary: 'test',
    }) } }],
  });
  const MockClass = jest.fn().mockReturnValue({ chat: { completions: { create: createMock } } });
  (MockClass as any).__createMock = createMock;
  return MockClass;
});

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

  it('should return fallback analysis when OpenAI API key is not configured', async () => {
    // Without OPENAI_API_KEY set, route returns a default fallback analysis
    const request = new NextRequest('http://localhost:3000/api/ai/analyze-poem', {
      method: 'POST',
      body: JSON.stringify(mockPoemData),
    });

    const response = await POST(request);
    const data = await response.json();

    // Route returns 200 with fallback analysis (not 500) when no API key is configured
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.analysis).toBeDefined();
    expect(data.analysis.emotion).toBeDefined();
  }, 10000);
});
