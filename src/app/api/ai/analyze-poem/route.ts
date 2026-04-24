import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
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
      model: 'gpt-4',
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
    });

    const analysisText = completion.choices[0].message.content;

    if (!analysisText) {
      throw new Error('No analysis received from OpenAI');
    }

    // Parse JSON response
    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', analysisText);
      // Return default analysis if parsing fails
      return NextResponse.json({
        success: true,
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

  } catch (error: any) {
    console.error('Error analyzing poem:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      type: error.type,
    });

    // Return default analysis instead of error for better UX
    return NextResponse.json({
      success: true,
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
