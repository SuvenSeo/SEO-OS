const supabase = require('../config/supabase');

// ─── Simple in-memory cache ───────────────────────────────────────────────────
const _cache = {};

function getCache(key) {
  const entry = _cache[key];
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }
  return null;
}

function setCache(key, value, ttlMs) {
  _cache[key] = {
    value,
    expiresAt: Date.now() + ttlMs,
  };
}

const TTL_5MIN = 5 * 60 * 1000;
const TTL_10MIN = 10 * 60 * 1000;

/**
 * Build the full dynamic context for the AI brain.
 * Called before every Groq API call to inject current state.
 * @param {string} [userMessage] - Optional current message for knowledge_base FTS search
 * @returns {Promise<object>} Formatted context string AND fetched episodes (to avoid re-fetching)
 */
async function buildContext(userMessage = '') {
  const sections = [];

  // 0. Current Date/Time — goes first so the AI always knows when it is
  const now = new Date();
  const timeContext = `CURRENT DATE/TIME: ${now.toISOString()} (Sri Lanka: ${now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })})`;
  sections.push(timeContext);

  // Check cache for infrequently changing data
  const cachedCore = getCache('core_memory');
  const cachedPatterns = getCache('patterns');
  const cachedIdeas = getCache('ideas');

  // Prepare Knowledge Base keywords
  let ftsQuery = null;
  if (userMessage && userMessage.length > 3) {
    const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'been', 'they', 'what', 'just', 'your', 'about']);
    const keywords = userMessage
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))
      .slice(0, 8);

    if (keywords.length > 0) {
      ftsQuery = keywords.join(' | ');
    }
  }

  // ── Parallel Data Fetching ──────────────────────────────────────────────
  const promises = [
    // 1. Last 30 episodic memories
    supabase
      .from('episodic_memory')
      .select('role, content, created_at')
      .order('created_at', { ascending: false })
      .limit(30),

    // 2. All open tasks
    supabase
      .from('tasks')
      .select('id, title, description, deadline, priority, status, follow_up_count, tier')
      .in('status', ['open', 'snoozed'])
      .order('priority', { ascending: true }),

    // 3. Core memory (if not cached)
    cachedCore ? Promise.resolve({ data: cachedCore }) : supabase.from('core_memory').select('key, value').order('key'),

    // 4. Active working memory
    supabase
      .from('working_memory')
      .select('key, value, expires_at')
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`),

    // 5. Recent patterns (if not cached)
    cachedPatterns ? Promise.resolve({ data: cachedPatterns }) : supabase.from('patterns').select('observation, confidence, created_at').order('created_at', { ascending: false }).limit(10),

    // 6. Recent raw ideas (if not cached)
    cachedIdeas ? Promise.resolve({ data: cachedIdeas }) : supabase.from('ideas').select('content, created_at').eq('status', 'raw').order('created_at', { ascending: false }).limit(5),

    // 7. Knowledge Base (if keywords present)
    ftsQuery
      ? supabase.from('knowledge_base').select('content, source, created_at').textSearch('fts', ftsQuery, { type: 'plain', config: 'english' }).order('created_at', { ascending: false }).limit(5)
      : Promise.resolve({ data: [] }),
  ];

  const [
    episodesRes,
    tasksRes,
    coreRes,
    workingRes,
    patternsRes,
    ideasRes,
    knowledgeRes,
  ] = await Promise.all(promises);

  // Update caches
  if (!cachedCore && coreRes.data) setCache('core_memory', coreRes.data, TTL_5MIN);
  if (!cachedPatterns && patternsRes.data) setCache('patterns', patternsRes.data, TTL_5MIN);
  if (!cachedIdeas && ideasRes.data) setCache('ideas', ideasRes.data, TTL_5MIN);

  // ── Process Results ──────────────────────────────────────────────────────

  // 1. Episodic Memory
  const episodes = episodesRes.data || [];
  if (episodes.length > 0) {
    const history = [...episodes]
      .reverse()
      .map(e => `[${e.role}] ${e.content}`)
      .join('\n');
    sections.push(`RECENT CONVERSATION HISTORY:\n${history}`);
  }

  // 2. Tasks
  const tasks = tasksRes.data || [];
  if (tasks.length > 0) {
    const taskList = tasks.map(t => {
      let line = `  [T${t.tier}] P${t.priority}: ${t.title}`;
      if (t.deadline) line += ` [due: ${new Date(t.deadline).toLocaleDateString('en-US', { timeZone: 'Asia/Colombo' })}]`;
      if (t.status === 'snoozed') line += ' (snoozed)';
      if (t.follow_up_count > 0) line += ` [followed up ${t.follow_up_count}x]`;
      return line;
    }).join('\n');
    sections.push(`OPEN TASKS:\n${taskList}`);
  }

  // 3. Core Memory
  const coreMemory = coreRes.data || [];
  if (coreMemory.length > 0) {
    const memoryStr = coreMemory
      .map(m => `  ${m.key}: ${m.value}`)
      .join('\n');
    sections.push(`CORE MEMORY:\n${memoryStr}`);
  }

  // 4. Working Memory
  const workingMemory = workingRes.data || [];
  if (workingMemory.length > 0) {
    const wmStr = workingMemory
      .map(m => `  ${m.key}: ${m.value}`)
      .join('\n');
    sections.push(`WORKING MEMORY (short-term):\n${wmStr}`);
  }

  // 5. Patterns
  const patterns = patternsRes.data || [];
  if (patterns.length > 0) {
    const patternStr = patterns
      .map(p => `  [${p.confidence}] ${p.observation}`)
      .join('\n');
    sections.push(`OBSERVED PATTERNS:\n${patternStr}`);
  }

  // 6. Ideas
  const ideas = ideasRes.data || [];
  if (ideas.length > 0) {
    const ideaStr = ideas
      .map(i => `  - ${i.content}`)
      .join('\n');
    sections.push(`RECENT RAW IDEAS:\n${ideaStr}`);
  }

  // 7. Knowledge Base
  const knowledge = knowledgeRes.data || [];
  if (knowledge.length > 0) {
    const knowledgeStr = knowledge
      .map(k => `  [${k.source}] ${k.content.substring(0, 300)}${k.content.length > 300 ? '...' : ''}`)
      .join('\n\n');
    sections.push(`RELEVANT KNOWLEDGE (from WhatsApp import and saved notes):\n${knowledgeStr}`);
  }

  return {
    context: sections.join('\n\n---\n\n'),
    recentMessages: episodes,
  };
}

/**
 * Load the system prompt from agent_config.
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

  setCache('system_prompt', data.value, TTL_10MIN);
  return data.value;
}

/**
 * Get the full system prompt with injected context.
 * @param {string} [userMessage] - Current user message for knowledge_base search
 */
async function getFullPrompt(userMessage = '') {
  const [systemPrompt, { context, recentMessages }] = await Promise.all([
    loadSystemPrompt(),
    buildContext(userMessage),
  ]);

  return {
    fullPrompt: `${systemPrompt}\n\n===== CURRENT CONTEXT =====\n\n${context}`,
    recentMessages,
  };
}

module.exports = { buildContext, loadSystemPrompt, getFullPrompt };
