import supabase from '../config/supabase.js';

/**
 * Build the full dynamic context for the AI brain.
 * Called before every Groq API call to inject current state.
 * @param {string} [userMessage] - Optional current message for knowledge_base FTS search
 * @returns {Promise<string>} Formatted context string
 */
async function buildContext(userMessage = '') {
  const sections = [];
  const now = new Date();

  // 0. Current Date/Time
  sections.push(`CURRENT DATE/TIME: ${now.toISOString()} (Sri Lanka: ${now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' })})`);

  // Run all DB queries in parallel
  const [
    { data: episodes },
    { data: tasks },
    { data: coreMemory },
    { data: workingMemory },
    { data: patterns },
    { data: ideas },
  ] = await Promise.all([
    supabase.from('episodic_memory').select('role, content, created_at').order('created_at', { ascending: false }).limit(30),
    supabase.from('tasks').select('id, title, description, deadline, priority, status, follow_up_count, tier').in('status', ['open', 'snoozed']).order('priority', { ascending: true }),
    supabase.from('core_memory').select('key, value').order('key'),
    supabase.from('working_memory').select('key, value, expires_at').or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`),
    supabase.from('patterns').select('observation, confidence, created_at').order('created_at', { ascending: false }).limit(10),
    supabase.from('ideas').select('content, created_at').eq('status', 'raw').order('created_at', { ascending: false }).limit(5),
  ]);

  if (episodes && episodes.length > 0) {
    const history = episodes.reverse().map(e => `[${e.role}] ${e.content}`).join('\n');
    sections.push(`RECENT CONVERSATION HISTORY:\n${history}`);
  }

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

  if (coreMemory && coreMemory.length > 0) {
    sections.push(`CORE MEMORY:\n${coreMemory.map(m => `  ${m.key}: ${m.value}`).join('\n')}`);
  }

  if (workingMemory && workingMemory.length > 0) {
    sections.push(`WORKING MEMORY (short-term):\n${workingMemory.map(m => `  ${m.key}: ${m.value}`).join('\n')}`);
  }

  if (patterns && patterns.length > 0) {
    sections.push(`OBSERVED PATTERNS:\n${patterns.map(p => `  [${p.confidence}] ${p.observation}`).join('\n')}`);
  }

  if (ideas && ideas.length > 0) {
    sections.push(`RECENT RAW IDEAS:\n${ideas.map(i => `  - ${i.content}`).join('\n')}`);
  }

  // RELEVANT KNOWLEDGE — Full-text search on knowledge_base using user's message
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
