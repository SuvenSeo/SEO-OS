const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000; // ms

/**
 * Generate an AI response from Groq.
 * @param {string} systemPrompt - The system prompt (loaded from agent_config)
 * @param {Array<{role: string, content: string}>} messages - Conversation messages
 * @param {object} options - Optional overrides (model, temperature, max_tokens)
 * @returns {Promise<string>} The AI response text
 */
async function generateResponse(systemPrompt, messages, options = {}) {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.7,
    max_tokens = 2048,
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
      });

      return completion.choices[0]?.message?.content || '';
    } catch (error) {
      // Rate limit handling
      if (error.status === 429 && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        console.warn(`[Groq] Rate limited. Retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Model overloaded
      if (error.status === 503 && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        console.warn(`[Groq] Service overloaded. Retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error('[Groq] API Error:', error.message);
      throw error;
    }
  }
}

/**
 * Generate a structured JSON extraction from text.
 * Uses a lower temperature for deterministic output.
 */
async function generateStructuredExtraction(prompt) {
  return generateResponse(
    'You are a precise data extraction tool. Always respond with valid JSON only, no additional text.',
    [{ role: 'user', content: prompt }],
    { temperature: 0.2, max_tokens: 1024 }
  );
}

module.exports = { generateResponse, generateStructuredExtraction };
