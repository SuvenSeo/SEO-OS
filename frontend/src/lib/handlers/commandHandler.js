import supabase from '@/lib/config/supabase';
import { generateResponse } from '@/lib/services/groq';
import { sendMessage } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';
import { readUrl } from '@/lib/services/fileProcessor';
import { insertKnowledgeBase } from '@/lib/handlers/utils';

// ── /tasks ─────────────────────────────────────────────────
export async function cmdTasks(chatId) {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, priority, deadline, tier')
    .in('status', ['open', 'snoozed'])
    .order('priority', { ascending: true });

  if (error) console.error('[Command] /tasks query error:', error.message);

  if (!tasks || tasks.length === 0) {
    return await sendMessage(chatId, '✅ No open tasks.');
  }

  let msg = '📋 *OPEN TASKS*\n\n';
  tasks.forEach(t => {
    msg += `→ \`${t.id.substring(0, 8)}\` [T${t.tier || '?'}] P${t.priority}: ${t.title}`;
    if (t.deadline) msg += ` _(due ${new Date(t.deadline).toLocaleDateString()})_`;
    msg += '\n';
  });
  msg += '\nUse /done [id] to mark complete.';
  await sendMessage(chatId, msg);
}

// ── /reminders ─────────────────────────────────────────────
export async function cmdReminders(chatId) {
  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('id, message, trigger_at, tier')
    .eq('fired', false)
    .order('trigger_at', { ascending: true })
    .limit(10);

  if (error) console.error('[Command] /reminders query error:', error.message);

  if (!reminders || reminders.length === 0) {
    return await sendMessage(chatId, '🔕 No upcoming reminders.');
  }

  let msg = '⏰ *REMINDERS*\n\n';
  reminders.forEach(r => {
    msg += `→ ${r.message}\n  📅 ${new Date(r.trigger_at).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}\n\n`;
  });
  await sendMessage(chatId, msg);
}

// ── /ideas ─────────────────────────────────────────────────
export async function cmdIdeas(chatId) {
  const { data: ideas, error } = await supabase
    .from('ideas')
    .select('id, content, created_at')
    .eq('status', 'raw')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) console.error('[Command] /ideas query error:', error.message);

  if (!ideas || ideas.length === 0) {
    return await sendMessage(chatId, '💡 No raw ideas logged yet.');
  }

  let msg = '💡 *RAW IDEAS*\n\n';
  ideas.forEach(i => {
    msg += `→ ${i.content}\n`;
  });
  await sendMessage(chatId, msg);
}

// ── /memory ────────────────────────────────────────────────
export async function cmdMemory(chatId, query) {
  // If query provided, search across all memory types
  if (query && query.trim()) {
    return await cmdMemorySearch(chatId, query.trim());
  }

  const { data: memory, error } = await supabase
    .from('core_memory')
    .select('key, value')
    .order('key');

  if (error) console.error('[Command] /memory query error:', error.message);

  if (!memory || memory.length === 0) {
    return await sendMessage(chatId, '🧠 No core memory entries yet.');
  }

  let msg = '🧠 *CORE MEMORY*\n\n';
  memory.forEach(m => {
    msg += `*${m.key}*: ${m.value}\n\n`;
  });
  await sendMessage(chatId, msg);
}

// ── /memory [query] — search all memory types ──────────────
async function cmdMemorySearch(chatId, query) {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (keywords.length === 0) return await cmdMemory(chatId, '');

  const results = [];

  // Search core memory
  const { data: coreHits } = await supabase
    .from('core_memory')
    .select('key, value')
    .or(keywords.map(k => `value.ilike.%${k}%`).join(','));
  (coreHits || []).forEach(m => results.push(`🧠 *${m.key}*: ${m.value}`));

  // Search working memory
  const { data: workingHits } = await supabase
    .from('working_memory')
    .select('key, value')
    .or(keywords.map(k => `value.ilike.%${k}%`).join(','))
    .limit(5);
  (workingHits || []).forEach(m => results.push(`⚡ *${m.key}*: ${m.value}`));

  // Search knowledge base
  const { data: kbHits } = await supabase
    .from('knowledge_base')
    .select('content, source')
    .or(keywords.map(k => `content.ilike.%${k}%`).join(','))
    .order('created_at', { ascending: false })
    .limit(5);
  (kbHits || []).forEach(k => results.push(`📚 [${k.source}] ${k.content.substring(0, 200)}`));

  if (results.length === 0) {
    return await sendMessage(chatId, `🔍 No results for "${query}".`);
  }

  let msg = `🔍 *Memory Search: "${query}"*\n\n`;
  msg += results.slice(0, 10).join('\n\n');
  await sendMessage(chatId, msg);
}

