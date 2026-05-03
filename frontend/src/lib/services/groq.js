import Groq from 'groq-sdk';

let groq;

function getGroqClient() {
  if (!groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('[SEOS] Missing GROQ_API_KEY environment variable');
    groq = new Groq({ apiKey });
  }
  return groq;
}

// Primary: llama-3.1-8b-instant — 500K TPD (5x more than 70b), faster
// Fallback: llama3-70b-8192 — different quota pool on Groq
// Last resort: Google Gemini Flash — separate provider, 1M tokens/day free
const PRIMARY_MODEL = 'llama-3.1-8b-instant';
const FALLBACK_MODEL = 'llama3-70b-8192';

/**
 * Generate response via Google Gemini as last-resort fallback.
 */
async function generateWithGemini(systemPrompt, messages, temperature = 0.7) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('[SEOS] No GEMINI_API_KEY set for fallback');

  const contents = [
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature, maxOutputTokens: 2048 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Generate an AI response — tries Groq first, falls back to Gemini on rate limit.
 */
export async function generateResponse(systemPrompt, messages, options = {}) {
  const { model = PRIMARY_MODEL, temperature = 0.7, max_tokens = 2048 } = options;

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  // Try primary Groq model
  try {
    const completion = await getGroqClient().chat.completions.create({
      model,
      messages: fullMessages,
      temperature,
      max_tokens,
    });
    return completion.choices[0]?.message?.content || '';
  } catch (error) {
    if (error.status === 429 || error.status === 503) {
      console.warn(`[Groq] ${model} rate limited, trying fallback model...`);
      // Try fallback Groq model (different quota pool)
      try {
        const completion = await getGroqClient().chat.completions.create({
          model: FALLBACK_MODEL,
          messages: fullMessages,
          temperature,
          max_tokens,
        });
        console.log('[Groq] Fallback model succeeded');
        return completion.choices[0]?.message?.content || '';
      } catch (fallbackError) {
        if (fallbackError.status === 429 || fallbackError.status === 503) {
          console.warn('[Groq] Fallback also rate limited, switching to Gemini...');
          try {
            const reply = await generateWithGemini(systemPrompt, messages, temperature);
            console.log('[Gemini] Fallback succeeded');
            return reply;
          } catch (geminiError) {
            console.error('[Gemini] Fallback failed:', geminiError.message);
            throw new Error('All AI providers are currently rate limited. Please try again in a few minutes.');
          }
        }
        throw fallbackError;
      }
    }
    console.error('[Groq] API Error:', error.message);
    throw error;
  }
}

/**
 * Generate a structured JSON extraction from text.
 */
export async function generateStructuredExtraction(prompt) {
  return generateResponse(
    'You are a precise data extraction tool. Always respond with valid JSON only, no additional text.',
    [{ role: 'user', content: prompt }],
    { temperature: 0.2, max_tokens: 1024 }
  );
}
