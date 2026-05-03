import supabase from '../config/supabase.js';

/**
 * Build the full dynamic context for the AI brain.
 * Called before every Groq API call to inject current state.
 * @param {string} [userMessage] - Optional current message for knowledge_base FTS search
 * @returns {Promise<string>} Formatted context string
 */
async function buildContext(userMessage = '') {
  const sections = [];

  // 0. Current Date/Time — goes first so the AI always knows when it is
  const now = new Date();
  const timeContext = `CURRENT DATE/TIME: ${now.toISOString()} (Sri Lanka: ${now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })})`;
  sections.push(timeContext);

  // 1. Last 30 episodic memories (recent conversation history)
  const { data: episodes } = await supabase
    .from('episodic_memory')
    .select('role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(30);

  if (episodes && episodes.length > 0) {
    const history = episodes
      .reverse()
      .map(e => `[${e.role}] ${e.content}`)
      .join('\n');
    sections.push(`RECENT CONVERSATION HISTORY:\n${history}`);
  }

  // 2. All open tasks (sorted by priority, then tier)
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, description, deadline, priority, status, follow_up_count, tier')
    .in('status', ['open', 'snoozed'])
    .order('priority', { ascending: true });

  if (tasks && tasks.length > 0) {
    const taskList = tasks.map(t => {
      let line = `  [T${t.tier}] P${t.priority}: ${t.title}`;
      if (t.deadline) line += ` [due: ${new Date(t.deadline).toLocaleDateString('en-US', { timeZone: 'Asia/Colombo' })}]`;
      if (t.status === 'snoozed') line += ' (snoozed)';
      if (t.follow_up_count > 0) line += ` [followed up ${t.follow_up_count}x]`;
      return line;
    }).join('\n');
    sections.push(`OPEN TASKS:\n${taskList}`);
  }

  // 3. All core memory
  const { data: coreMemory } = await supabase
    .from('core_memory')
    .select('key, value')
    .order('key');

  if (coreMemory && coreMemory.length > 0) {
    const memoryStr = coreMemory
      .map(m => `  ${m.key}: ${m.value}`)
      .join('\n');
    sections.push(`CORE MEMORY:\n${memoryStr}`);
  }

  // 4. Active working memory (non-expired)
  const { data: workingMemory } = await supabase
    .from('working_memory')
    .select('key, value, expires_at')
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);

  if (workingMemory && workingMemory.length > 0) {
    const wmStr = workingMemory
      .map(m => `  ${m.key}: ${m.value}`)
      .join('\n');
    sections.push(`WORKING MEMORY (short-term):\n${wmStr}`);
  }

  // 5. Recent patterns (last 10)
  const { data: patterns } = await supabase
    .from('patterns')
    .select('observation, confidence, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (patterns && patterns.length > 0) {
    const patternStr = patterns
      .map(p => `  [${p.confidence}] ${p.observation}`)
      .join('\n');
    sections.push(`OBSERVED PATTERNS:\n${patternStr}`);
  }

  // 6. Recent raw ideas (last 5)
  const { data: ideas } = await supabase
    .from('ideas')
    .select('content, created_at')
    .eq('status', 'raw')
    .order('created_at', { ascending: false })
    .limit(5);

  if (ideas && ideas.length > 0) {
    const ideaStr = ideas
      .map(i => `  - ${i.content}`)
      .join('\n');
    sections.push(`RECENT RAW IDEAS:\n${ideaStr}`);
  }

  // 7. RELEVANT KNOWLEDGE — Full-text search on knowledge_base using user's message
  if (userMessage && userMessage.length > 3) {
    const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'been', 'they', 'what', 'just', 'your', 'about']);
    const keywords = userMessage
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))
      .slice(0, 8);

    if (keywords.length > 0) {
      const ftsQuery = keywords.join(' | ');
      const { data: knowledge } = await supabase
        .from('knowledge_base')
        .select('content, source, created_at')
        .textSearch('fts', ftsQuery, { type: 'plain', config: 'english' })
        .order('created_at', { ascending: false })
        .limit(5);

      if (knowledge && knowledge.length > 0) {
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
 * Load the system prompt from agent_config.
 * @returns {Promise<string>}
 */
async function loadSystemPrompt() {
  const { data, error } = await supabase
    .from('agent_config')
    .select('value')
    .eq('key', 'system_prompt')
    .single();

  if (error || !data) {
    console.error('[Context] Failed to load system prompt:', error?.message);
    return 'You are SEOS, a personal AI assistant.';
  }

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

  return `${systemPrompt}\n\n===== CURRENT CONTEXT =====\n\n${context}`;
}
