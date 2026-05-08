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
const QUICK_MODEL = 'llama-3.1-8b-instant';
const CODE_MODEL = process.env.GROQ_CODE_MODEL || 'qwen-2.5-coder-32b';
const FALLBACK_MODEL = 'llama3-70b-8192';
const EXTRACTION_MODEL = 'llama-3.1-8b-instant';

function classifyModelRoute(messages = []) {
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const text = lastUserMessage.toLowerCase();

  const creativeHints = ['poem', 'story', 'caption', 'creative', 'rewrite this nicely', 'brainstorm names'];
  const codeHints = ['code', 'bug', 'debug', 'stack trace', 'api route', 'function', 'typescript', 'javascript', 'sql', 'regex', 'refactor'];
  const deepHints = ['strategy', 'roadmap', 'tradeoff', 'analyze', 'architecture', 'plan', 'compare'];

  if (creativeHints.some(h => text.includes(h))) {
    return { type: 'creative', model: null };
  }
  if (codeHints.some(h => text.includes(h)) || /```[\s\S]*```/.test(lastUserMessage)) {
    return { type: 'code', model: CODE_MODEL };
  }
  if (deepHints.some(h => text.includes(h)) || lastUserMessage.length > 220) {
    return { type: 'deep', model: PRIMARY_CHAT_MODEL };
  }
  return { type: 'quick', model: QUICK_MODEL };
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for real-time information, research topics, or latest news.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_gmail',
      description: 'List recent unread emails or search emails using a Gmail query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Gmail search query (e.g. "is:unread", "from:university"). Defaults to "is:unread"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_gmail_content',
      description: 'Read the full content of a specific Gmail message by its ID.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'The unique Gmail message ID' },
        },
        required: ['messageId'],
      },
    },
  },
];

export async function generateResponse(systemPrompt, messages, options = {}) {
  const { 
    temperature = 0.7, 
    max_tokens = 2048, 
    useTools = true 
  } = options;
  
  const route = options.model ? { type: 'manual', model: options.model } : classifyModelRoute(messages);

  if (route.type === 'creative') {
    return { content: await generateWithGemini(systemPrompt, messages, temperature) };
  }

  let model = route.model || PRIMARY_CHAT_MODEL;

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
        tools: useTools ? TOOLS : undefined,
        tool_choice: useTools ? 'auto' : undefined,
      });
      
      return completion.choices[0]?.message;
    } catch (error) {
      if ((error.status === 400 || error.status === 404) && model !== PRIMARY_CHAT_MODEL) {
        model = PRIMARY_CHAT_MODEL;
        continue;
      }
      if (error.status === 429 || error.status === 503) {
        const resetMs = 60 * 60 * 1000;
        rateLimitedUntil[idx] = Date.now() + resetMs;
        continue;
      }
      throw error;
    }
  }

  // Fallback to Gemini if Groq fails
  return { content: await generateWithGemini(systemPrompt, messages, temperature) };
}

export async function generateStructuredExtraction(prompt) {
  const message = await generateResponse(
    'You are a precise data extraction tool. Always respond with valid JSON only, no additional text.',
    [{ role: 'user', content: prompt }],
    { model: EXTRACTION_MODEL, temperature: 0.2, max_tokens: 1024, useTools: false }
  );
  return message.content || '';
}
