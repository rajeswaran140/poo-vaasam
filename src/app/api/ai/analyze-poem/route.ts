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
    const analysis = JSON.parse(analysisText);

    return NextResponse.json({
      success: true,
      analysis,
    });

  } catch (error: any) {
    console.error('Error analyzing poem:', error);
    return NextResponse.json(
      {
        error: 'Failed to analyze poem',
        details: error.message
      },
      { status: 500 }
    );
  }
}