// ── /brief ─────────────────────────────────────────────────
export async function cmdBrief(chatId) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, priority, deadline, tier')
    .in('status', ['open', 'snoozed'])
    .order('priority', { ascending: true })
    .limit(5);

  const { data: reminders } = await supabase
    .from('reminders')
    .select('message, trigger_at')
    .eq('fired', false)
    .order('trigger_at', { ascending: true })
    .limit(3);

  const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
  let msg = `🔴 *SEOS BRIEF*\n_${now}_\n\n`;

  if (tasks && tasks.length > 0) {
    msg += '*OPEN TASKS:*\n';
    tasks.forEach(t => {
      msg += `→ [T${t.tier || '?'}] P${t.priority}: ${t.title}`;
      if (t.deadline) msg += ` _(due ${new Date(t.deadline).toLocaleDateString()})_`;
      msg += '\n';
    });
    msg += '\n';
  } else {
    msg += '✅ No open tasks.\n\n';
  }

  if (reminders && reminders.length > 0) {
    msg += '*UPCOMING REMINDERS:*\n';
    reminders.forEach(r => {
      msg += `→ ${r.message} _(${new Date(r.trigger_at).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })})_\n`;
    });
    msg += '\n';
  }

  msg += "_What's the priority today?_";
  await sendMessage(chatId, msg);
}

// ── /done ──────────────────────────────────────────────────
export async function cmdDone(chatId, arg) {
  if (!arg) {
    return await sendMessage(chatId, '❌ Usage: /done [task-id] or /done all');
  }

  if (arg.toLowerCase() === 'all') {
    const { data: tasks } = await supabase
      .from('tasks')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .in('status', ['open', 'snoozed'])
      .select('id, title');
    const count = tasks?.length || 0;

    // Log task history
    for (const t of (tasks || [])) {
      await supabase.from('task_history').insert({
        task_id: t.id,
        action: 'done',
        new_value: { status: 'done' },
      }).then(({ error }) => { if (error) console.error('[TaskHistory] insert error:', error.message); });
    }

    return await sendMessage(chatId, `✅ Marked ${count} task(s) as done.`);
  }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title')
    .in('status', ['open', 'snoozed']);

  const match = tasks?.find(t => t.id.startsWith(arg.toLowerCase()));
  if (!match) {
    return await sendMessage(chatId, `❌ Task not found: \`${arg}\`\nGet IDs from /tasks`);
  }

  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', match.id);
  if (error) console.error('[Command] /done update error:', error.message);

  // Log task history
  await supabase.from('task_history').insert({
    task_id: match.id,
    action: 'done',
    new_value: { status: 'done' },
  }).then(({ error: e }) => { if (e) console.error('[TaskHistory] insert error:', e.message); });

  await sendMessage(chatId, `✅ Done: *${match.title}*`);
}

// ── /clear ─────────────────────────────────────────────────
export async function cmdClear(chatId, arg) {
  if (arg === 'tasks') {
    const { count } = await supabase
      .from('tasks')
      .delete({ count: 'exact' })
      .in('status', ['open', 'snoozed']);
    return await sendMessage(chatId, `🗑️ Cleared ${count ?? 'all'} open tasks.`);
  }

  if (arg === 'reminders') {
    const { count } = await supabase
      .from('reminders')
      .delete({ count: 'exact' })
      .eq('fired', false);
    return await sendMessage(chatId, `🧹 Cleared ${count ?? 'all'} upcoming reminders.`);
  }

  if (arg === 'all') {
    const [tasksRes, remindersRes] = await Promise.all([
      supabase.from('tasks').delete({ count: 'exact' }).in('status', ['open', 'snoozed']),
      supabase.from('reminders').delete({ count: 'exact' }).eq('fired', false),
      supabase.from('working_memory').delete().in('key', ['morning_brief_nudge_at', 'morning_brief_replied']),
    ]);
    const taskCount = tasksRes.count ?? 0;
    const reminderCount = remindersRes.count ?? 0;
    return await sendMessage(chatId, `🧼 Reset done. Cleared ${taskCount} task(s) and ${reminderCount} reminder(s).`);
  }

  await sendMessage(chatId, 'Usage: /clear tasks | /clear reminders | /clear all');
}

