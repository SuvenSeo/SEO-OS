import Groq from 'groq-sdk';

/**
 * Lazy initialization of Groq clients to prevent build-time crashes.
 * Supports multiple keys for high-volume handling.
 */
let groqClients = [];
let rateLimitedUntil = {};
let groqRoundRobin = 0;

function initGroq() {
  if (groqClients.length > 0) return;
  const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  
  if (keys.length === 0) {
    console.warn('[AI] No Groq API keys configured');
    return;
  }
  groqClients = keys.map(key => new Groq({ apiKey: key }));
}

function getAvailableGroqClient() {
  initGroq();
  if (groqClients.length === 0) return null;

  const now = Date.now();
  for (let i = 0; i < groqClients.length; i++) {
    const idx = (groqRoundRobin + i) % groqClients.length;
    if (!rateLimitedUntil[idx] || rateLimitedUntil[idx] < now) {
      groqRoundRobin = (idx + 1) % groqClients.length;
      return { client: groqClients[idx], idx };
    }
  }
  // All rate limited — return the soonest-available
  const entries = Object.entries(rateLimitedUntil);
  if (entries.length === 0) return { client: groqClients[0], idx: 0 };
  const soonest = entries.sort(([, a], [, b]) => a - b)[0];
  const idx = parseInt(soonest[0]);
  return { client: groqClients[idx], idx };
}

// ─── Gemini fallback ──────────────────────────────────────────────────────────
let geminiRoundRobin = 0;

async function generateWithGemini(systemPrompt, messages, temperature = 0.7) {
  const geminiKeys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
    .split(',').map(k => k.trim()).filter(Boolean);

  if (geminiKeys.length === 0) throw new Error('[AI] No Gemini API keys configured');

  for (let attempt = 0; attempt < geminiKeys.length; attempt++) {
    const idx = (geminiRoundRobin + attempt) % geminiKeys.length;
    const apiKey = geminiKeys[idx];

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
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
            tools: [{
              function_declarations: [
                {
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
                {
                  name: 'list_gmail',
                  description: 'List recent unread emails or search emails using a Gmail query.',
                  parameters: {
                    type: 'object',
                    properties: {
                      query: { type: 'string', description: 'Gmail search query. Defaults to "is:unread"' },
                    },
                  },
                },
                {
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
                {
                  name: 'set_reminder',
                  description: 'Set a personal reminder for Suven at a specific time.',
                  parameters: {
                    type: 'object',
                    properties: {
                      message: { type: 'string', description: 'The reminder message' },
                      triggerAt: { type: 'string', description: 'ISO timestamp for when to trigger the reminder' },
                    },
                    required: ['message', 'triggerAt'],
                  },
                },
                {
                  name: 'add_task',
                  description: 'Add a new task to Suvens to-do list.',
                  parameters: {
                    type: 'object',
                    properties: {
                      title: { type: 'string', description: 'The task title' },
                      priority: { type: 'number', description: 'Priority 1 (high) to 4 (low)' },
                      deadline: { type: 'string', description: 'Optional ISO timestamp for deadline' },
                    },
                    required: ['title', 'priority'],
                  },
                },
              ]
            }],
            generationConfig: { temperature, maxOutputTokens: 2048 },
          }),
        }
      );

      if (response.status === 429) {
        geminiRoundRobin = (idx + 1) % geminiKeys.length;
        continue;
      }

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini error ${response.status}: ${err}`);
      }

      const data = await response.json();
      geminiRoundRobin = (idx + 1) % geminiKeys.length;
      
      const candidate = data.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      
      if (part?.functionCall) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_' + Math.random().toString(36).substring(7),
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          }],
        };
      }
      
      return { role: 'assistant', content: part?.text || '' };
    } catch (err) {
      if (attempt === geminiKeys.length - 1) throw err;
    }
  }
  throw new Error('[AI] All Gemini keys exhausted');
}

// ─── Main generate function ───────────────────────────────────────────────────
const PRIMARY_CHAT_MODEL = 'llama-3.3-70b-versatile';
const QUICK_MODEL = 'llama-3.1-8b-instant';
const EXTRACTION_MODEL = 'llama-3.1-8b-instant';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for real-time information.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_gmail',
      description: 'List unread emails.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_gmail_content',
      description: 'Read a Gmail message.',
      parameters: {
        type: 'object',
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a reminder.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          triggerAt: { type: 'string' },
        },
        required: ['message', 'triggerAt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_task',
      description: 'Add a task.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          priority: { type: 'number' },
          deadline: { type: 'string' },
        },
        required: ['title', 'priority'],
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
  
  const model = options.model || PRIMARY_CHAT_MODEL;
  
  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const available = getAvailableGroqClient();
  if (!available) {
    console.warn('[AI] Falling back to Gemini (No Groq keys)');
    return await generateWithGemini(systemPrompt, messages, temperature);
  }

  try {
    const completion = await available.client.chat.completions.create({
      model,
      messages: fullMessages,
      temperature,
      max_tokens,
      tools: useTools ? TOOLS : undefined,
      tool_choice: useTools ? 'auto' : undefined,
    });
    
    return completion.choices[0]?.message;
  } catch (error) {
    console.error('[AI] Groq Error:', error.message);
    return await generateWithGemini(systemPrompt, messages, temperature);
  }
}

export async function generateStructuredExtraction(prompt) {
  const message = await generateResponse(
    'You are a precise data extraction tool. Always respond with valid JSON only.',
    [{ role: 'user', content: prompt }],
    { model: EXTRACTION_MODEL, temperature: 0.1, max_tokens: 1024, useTools: false }
  );
  return message.content || '';
}
