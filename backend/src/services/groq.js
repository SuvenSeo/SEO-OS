const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000; // ms

// Define tool schemas
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

/**
 * Generate an AI response from Groq.
 * @param {string} systemPrompt - The system prompt
 * @param {Array} messages - Conversation messages
 * @param {object} options - Optional overrides
 * @returns {Promise<object>} The raw completion choice
 */
async function generateResponse(systemPrompt, messages, options = {}) {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.7,
    max_tokens = 2048,
    useTools = true,
  } = options;

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: fullMessages,
        temperature,
        max_tokens,
        tools: useTools ? TOOLS : undefined,
        tool_choice: 'auto',
      });

      return completion.choices[0];
    } catch (error) {
      if (error.status === 429 && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (error.status === 503 && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Generate a structured JSON extraction from text.
 */
async function generateStructuredExtraction(prompt) {
  const choice = await generateResponse(
    'You are a precise data extraction tool. Always respond with valid JSON only, no additional text.',
    [{ role: 'user', content: prompt }],
    { temperature: 0.2, max_tokens: 1024, useTools: false }
  );
  return choice.message.content || '';
}

module.exports = { generateResponse, generateStructuredExtraction, TOOLS };