// ── /save ──────────────────────────────────────────────────
export async function cmdSave(chatId, label, value) {
  if (!label || !value) {
    return await sendMessage(chatId, '💾 Usage: `/save [label] [value]`\nExample: `/save password facebook MyPass123`\nExample: `/save key groq gsk_xxxxx`');
  }
  const { error: kbErr } = await insertKnowledgeBase(
    {
      source: 'secure_note',
      content: `[SECURE NOTE - ${label.toUpperCase()}]: ${value}`,
      embedding_summary: `Secure note: ${label}`,
    },
    'cmdSave'
  );
  if (kbErr) {
    return await sendMessage(chatId, `⚠️ Could not save that note. Try again in a moment.`);
  }
  await sendMessage(chatId, `🔐 Saved *${label}*. I'll remember it — just ask me for it anytime.`);
}

// ── /read ──────────────────────────────────────────────────
export async function cmdReadUrl(chatId, url) {
  if (!url) {
    return await sendMessage(chatId, '🔗 Usage: `/read [url]`');
  }
  try {
    await sendMessage(chatId, `🔗 Reading...`);
    const content = await readUrl(url);
    await insertKnowledgeBase(
      {
        source: 'user_link',
        content: `[URL: ${url}]\n${content}`,
        embedding_summary: content.substring(0, 200),
      },
      'cmdReadUrl'
    );
    const systemPrompt = await getFullPrompt(url);
    const summary = await generateResponse(systemPrompt, [
      { role: 'user', content: `Summarize this content from ${url}:\n\n${content}` }
    ]);
    const summaryText = typeof summary === 'string' ? summary : summary?.content || '';
    await sendMessage(chatId, `🔗 *Read & saved*: ${url}\n\n${summaryText}`);
  } catch (err) {
    await sendMessage(chatId, `❌ Couldn't read that URL: ${err.message}`);
  }
}

// ── /research ──────────────────────────────────────────────
export async function cmdResearch(chatId, topic) {
  if (!topic) {
    return await sendMessage(chatId, '🔬 Usage: `/research [topic]`');
  }
  try {
    await sendMessage(chatId, `🔬 Researching *${topic}*...`);
    const [wikiContent, ddgContent] = await Promise.allSettled([
      readUrl(`https://en.wikipedia.org/wiki/${encodeURIComponent(topic.replace(/ /g, '_'))}`),
      readUrl(`https://duckduckgo.com/?q=${encodeURIComponent(topic)}&ia=answer`),
    ]);

    const sources = [
      wikiContent.status === 'fulfilled' ? `WIKIPEDIA:\n${wikiContent.value}` : '',
      ddgContent.status === 'fulfilled' ? `WEB:\n${ddgContent.value}` : '',
    ].filter(Boolean).join('\n\n');

    if (!sources) {
      return await sendMessage(chatId, `❌ Couldn't find research sources for "${topic}"`);
    }

    await insertKnowledgeBase(
      {
        source: 'research',
        content: `[Research: ${topic}]\n${sources.substring(0, 5000)}`,
        embedding_summary: `Research on ${topic}`,
      },
      'cmdResearch'
    );

    const systemPrompt = await getFullPrompt(topic);
    const report = await generateResponse(systemPrompt, [
      { role: 'user', content: `Based on this research about "${topic}", give me a concise, insightful summary with the most important points and what I should know:\n\n${sources.substring(0, 3000)}` }
    ]);
    const reportText = typeof report === 'string' ? report : report?.content || '';
    await sendMessage(chatId, `🔬 *Research: ${topic}*\n\n${reportText}\n\n_Saved to your knowledge base._`);
  } catch (err) {
    await sendMessage(chatId, `❌ Research failed: ${err.message}`);
  }
}

