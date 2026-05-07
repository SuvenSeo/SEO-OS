const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { generateResponse } = require('../services/groq');
const { sendMessage } = require('../services/telegram');
const { getFullPrompt } = require('../services/context');
const { processExchange, formatSummary } = require('../services/postProcessor');

// ── Webhook Handler ────────────────────────────────────────
// POST /api/telegram/webhook
router.post('/webhook', async (req, res) => {
  // Respond immediately to Telegram (prevent timeout)
  res.status(200).json({ ok: true });

  const update = req.body;

  // Only handle text messages
  if (!update.message || !update.message.text) return;

  const chatId = update.message.chat.id.toString();
  const messageText = update.message.text.trim();
  const messageId = update.message.message_id;

  // Verify it's from the authorized user
  if (chatId !== process.env.TELEGRAM_CHAT_ID) {
    console.warn(`[Telegram] Unauthorized chat ID: ${chatId}`);
    return;
  }

  try {
    // Check if it's a command
    if (messageText.startsWith('/')) {
      await handleCommand(chatId, messageText, messageId);
      return;
    }

    // Regular message → AI conversation flow
    await handleMessage(chatId, messageText, messageId);
  } catch (error) {
    console.error('[Telegram] Handler error:', error.message);
    await sendMessage(chatId, '⚠️ Something went wrong. I\'m still here though — try again.');
  }
});

// ── Message Handler ────────────────────────────────────────
async function handleMessage(chatId, text, messageId) {
  // 1. Save user message to episodic memory
  await supabase.from('episodic_memory').insert({
    role: 'user',
    content: text,
    telegram_message_id: messageId,
  });

  // 2. Mark morning brief as replied (suppresses the 60-min nudge)
  const istHour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false });
  const hour = parseInt(istHour, 10);
  if (hour >= 8 && hour < 11) {
    await supabase.from('working_memory').upsert(
      { key: 'morning_brief_replied', value: 'true' },
      { onConflict: 'key' }
    );
  }

  // 3. Build full context + system prompt — pass user message for knowledge_base search
  const { fullPrompt, recentMessages } = await getFullPrompt(text);

  // 4. Use already fetched recent conversation for message array (limit to 10)
  const messages = (recentMessages || [])
    .slice(0, 10)
    .reverse()
    .map(m => ({ role: m.role, content: m.content }));

  // 5. Call Groq
  const aiResponse = await generateResponse(fullPrompt, messages);

  // 6. Save AI response to episodic memory
  await supabase.from('episodic_memory').insert({
    role: 'assistant',
    content: aiResponse,
  });

  // 7. Post-process: detect tasks, reminders, ideas, memory updates, snooze
  const summary = await processExchange(text, aiResponse);
  const summaryText = formatSummary(summary);

  // 8. Send response via Telegram
  await sendMessage(chatId, aiResponse + summaryText);
}

// ── Command Handler ────────────────────────────────────────
async function handleCommand(chatId, text, messageId) {
  const [command, ...args] = text.split(' ');
  const cmd = command.toLowerCase();

  switch (cmd) {
    case '/tasks':
      return await cmdTasks(chatId);
    case '/done':
      return await cmdDone(chatId, args.join(' '));
    case '/reminders':
      return await cmdReminders(chatId);
    case '/memory':
      return await cmdMemory(chatId);
    case '/ideas':
      return await cmdIdeas(chatId);
    case '/brief':
      return await cmdBrief(chatId);
    case '/review':
      return await cmdReview(chatId);
    case '/start':
      return await sendMessage(chatId, 
        '🔴 *SEOS Online*\n\nI\'m your chief of staff, Suven. Not an assistant — a manager.\n\nSend me anything and I\'ll handle it. Or use:\n\n/tasks — open tasks\n/done [id] — mark done\n/reminders — upcoming\n/memory — core memory\n/ideas — raw ideas\n/brief — morning brief\n/review — weekly review'
      );
    default:
      return await sendMessage(chatId, `Unknown command: ${cmd}`);
  }
}

