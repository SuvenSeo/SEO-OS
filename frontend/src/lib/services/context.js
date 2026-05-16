import supabase from '../config/supabase.js';
import { generateStructuredExtraction } from './groq.js';

// ─── Simple in-memory cache ───────────────────────────────────────────────────
const _cache = {};
function getCache(key) {
  const e = _cache[key];
  return e && Date.now() < e.exp ? e.val : null;
}
function setCache(key, val, ttlMs) {
  _cache[key] = { val, exp: Date.now() + ttlMs };
}

const TTL_5MIN  = 5  * 60 * 1000;
const TTL_1MIN  = 1  * 60 * 1000;
let hasWarnedMissingKnowledgeFts = false;

const GREETING_ONLY_PATTERN = /^(hi|hii+|hello+|helloo+|hey+|heyy+|yo+|sup+|hola+|good (morning|afternoon|evening)|what'?s up|whats up|how are you)\W*$/i;
const RESPONSE_GUARDRAILS = `NON-NEGOTIABLE RESPONSE RULES:
- Follow explicit user instructions first (especially reset/delete/clear requests).
- Never invent or retain reminders/tasks the user asked to delete.
- Never claim "we just started" or "I don't know you" when context contains prior history.
- Do not shame, scold, or refuse normal conversation. Stay calm, direct, and helpful.
- If the user sends a simple greeting or small talk, reply like a warm human conversation (do not dump task/reminder state unless asked).
- Keep the tone natural and collaborative; avoid robotic scripts and repeated fallback wording.
- Before finalizing your answer, self-check for contradiction with the latest user message and fix it.
- If unsure, ask one clarifying question instead of guessing.`;

async function rerankKnowledgeSemantically(userMessage, candidates) {
  if (!candidates || candidates.length <= 1) return (candidates || []).slice(0, 5);

  const shortlist = candidates.slice(0, 12);
  const candidateText = shortlist
    .map((c, i) => `${i + 1}. [${c.source}] ${c.content.replace(/\s+/g, ' ').trim().slice(0, 240)}`)
    .join('\n\n');

  const raw = await generateStructuredExtraction(`Pick the most semantically relevant knowledge entries for the query.
Return JSON only:
{
  "top_indexes": [1, 2, 3, 4, 5]
}
Rules:
- Indexes refer to the numbered list below.
- Prefer entries that answer intent, not keyword overlap.
- Return up to 5 indexes, most relevant first.

USER QUERY:
${userMessage}

CANDIDATES:
${candidateText}`);

  try {
    const parsed = JSON.parse((raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    const indexes = Array.isArray(parsed.top_indexes) ? parsed.top_indexes : [];
    const picked = indexes
      .map(n => shortlist[Number(n) - 1])
      .filter(Boolean);
    if (picked.length > 0) return picked.slice(0, 5);
  } catch (error) {
    console.warn('[Context] semantic rerank parse failed:', error.message);
  }

  return shortlist.slice(0, 5);
}

async function fetchRelevantKnowledge(userMessage, keywords) {
  // Use cache to avoid redundant LLM semantic reranking calls (5 min TTL)
  // Cache key: normalized message + sorted keywords to prevent redundant LLM calls during tool loop or repeated messages
  const normalizedMsg = userMessage.trim().toLowerCase().replace(/\s+/g, ' ');
  const cacheKey = `knowledge:${normalizedMsg}:${[...keywords].sort().join(',')}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const ftsQuery = keywords.join(' | ');
  const baseQuery = supabase
    .from('knowledge_base')
    .select('content, source, created_at')
    .order('created_at', { ascending: false })
    .limit(12);

  let results = [];
  const { data: ftsRows, error: ftsError } = await baseQuery
    .textSearch('fts', ftsQuery, { type: 'plain', config: 'english' });

  if (!ftsError) {
    results = await rerankKnowledgeSemantically(userMessage, ftsRows || []);
  } else {
    const message = (ftsError.message || '').toLowerCase();
    const isMissingFts = ftsError.code === '42703' || message.includes('fts');

    if (!isMissingFts) {
      console.error('[Context] knowledge FTS query failed:', ftsError.message);
    } else {
      if (!hasWarnedMissingKnowledgeFts) {
        console.warn('[Context] knowledge_base.fts missing; falling back to keyword ILIKE search.');
        hasWarnedMissingKnowledgeFts = true;
      }

      const fallbackFilter = keywords
        .map(k => `content.ilike.%${k.replace(/,/g, ' ')}%`)
        .join(',');

      const { data: fallbackRows, error: fallbackError } = await supabase
        .from('knowledge_base')
        .select('content, source, created_at')
        .or(fallbackFilter)
        .order('created_at', { ascending: false })
        .limit(12);

      if (!fallbackError) {
        results = await rerankKnowledgeSemantically(userMessage, fallbackRows || []);
      } else {
        console.error('[Context] knowledge fallback query failed:', fallbackError.message);
      }
    }
  }

  setCache(cacheKey, results, TTL_5MIN);
  return results;
}

function isGreetingOnlyMessage(message = '') {
  const text = (message || '').trim();
  if (!text || text.length > 60) return false;
  if (/[/?]/.test(text) || /\b(remind|task|deadline|clear|delete|remove|save|research|read)\b/i.test(text)) {
    return false;
  }
  return GREETING_ONLY_PATTERN.test(text);
}

/**
 * Build the full dynamic context for the AI brain.
 * Called before every Groq API call to inject current state.
 * @param {string} [userMessage] - Optional current message for knowledge_base FTS search
 * @returns {Promise<string>} Formatted context string
 */
export async function buildContext(userMessage = '') {
  const sections = [];
  const now = new Date();
  const greetingOnly = isGreetingOnlyMessage(userMessage);

  // 0. Current Date/Time
  sections.push(`CURRENT DATE/TIME: ${now.toISOString()} (Sri Lanka: ${now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })})`);

  // Run all DB queries in parallel — cached where data rarely changes
  const cachedCore    = getCache('core_memory');
  const cachedPatterns = getCache('patterns');
  const cachedIdeas   = getCache('ideas');
  const cachedWorking = getCache('working_memory');

  const promises = [
    // Always fresh: open tasks
    supabase.from('tasks').select('id, title, description, deadline, priority, status, follow_up_count, tier').in('status', ['open', 'snoozed']).order('priority', { ascending: true }),
    // Cached 1 min: working memory to reduce redundant database calls
    cachedWorking ? Promise.resolve({ data: cachedWorking }) : supabase.from('working_memory').select('key, value, expires_at').or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`),
    // Cached 5 min: core memory
    cachedCore    ? Promise.resolve({ data: cachedCore })    : supabase.from('core_memory').select('key, value').order('key'),
    // Cached 5 min: patterns
    cachedPatterns ? Promise.resolve({ data: cachedPatterns }) : supabase.from('patterns').select('observation, confidence').order('created_at', { ascending: false }).limit(8),
    // Cached 5 min: raw ideas
    cachedIdeas   ? Promise.resolve({ data: cachedIdeas })   : supabase.from('ideas').select('content').eq('status', 'raw').order('created_at', { ascending: false }).limit(5),
  ];

  const [
    { data: tasks },
    { data: workingMemory },
    { data: coreMemory },
    { data: patterns },
    { data: ideas },
  ] = await Promise.all(promises);

  // Update caches for slow-changing data
  if (!cachedWorking  && workingMemory) setCache('working_memory', workingMemory, TTL_1MIN);
  if (!cachedCore     && coreMemory)    setCache('core_memory',    coreMemory,    TTL_5MIN);
  if (!cachedPatterns && patterns)      setCache('patterns',       patterns,       TTL_5MIN);
  if (!cachedIdeas    && ideas)         setCache('ideas',          ideas,          TTL_5MIN);

  // (History is now handled via the messages array in the chat completion call to prevent redundancy)

  if (!greetingOnly && tasks && tasks.length > 0) {
    const taskList = tasks.map(t => {
      let line = `  [T${t.tier}] P${t.priority}: ${t.title}`;
      if (t.deadline) line += ` [due: ${new Date(t.deadline).toLocaleDateString('en-US', { timeZone: 'Asia/Colombo' })}]`;
      if (t.status === 'snoozed') line += ' (snoozed)';
      if (t.follow_up_count > 0) line += ` [followed up ${t.follow_up_count}x]`;
      return line;
    }).join('\n');
    sections.push(`OPEN TASKS:\n${taskList}`);
  }

  if (coreMemory && coreMemory.length > 0) {
    sections.push(`CORE MEMORY:\n${coreMemory.map(m => `  ${m.key}: ${m.value}`).join('\n')}`);
  }

  if (workingMemory && workingMemory.length > 0) {
    sections.push(`WORKING MEMORY (short-term):\n${workingMemory.map(m => `  ${m.key}: ${m.value}`).join('\n')}`);
  }

  if (!greetingOnly && patterns && patterns.length > 0) {
    sections.push(`OBSERVED PATTERNS:\n${patterns.map(p => `  [${p.confidence}] ${p.observation}`).join('\n')}`);
  }

  if (!greetingOnly && ideas && ideas.length > 0) {
    sections.push(`RECENT RAW IDEAS:\n${ideas.map(i => `  - ${i.content}`).join('\n')}`);
  }

  // RELEVANT KNOWLEDGE — Full-text search on knowledge_base using user's message
  if (!greetingOnly && userMessage && userMessage.length > 3) {
    const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'been', 'they', 'what', 'just', 'your', 'about']);
    const keywords = userMessage
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))
      .slice(0, 8);

    if (keywords.length > 0) {
      const knowledge = await fetchRelevantKnowledge(userMessage, keywords);

      if (knowledge.length > 0) {
        const knowledgeStr = knowledge
          .map(k => `  [${k.source}] ${k.content.substring(0, 300)}${k.content.length > 300 ? '...' : ''}`)
          .join('\n\n');
        sections.push(`RELEVANT KNOWLEDGE (from WhatsApp import and saved notes):\n${knowledgeStr}`);
      }
    }
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Load the system prompt from agent_config — cached for 5 minutes.
 * @returns {Promise<string>}
 */
async function loadSystemPrompt() {
  const cached = getCache('system_prompt');
  if (cached) return cached;

  const { data, error } = await supabase
    .from('agent_config')
    .select('value')
    .eq('key', 'system_prompt')
    .single();

  if (error || !data) {
    console.error('[Context] Failed to load system prompt:', error?.message);
    return 'You are SEOS, a personal AI assistant.';
  }

  setCache('system_prompt', data.value, TTL_5MIN);
  return data.value;
}

/**
 * Get the full system prompt with injected context.
 * @param {string} [userMessage] - Current user message for knowledge_base search
 */
export async function getFullPrompt(userMessage = '') {
  const [systemPrompt, context] = await Promise.all([
    loadSystemPrompt(),
    buildContext(userMessage),
  ]);

  return `${systemPrompt}\n\n===== RESPONSE RULES =====\n\n${RESPONSE_GUARDRAILS}\n\n===== CURRENT CONTEXT =====\n\n${context}`;
}