// ── /journal ───────────────────────────────────────────────
export async function cmdJournal(chatId, text) {
  if (!text) {
    return await sendMessage(chatId, '📓 Usage: `/journal [text]`\nWrite anything — I\'ll save it and extract any tasks or ideas.');
  }
  const { error } = await supabase.from('journal_entries').insert({
    type: 'free',
    content: text,
  });
  if (error) {
    console.error('[Command] /journal insert error:', error.message);
    return await sendMessage(chatId, '⚠️ Could not save journal entry. Try again.');
  }
  await sendMessage(chatId, '📓 *Journal saved.* I\'ll remember this.');
}

// ── /mood ──────────────────────────────────────────────────
export async function cmdMood(chatId, input) {
  if (!input) {
    return await sendMessage(chatId, '🎭 Usage: `/mood [1-5 or word]`\nExamples: `/mood 4`, `/mood stressed`, `/mood 😊`');
  }

  const moodMap = { '😊': 'positive', '😐': 'neutral', '😤': 'frustrated', '😰': 'anxious', '🔥': 'excited', '😔': 'sad' };
  let mood = input.trim().toLowerCase();
  let score = null;

  if (/^[1-5]$/.test(mood)) {
    score = parseInt(mood, 10);
    mood = score >= 4 ? 'positive' : score === 3 ? 'neutral' : 'stressed';
  } else if (moodMap[input.trim()]) {
    mood = moodMap[input.trim()];
  }

  const { error } = await supabase.from('mood_log').insert({
    mood,
    intensity: 'medium',
    confidence: 'high',
    source: 'manual',
    observation: `Manual mood log: ${input}`,
  });
  if (error) {
    console.error('[Command] /mood insert error:', error.message);
    return await sendMessage(chatId, '⚠️ Could not log mood.');
  }
  await sendMessage(chatId, `🎭 Mood logged: *${mood}*${score ? ` (${score}/5)` : ''}`);
}

// ── /focus ─────────────────────────────────────────────────
export async function cmdFocus(chatId, durationStr) {
  const minutes = parseInt(durationStr, 10) || 60;
  const endsAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

  await supabase.from('working_memory').upsert(
    { key: 'focus_mode', value: endsAt, expires_at: endsAt },
    { onConflict: 'key' }
  );

  await sendMessage(chatId, `🎯 *Focus mode ON* for ${minutes} minutes.\nOnly Tier 1 alerts will come through. I'll let you know when it ends.`);
}

// ── /study ─────────────────────────────────────────────────
export async function cmdStudy(chatId, args) {
  const parts = (args || '').split(/\s+/);
  const moduleName = parts[0] || 'general';
  const duration = parseInt(parts[1], 10) || 30;

  const { error } = await supabase.from('study_sessions').insert({
    module_name: moduleName,
    duration_minutes: duration,
  });
  if (error) {
    console.error('[Command] /study insert error:', error.message);
    return await sendMessage(chatId, '⚠️ Could not log study session.');
  }
  await sendMessage(chatId, `📖 Logged *${duration} min* study session for *${moduleName}*.`);
}

// ── /training ──────────────────────────────────────────────
export async function cmdTraining(chatId, args) {
  const parts = (args || '').split(/\s+/);
  const type = parts[0] || 'general';
  const duration = parseInt(parts[1], 10) || 60;

  const { error } = await supabase.from('training_sessions').insert({
    type,
    duration_minutes: duration,
  });
  if (error) {
    console.error('[Command] /training insert error:', error.message);
    return await sendMessage(chatId, '⚠️ Could not log training session.');
  }
  await sendMessage(chatId, `🏃 Logged *${duration} min* ${type} training.`);
}