// ── /tasks ─────────────────────────────────────────────────
async function cmdTasks(chatId) {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, priority, deadline, status, follow_up_count')
    .eq('status', 'open')
    .order('priority', { ascending: true });

  if (error || !tasks || tasks.length === 0) {
    return await sendMessage(chatId, '✅ No open tasks. Suspiciously clean slate.');
  }

  // Group by priority
  const grouped = {};
  for (const task of tasks) {
    const p = `P${task.priority}`;
    if (!grouped[p]) grouped[p] = [];
    grouped[p].push(task);
  }

  let msg = '📋 *OPEN TASKS*\n\n';
  for (const [priority, items] of Object.entries(grouped)) {
    msg += `*${priority}*\n`;
    for (const t of items) {
      const id = t.id.substring(0, 8);
      let line = `→ \`${id}\` ${t.title}`;
      if (t.deadline) {
        const dl = new Date(t.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        line += ` _(due ${dl})_`;
      }
      if (t.follow_up_count > 0) line += ` ⚠️x${t.follow_up_count}`;
      msg += line + '\n';
    }
    msg += '\n';
  }

  msg += '_Use /done [id] to mark complete_';
  await sendMessage(chatId, msg);
}

// ── /done ──────────────────────────────────────────────────
async function cmdDone(chatId, idFragment) {
  if (!idFragment) {
    return await sendMessage(chatId, 'Usage: /done [task-id]\nGet IDs from /tasks');
  }

  // Find task by ID prefix
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('status', 'open');

  const match = tasks?.find(t => t.id.startsWith(idFragment));

  if (!match) {
    return await sendMessage(chatId, `❌ No open task matching ID \`${idFragment}\``);
  }

  await supabase
    .from('tasks')
    .update({ status: 'done' })
    .eq('id', match.id);

  await sendMessage(chatId, `✅ Done: *${match.title}*`);
}

// ── /reminders ─────────────────────────────────────────────
async function cmdReminders(chatId) {
  const { data: reminders } = await supabase
    .from('reminders')
    .select('id, message, trigger_at, repeat_interval, fired')
    .eq('fired', false)
    .order('trigger_at', { ascending: true })
    .limit(15);

  if (!reminders || reminders.length === 0) {
    return await sendMessage(chatId, '🔕 No upcoming reminders.');
  }

  let msg = '⏰ *UPCOMING REMINDERS*\n\n';
  for (const r of reminders) {
    const time = new Date(r.trigger_at).toLocaleString('en-US', {
      timeZone: 'Asia/Colombo',
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    msg += `→ ${r.message}\n  📅 ${time}`;
    if (r.repeat_interval) msg += ` (${r.repeat_interval})`;
    msg += '\n\n';
  }

  await sendMessage(chatId, msg);
}

// ── /memory ────────────────────────────────────────────────
async function cmdMemory(chatId) {
  const { data: memory } = await supabase
    .from('core_memory')
    .select('key, value')
    .order('key');

  if (!memory || memory.length === 0) {
    return await sendMessage(chatId, '🧠 Core memory is empty. Start talking to build it.');
  }

  let msg = '🧠 *CORE MEMORY*\n\n';
  for (const m of memory) {
    msg += `*${m.key}:* ${m.value}\n`;
  }

  await sendMessage(chatId, msg);
}

// ── /ideas ─────────────────────────────────────────────────
async function cmdIdeas(chatId) {
  const { data: ideas } = await supabase
    .from('ideas')
    .select('id, content, status, created_at')
    .eq('status', 'raw')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!ideas || ideas.length === 0) {
    return await sendMessage(chatId, '💡 No raw ideas. Your idea pipeline is empty.');
  }

  let msg = '💡 *RAW IDEAS*\n\n';
  for (const idea of ideas) {
    const date = new Date(idea.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    msg += `→ ${idea.content} _(${date})_\n`;
  }

  await sendMessage(chatId, msg);
}

// ── /brief ─────────────────────────────────────────────────
async function cmdBrief(chatId) {
  // Trigger the morning brief endpoint internally
  try {
    const proactive = require('./proactive');
    await proactive.triggerMorningBrief();
    // Response is sent by the proactive engine
  } catch (error) {
    await sendMessage(chatId, '⚠️ Failed to generate brief. Check logs.');
  }
}

// ── /review ────────────────────────────────────────────────
async function cmdReview(chatId) {
  try {
    const proactive = require('./proactive');
    await proactive.triggerWeeklyReview();
  } catch (error) {
    await sendMessage(chatId, '⚠️ Failed to generate review. Check logs.');
  }
}

module.exports = router;
