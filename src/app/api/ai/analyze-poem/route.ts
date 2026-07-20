import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { RateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Unauthenticated + spends a GPT-4 call per request — cap per IP.
const limiter = new RateLimiter({ windowMs: 60_000, max: 20 });

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  try {
    const { title, body, author } = await request.json();

    if (!title || !body) {
      return NextResponse.json(
        { error: 'Title and body are required' },
        { status: 400 }
      );
    }

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your-openai-api-key-here') {
      console.warn('OpenAI API key not configured, using default analysis');

      // Return default analysis instead of error
      return NextResponse.json({
        success: true,
        analysis: {
          emotion: 'sad',
          mood: 'somber',
          themes: ['இழப்பு', 'நினைவுகள்', 'உணர்வு'],
          musicRecommendation: 'sad_piano',
          ttsSpeed: 0.85,
          ttsPitch: 0.9,
          summary: 'உணர்ச்சிபூர்வமான கவிதை',
        },
      });
    }

    // Analyze poem emotion and context using OpenAI
    const completion = await openai.chat.completions.create({
      // Small structured-JSON classification (emotion → music/TTS params).
      // gpt-4o-mini is ~99% cheaper than the legacy gpt-4 with equal/better
      // quality on a task this constrained.
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert Tamil literature analyst. Analyze Tamil poems and provide accurate emotional context.

Your response must be valid JSON with this exact structure:
{
  "emotion": "one of: sad, joyful, reflective, longing, devotional, patriotic, romantic, melancholic, hopeful",
  "mood": "one of: somber, uplifting, peaceful, intense, gentle, powerful",
  "themes": ["array", "of", "themes"],
  "musicRecommendation": "sad_piano | uplifting_strings | peaceful_ambient | emotional_piano | devotional_instrumental",
  "ttsSpeed": "number between 0.7 and 1.2 (slower for sad, faster for joyful)",
  "ttsPitch": "number between 0.8 and 1.2 (lower for somber, higher for joyful)",
  "summary": "brief Tamil summary of emotional essence"
}`
        },
        {
          role: 'user',
          content: `Analyze this Tamil poem:

Title: ${title}
Author: ${author || 'Unknown'}

Poem:
${body}

Provide emotional analysis in JSON format.`
        }
      ],
      temperature: 0.3,
      max_tokens: 500,
      // Guarantee valid JSON back (the prompt asks for JSON) so the parse below
      // rarely has to fall through to the degraded default.
      response_format: { type: 'json_object' },
    });

    const analysisText = completion.choices[0].message.content;

    if (!analysisText) {
      throw new Error('No analysis received from OpenAI');
    }

    // Parse JSON response
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch {
      logger.error('Failed to parse OpenAI poem-analysis response');
      // Return default analysis if parsing fails (flagged degraded, see below).
      return NextResponse.json({
        success: true,
        degraded: true,
        analysis: {
          emotion: 'reflective',
          mood: 'somber',
          themes: ['இலக்கியம்', 'உணர்வு'],
          musicRecommendation: 'sad_piano',
          ttsSpeed: 0.85,
          ttsPitch: 0.9,
          summary: 'உணர்ச்சிபூர்வமான கவிதை',
        },
      });
    }

    return NextResponse.json({
      success: true,
      analysis,
    });

  } catch (error) {
    // Log the real failure server-side so outages are observable.
    logger.error('Poem analysis failed; serving default analysis', error);

    // Graceful UX fallback: still return a usable analysis, but flag it as
    // `degraded` so callers (and the admin) can tell the AI path actually failed
    // rather than genuinely classifying the poem as "sad".
    return NextResponse.json({
      success: true,
      degraded: true,
      analysis: {
        emotion: 'sad',
        mood: 'somber',
        themes: ['இழப்பு', 'நினைவுகள்'],
        musicRecommendation: 'sad_piano',
        ttsSpeed: 0.85,
        ttsPitch: 0.9,
        summary: 'உணர்ச்சிபூர்வமான கவிதை',
      },
    });
  }
}