// ── /expense ───────────────────────────────────────────────
export async function cmdExpense(chatId, args) {
  if (!args) {
    return await sendMessage(chatId, '💰 Usage: `/expense [amount] [category] [description]`\nExample: `/expense 2500 food lunch at Colombo`');
  }
  const parts = args.split(/\s+/);
  const amount = parseFloat(parts[0]);
  if (isNaN(amount)) return await sendMessage(chatId, '❌ First argument must be a number.');

  const validCategories = ['food', 'transport', 'study', 'business', 'personal', 'health', 'entertainment', 'other'];
  const category = validCategories.includes(parts[1]?.toLowerCase()) ? parts[1].toLowerCase() : 'other';
  const descStart = validCategories.includes(parts[1]?.toLowerCase()) ? 2 : 1;
  const description = parts.slice(descStart).join(' ') || null;

  const { error } = await supabase.from('expenses').insert({ amount, category, description });
  if (error) {
    console.error('[Command] /expense insert error:', error.message);
    return await sendMessage(chatId, '⚠️ Could not log expense.');
  }
  await sendMessage(chatId, `💰 Logged: *Rs. ${amount}* (${category})${description ? ` — ${description}` : ''}`);
}

// ── /goals ─────────────────────────────────────────────────
export async function cmdGoals(chatId) {
  const { data: goals, error } = await supabase
    .from('goals')
    .select('id, title, status, progress, target_date')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) console.error('[Command] /goals query error:', error.message);

  if (!goals || goals.length === 0) {
    return await sendMessage(chatId, '🎯 No active goals.');
  }

  let msg = '🎯 *ACTIVE GOALS*\n\n';
  goals.forEach(g => {
    const bar = '█'.repeat(Math.round(g.progress / 10)) + '░'.repeat(10 - Math.round(g.progress / 10));
    msg += `→ *${g.title}* [${bar}] ${g.progress}%`;
    if (g.target_date) msg += ` _(by ${new Date(g.target_date).toLocaleDateString()})_`;
    msg += '\n';
  });
  await sendMessage(chatId, msg);
}

// ── /habits ────────────────────────────────────────────────
export async function cmdHabits(chatId) {
  const { data: habits, error } = await supabase
    .from('habits')
    .select('id, name, current_streak, last_logged_at, cadence')
    .eq('status', 'active')
    .order('name');

  if (error) console.error('[Command] /habits query error:', error.message);

  if (!habits || habits.length === 0) {
    return await sendMessage(chatId, '🔥 No active habits. Set one up on the dashboard.');
  }

  let msg = '🔥 *ACTIVE HABITS*\n\n';
  habits.forEach(h => {
    msg += `→ *${h.name}* — streak: ${h.current_streak} days (${h.cadence})\n`;
  });
  await sendMessage(chatId, msg);
}

// ── /compare ───────────────────────────────────────────────
export async function cmdCompare(chatId, args) {
  if (!args || !args.includes('vs')) {
    return await sendMessage(chatId, '⚖️ Usage: `/compare [option A] vs [option B]`');
  }
  const [a, b] = args.split(/\s+vs\s+/i);
  if (!a?.trim() || !b?.trim()) {
    return await sendMessage(chatId, '⚖️ Usage: `/compare [option A] vs [option B]`');
  }

  await sendMessage(chatId, `⚖️ Analyzing *${a.trim()}* vs *${b.trim()}*...`);
  const systemPrompt = await getFullPrompt(`${a} vs ${b}`);
  const analysis = await generateResponse(systemPrompt, [
    { role: 'user', content: `I need to decide between "${a.trim()}" and "${b.trim()}". Build a structured comparison using everything you know about me, my priorities, and current situation. Include pros/cons for each and a recommendation.` }
  ]);
  const text = typeof analysis === 'string' ? analysis : analysis?.content || '';
  await sendMessage(chatId, text);
}

