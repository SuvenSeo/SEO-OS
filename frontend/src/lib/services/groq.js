import Groq from 'groq-sdk';

// ─── Multi-key pool ───────────────────────────────────────────────────────────
// Set GROQ_API_KEYS as comma-separated keys in Vercel env vars for unlimited usage
// e.g. GROQ_API_KEYS=key1,key2,key3
// Falls back to single GROQ_API_KEY if GROQ_API_KEYS not set
const GROQ_KEYS = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);

const GEMINI_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);

if (GROQ_KEYS.length === 0) console.error('[AI] No Groq API keys configured!');

// Lazy-init Groq clients, one per key
const groqClients = GROQ_KEYS.map(key => new Groq({ apiKey: key }));

// Track rate-limited keys: index -> expiry timestamp
const rateLimitedUntil = {};
let groqRoundRobin = 0;

function getAvailableGroqClient() {
  const now = Date.now();
  for (let i = 0; i < groqClients.length; i++) {
    const idx = (groqRoundRobin + i) % groqClients.length;
    if (!rateLimitedUntil[idx] || rateLimitedUntil[idx] < now) {
      groqRoundRobin = (idx + 1) % groqClients.length;
      return { client: groqClients[idx], idx };
    }
  }
  // All rate limited — return the soonest-available
  const soonest = Object.entries(rateLimitedUntil).sort(([, a], [, b]) => a - b)[0];
  const idx = parseInt(soonest[0]);
  return { client: groqClients[idx], idx };
}

// ─── Gemini fallback ──────────────────────────────────────────────────────────
let geminiRoundRobin = 0;

async function generateWithGemini(systemPrompt, messages, temperature = 0.7) {
  if (GEMINI_KEYS.length === 0) throw new Error('[AI] No Gemini API keys configured');

  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const idx = (geminiRoundRobin + attempt) % GEMINI_KEYS.length;
    const apiKey = GEMINI_KEYS[idx];

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    try {
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

      if (response.status === 429) {
        console.warn(`[Gemini] Key ${idx} rate limited, trying next...`);
        geminiRoundRobin = (idx + 1) % GEMINI_KEYS.length;
        continue;
      }

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini error ${response.status}: ${err}`);
      }

      const data = await response.json();
      geminiRoundRobin = (idx + 1) % GEMINI_KEYS.length;
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (err) {
      if (attempt === GEMINI_KEYS.length - 1) throw err;
    }
  }
  throw new Error('[AI] All Gemini keys exhausted');
}

// ─── Main generate function ───────────────────────────────────────────────────
const PRIMARY_CHAT_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama3-70b-8192';
const EXTRACTION_MODEL = 'llama-3.1-8b-instant';

export async function generateResponse(systemPrompt, messages, options = {}) {
  const { model = PRIMARY_CHAT_MODEL, temperature = 0.7, max_tokens = 1500 } = options;

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  // Try each available Groq key in rotation
  for (let attempt = 0; attempt < Math.max(GROQ_KEYS.length, 1); attempt++) {
    const { client, idx } = getAvailableGroqClient();

    try {
      const completion = await client.chat.completions.create({
        model,
        messages: fullMessages,
        temperature,
        max_tokens,
      });
      return completion.choices[0]?.message?.content || '';
    } catch (error) {
      if (error.status === 429 || error.status === 503) {
        // Parse reset time from error if available, default 1 hour
        const resetMs = 60 * 60 * 1000;
        rateLimitedUntil[idx] = Date.now() + resetMs;
        console.warn(`[Groq] Key ${idx} (${model}) rate limited, rotating...`);
        continue;
      }
      console.error('[Groq] Error:', error.message);
      throw error;
    }
  }

  // All Groq keys exhausted for primary model — try fallback model
  console.warn('[Groq] All keys rate limited on primary model, trying fallback model...');
  const { client: fbClient, idx: fbIdx } = getAvailableGroqClient();
  try {
    const completion = await fbClient.chat.completions.create({
      model: FALLBACK_MODEL,
      messages: fullMessages,
      temperature,
      max_tokens,
    });
    return completion.choices[0]?.message?.content || '';
  } catch (fallbackError) {
    if (fallbackError.status === 429 || fallbackError.status === 503) {
      console.warn('[Groq] Fallback model also limited, switching to Gemini...');
      return await generateWithGemini(systemPrompt, messages, temperature);
    }
    throw fallbackError;
  }
}

export async function generateStructuredExtraction(prompt) {
  return generateResponse(
    'You are a precise data extraction tool. Always respond with valid JSON only, no additional text.',
    [{ role: 'user', content: prompt }],
    { model: EXTRACTION_MODEL, temperature: 0.2, max_tokens: 1024 }
  );
}
