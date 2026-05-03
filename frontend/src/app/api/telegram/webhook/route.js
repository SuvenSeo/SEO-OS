import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { generateResponse } from '@/lib/services/groq';
import { sendMessage } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';
import { processExchange, formatSummary } from '@/lib/services/postProcessor';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'setWebhook') {
    const webhookUrl = `https://${request.headers.get('host')}/api/telegram/webhook`;
    const res = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await res.json();
    return NextResponse.json({ success: data.ok, webhookUrl, result: data });
  }

  if (action === 'getWebhook') {
    const res = await fetch(`${TELEGRAM_API}/getWebhookInfo`);
    const data = await res.json();
    return NextResponse.json(data);
  }

  if (action === 'sendTest') {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: '🔴 SEOS test message' }),
    });
    const data = await res.json();
    return NextResponse.json({ success: data.ok, result: data });
  }

  return NextResponse.json({
    status: 'ok',
    chatIdSet: !!TELEGRAM_CHAT_ID,
    tokenSet: !!process.env.TELEGRAM_BOT_TOKEN,
  });
}

export async function POST(req) {
  try {
    const update = await req.json();
    // IMPORTANT: Must await - Vercel terminates function after response is sent
    await handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Telegram] POST error:', error.message);
    return NextResponse.json({ ok: true });
  }
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id.toString();
  const text = msg.text.trim();
  const messageId = msg.message_id;

  if (chatId !== TELEGRAM_CHAT_ID) {
    console.log(`[Telegram] Unauthorized chat: ${chatId}`);
    return;
  }

  console.log(`[Telegram] Processing: "${text.substring(0, 60)}"`);

  if (text.startsWith('/')) {
    await handleCommand(chatId, text, messageId);
    return;
  }

  await handleMessage(chatId, text, messageId);
}

async function handleMessage(chatId, text, messageId) {
  // Run DB writes + context fetch in parallel
  const [, , systemPrompt, recentResult] = await Promise.all([
    // Save user message
    supabase.from('episodic_memory').insert({
      role: 'user',
      content: text,
      telegram_message_id: messageId,
    }),
    // Track morning brief reply
    (async () => {
      const istHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false }), 10);
      if (istHour >= 8 && istHour < 11) {
        await supabase.from('working_memory').upsert(
          { key: 'morning_brief_replied', value: 'true' },
          { onConflict: 'key' }
        );
      }
    })(),
    // Build full context + system prompt
    getFullPrompt(text),
    // Fetch recent conversation history
    supabase.from('episodic_memory').select('role, content').order('created_at', { ascending: false }).limit(20),
  ]);

  const messages = (recentResult.data || [])
    .reverse()
    .map(m => ({ role: m.role, content: m.content }));

  // Generate AI response
  const aiResponse = await generateResponse(systemPrompt, messages);

  // Send reply FIRST — user sees it immediately
  await sendMessage(chatId, aiResponse);
  console.log('[Telegram] AI response sent');

  // Save AI response + post-process in background (user already has reply)
  await Promise.all([
    supabase.from('episodic_memory').insert({ role: 'assistant', content: aiResponse }),
    processExchange(text, aiResponse).then(summary => {
      const summaryText = formatSummary(summary);
      if (summaryText.trim()) {
        return sendMessage(chatId, summaryText);
      }
    }).catch(err => console.error('[Telegram] Post-processor error:', err.message)),
  ]);
}

async function handleCommand(chatId, text, messageId) {
  const [command] = text.split(' ');
  const cmd = command.toLowerCase();

  switch (cmd) {
    case '/start':
      await sendMessage(chatId, '🔴 *SEOS Online*\n\nChief of Staff mode active. How can I help?');
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
      await cmdMemory(chatId);
      break;
    case '/brief':
      await cmdBrief(chatId);
      break;
    case '/done': {
      const taskId = text.split(' ')[1];
      await cmdDone(chatId, taskId);
      break;
    }
    case '/help':
      await sendMessage(chatId, '📋 *Commands*\n/tasks — open tasks\n/reminders — upcoming reminders\n/ideas — raw ideas\n/memory — core memory\n/brief — morning brief\n/done [id] — mark task done\n/help — this list');
      break;
    default:
      await sendMessage(chatId, `Unknown command: \`${cmd}\`\nType /help for available commands.`);
  }
}

async function cmdTasks(chatId) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, priority, deadline, tier')
    .in('status', ['open', 'snoozed'])
    .order('priority', { ascending: true });

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

async function cmdReminders(chatId) {
  const { data: reminders } = await supabase
    .from('reminders')
    .select('id, message, trigger_at, tier')
    .eq('fired', false)
    .order('trigger_at', { ascending: true })
    .limit(10);

  if (!reminders || reminders.length === 0) {
    return await sendMessage(chatId, '🔕 No upcoming reminders.');
  }

  let msg = '⏰ *REMINDERS*\n\n';
  reminders.forEach(r => {
    msg += `→ ${r.message}\n  📅 ${new Date(r.trigger_at).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}\n\n`;
  });
  await sendMessage(chatId, msg);
}

async function cmdIdeas(chatId) {
  const { data: ideas } = await supabase
    .from('ideas')
    .select('id, content, created_at')
    .eq('status', 'raw')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!ideas || ideas.length === 0) {
    return await sendMessage(chatId, '💡 No raw ideas logged yet.');
  }

  let msg = '💡 *RAW IDEAS*\n\n';
  ideas.forEach(i => {
    msg += `→ ${i.content}\n`;
  });
  await sendMessage(chatId, msg);
}

async function cmdMemory(chatId) {
  const { data: memory } = await supabase
    .from('core_memory')
    .select('key, value')
    .order('key');

  if (!memory || memory.length === 0) {
    return await sendMessage(chatId, '🧠 No core memory entries yet.');
  }

  let msg = '🧠 *CORE MEMORY*\n\n';
  memory.forEach(m => {
    msg += `*${m.key}*: ${m.value}\n\n`;
  });
  await sendMessage(chatId, msg);
}

async function cmdBrief(chatId) {
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

async function cmdDone(chatId, taskId) {
  if (!taskId) {
    return await sendMessage(chatId, '❌ Usage: /done [task-id]\nGet task IDs from /tasks');
  }

  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .ilike('id', `${taskId}%`)
    .select('title')
    .single();

  if (error || !data) {
    return await sendMessage(chatId, `❌ Task not found: \`${taskId}\``);
  }

  await sendMessage(chatId, `✅ Done: *${data.title}*`);
}