// ── Main command dispatcher ────────────────────────────────
export async function handleCommand(chatId, text, messageId) {
  const [command] = text.split(' ');
  const cmd = command.toLowerCase();
  const rawArgs = text.split(' ').slice(1).join(' ');

  switch (cmd) {
    case '/start':
      await sendMessage(chatId, '🔴 *SEOS Online*\n\nHey Suven 👋 I\'m here. We can chat naturally, set reminders, track tasks, research links, and keep your memory updated.\n\nNew commands: /journal, /mood, /focus, /study, /training, /expense, /goals, /habits, /compare');
      break;
    case '/tasks':
      await cmdTasks(chatId);
      break;
    case '/reminders':
      await cmdReminders(chatId);
      break;
    case '/ideas':
      await cmdIdeas(chatId);
      break;
    case '/memory':
      await cmdMemory(chatId, rawArgs);
      break;
    case '/brief':
      await cmdBrief(chatId);
      break;
    case '/review':
      await cmdBrief(chatId);
      break;
    case '/done':
      await cmdDone(chatId, text.split(' ')[1]);
      break;
    case '/clear':
      await cmdClear(chatId, text.split(' ')[1]);
      break;
    case '/save': {
      const parts = text.split(' ');
      await cmdSave(chatId, parts[1], parts.slice(2).join(' '));
      break;
    }
    case '/read':
      await cmdReadUrl(chatId, text.split(' ')[1]);
      break;
    case '/research':
      await cmdResearch(chatId, rawArgs);
      break;
    case '/journal':
      await cmdJournal(chatId, rawArgs);
      break;
    case '/mood':
      await cmdMood(chatId, rawArgs);
      break;
    case '/focus':
      await cmdFocus(chatId, text.split(' ')[1]);
      break;
    case '/study':
      await cmdStudy(chatId, rawArgs);
      break;
    case '/training':
      await cmdTraining(chatId, rawArgs);
      break;
    case '/expense':
      await cmdExpense(chatId, rawArgs);
      break;
    case '/goals':
      await cmdGoals(chatId);
      break;
    case '/habits':
      await cmdHabits(chatId);
      break;
    case '/compare':
      await cmdCompare(chatId, rawArgs);
      break;
    case '/formal':
      await supabase.from('working_memory').upsert(
        { key: 'persona_mode', value: 'formal' },
        { onConflict: 'key' }
      );
      await sendMessage(chatId, '🎩 Switched to *formal* mode.');
      break;
    case '/casual':
      await supabase.from('working_memory').upsert(
        { key: 'persona_mode', value: 'casual' },
        { onConflict: 'key' }
      );
      await sendMessage(chatId, '😎 Switched to *casual* mode.');
      break;
    case '/brainstorm':
      await supabase.from('working_memory').upsert(
        { key: 'persona_mode', value: 'brainstorm' },
        { onConflict: 'key' }
      );
      await sendMessage(chatId, '💡 Switched to *brainstorm* mode. Let\'s explore ideas.');
      break;
    case '/challenge':
      if (!rawArgs) return await sendMessage(chatId, '😈 Usage: `/challenge [decision or plan]`');
      await sendMessage(chatId, '😈 Playing devil\'s advocate...');
      const sysPrompt = await getFullPrompt(rawArgs);
      const challenge = await generateResponse(sysPrompt, [
        { role: 'user', content: `I've decided: "${rawArgs}". Now argue the other side aggressively. Point out risks, blind spots, and reasons this could fail. Be brutally honest — this is a stress test, not agreement.` }
      ]);
      const challengeText = typeof challenge === 'string' ? challenge : challenge?.content || '';
      await sendMessage(chatId, challengeText);
      break;
    case '/help':
      await sendMessage(chatId,
        '📋 *Commands*\n' +
        '/tasks — open tasks\n' +
        '/reminders — upcoming reminders\n' +
        '/ideas — raw ideas\n' +
        '/memory [query] — core memory / search\n' +
        '/brief — morning brief\n' +
        '/review — quick daily review\n' +
        '/done [id] — mark task done\n' +
        '/done all — mark ALL tasks done\n' +
        '/clear tasks|reminders|all\n' +
        '/save [label] [value] — secure note\n' +
        '/read [url] — read and save a link\n' +
        '/research [topic] — deep dive\n' +
        '/journal [text] — free journal entry\n' +
        '/mood [1-5 or word] — log mood\n' +
        '/focus [minutes] — focus mode\n' +
        '/study [module] [minutes]\n' +
        '/training [type] [minutes]\n' +
        '/expense [amount] [category] [desc]\n' +
        '/goals — active goals\n' +
        '/habits — active habits\n' +
        '/compare [A] vs [B]\n' +
        '/formal | /casual | /brainstorm\n' +
        '/challenge [decision] — devil\'s advocate\n' +
        '/help — this list'
      );
      break;
    default:
      await sendMessage(chatId, `Unknown command: \`${cmd}\`\nType /help for available commands.`);
  }
}
