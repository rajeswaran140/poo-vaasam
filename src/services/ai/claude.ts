/**
 * Claude AI Service for Poetry Guide Chat
 */

import Anthropic from '@anthropic-ai/sdk';

// Lazy initialize Anthropic client
function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || 'dummy-key-for-build',
  });
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface PoemContext {
  title: string;
  author: string;
  body: string;
  description?: string;
  tags?: Array<{ name: string }>;
  categories?: Array<{ name: string }>;
}

/**
 * System prompt for Poetry Guide
 */
const POETRY_GUIDE_SYSTEM_PROMPT = `நீங்கள் ஒரு தமிழ் இலக்கிய நிபுணர் மற்றும் கவிதை வழிகாட்டி. உங்கள் பங்கு:

1. தமிழ் கவிதைகளின் பொருள் மற்றும் அர்த்தத்தை விளக்குதல்
2. சொற்களின் பொருள் மற்றும் பயன்பாட்டை விவரித்தல்
3. கவிதையின் உணர்வு மற்றும் தீம்களை ஆராய்தல்
4. வரலாற்று மற்றும் கலாச்சார சூழலை வழங்குதல்
5. தமிழ் இலக்கியம் பற்றிய கேள்விகளுக்கு பதிலளித்தல்

முக்கியமான வழிகாட்டுதல்கள்:
- எளிமையான தமிழில் பதிலளிக்கவும்
- கவிதையின் அழகை சேதப்படுத்தாமல் விளக்கவும்
- வாசகர்களை சிந்திக்க ஊக்குவிக்கவும்
- தவறான தகவல் வழங்காதீர்கள்
- தெரியாவிட்டால் நேர்மையாக கூறவும்
- மரியாதையான மற்றும் கல்வி சார்ந்த தொனியில் பேசவும்

You are a Tamil literature expert and poetry guide. Your role is to:
- Explain poems in simple Tamil
- Provide cultural and historical context
- Help readers appreciate Tamil poetry
- Answer questions about Tamil literature

Always be respectful, educational, and encouraging.`;

/**
 * Generate chat response using Claude AI
 */
export async function generateChatResponse(
  messages: ChatMessage[],
  poemContext?: PoemContext
): Promise<string> {
  try {
    const anthropic = getAnthropicClient();

    // Prepare context about the poem if provided
    let systemPrompt = POETRY_GUIDE_SYSTEM_PROMPT;

    if (poemContext) {
      const contextInfo = `

தற்போதைய கவிதை சூழல்:
தலைப்பு: ${poemContext.title}
ஆசிரியர்: ${poemContext.author}
${poemContext.description ? `விளக்கம்: ${poemContext.description}` : ''}
${poemContext.tags && poemContext.tags.length > 0 ? `குறிச்சொற்கள்: ${poemContext.tags.map(t => t.name).join(', ')}` : ''}

கவிதை உரை:
${poemContext.body}

---

Current Poem Context:
Title: ${poemContext.title}
Author: ${poemContext.author}
${poemContext.description ? `Description: ${poemContext.description}` : ''}
${poemContext.tags && poemContext.tags.length > 0 ? `Tags: ${poemContext.tags.map(t => t.name).join(', ')}` : ''}

Poem Text:
${poemContext.body}`;

      systemPrompt += contextInfo;
    }

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: 0.7,
    });

    // Extract text from response
    const textContent = response.content.find(block => block.type === 'text');
    return textContent ? (textContent as any).text : 'மன்னிக்கவும், பதில் உருவாக்க முடியவில்லை.';
  } catch (error) {
    console.error('Error generating chat response:', error);
    throw new Error('Failed to generate chat response');
  }
}

/**
 * Quick poetry question without context
 */
export async function askPoetryQuestion(question: string): Promise<string> {
  return generateChatResponse([
    {
      role: 'user',
      content: question,
    },
  ]);
}

/**
 * Explain a specific poem
 */
export async function explainPoem(
  poemContext: PoemContext,
  specificQuestion?: string
): Promise<string> {
  const question = specificQuestion || 'இந்த கவிதையின் பொருள் என்ன? எளிமையாக விளக்குங்கள்.';

  return generateChatResponse(
    [
      {
        role: 'user',
        content: question,
      },
    ],
    poemContext
  );
}

/**
 * Generate conversation suggestions
 */
export function generateSuggestions(poemContext?: PoemContext): string[] {
  const generalSuggestions = [
    'தமிழ் கவிதை என்றால் என்ன?',
    'கவிதை எழுதுவது எப்படி?',
    'பிரபலமான தமிழ் கவிஞர்கள் யார்?',
  ];

  const poemSpecificSuggestions = [
    'இந்த கவிதையின் பொருள் என்ன?',
    'இந்த கவிதையின் உணர்வு என்ன?',
    'இந்த கவிதையில் என்ன இலக்கிய உத்திகள் பயன்படுத்தப்பட்டுள்ளன?',
    'இந்த வார்த்தைகளின் பொருள் என்ன?',
    'ஆசிரியர் என்ன சொல்ல முயற்சிக்கிறார்?',
  ];

  return poemContext ? poemSpecificSuggestions : generalSuggestions;
}
