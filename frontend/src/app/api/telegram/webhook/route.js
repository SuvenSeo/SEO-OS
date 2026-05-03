import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { generateResponse } from '@/lib/services/groq';
import { sendMessage } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';
import { processExchange, formatSummary } from '@/lib/services/postProcessor';

export async function POST(req) {
  try {
    const update = await req.json();

    // Respond immediately to Telegram to prevent timeout
    // We don't await the handler so Vercel returns 200 OK fast
    handleUpdate(update).catch(err => console.error('[Telegram Handler Error]', err));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleUpdate(update) {
  if (!update.message || !update.message.text) return;

  const chatId = update.message.chat.id.toString();
  const messageText = update.message.text.trim();
  const messageId = update.message.message_id;

  // Verify it's from the authorized user
  if (chatId !== process.env.TELEGRAM_CHAT_ID) {
    console.warn(`[Telegram] Unauthorized chat ID: ${chatId}`);
    return;
  }

  // Check if it's a command
  if (messageText.startsWith('/')) {
    await handleCommand(chatId, messageText, messageId);
    return;
  }

  // Regular message flow
  await handleMessage(chatId, messageText, messageId);
}

async function handleMessage(chatId, text, messageId) {
  await supabase.from('episodic_memory').insert({
    role: 'user',
    content: text,
    telegram_message_id: messageId,
  });

  const istHour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false });
  const hour = parseInt(istHour, 10);
  if (hour >= 8 && hour < 11) {
    await supabase.from('working_memory').upsert(
      { key: 'morning_brief_replied', value: 'true' },
      { onConflict: 'key' }
    );
  }

  const systemPrompt = await getFullPrompt(text);
  const { data: recentMessages } = await supabase
    .from('episodic_memory')
    .select('role, content')
    .order('created_at', { ascending: false })
    .limit(10);

  const messages = (recentMessages || [])
    .reverse()
    .map(m => ({ role: m.role, content: m.content }));

  const aiResponse = await generateResponse(systemPrompt, messages);

  await supabase.from('episodic_memory').insert({
    role: 'assistant',
    content: aiResponse,
  });

  const summary = await processExchange(text, aiResponse);
  const summaryText = formatSummary(summary);

  await sendMessage(chatId, aiResponse + summaryText);
}

async function handleCommand(chatId, text, messageId) {
  const [command, ...args] = text.split(' ');
  const cmd = command.toLowerCase();

  switch (cmd) {
    case '/tasks': return await cmdTasks(chatId);
    case '/reminders': return await cmdReminders(chatId);
    case '/start':
      return await sendMessage(chatId, '🔴 *SEOS Online*\n\nChief of Staff mode active.');
    default:
      return await sendMessage(chatId, `Unknown command: ${cmd}`);
  }
}

async function cmdTasks(chatId) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, priority')
    .eq('status', 'open')
    .order('priority', { ascending: true });

  if (!tasks || tasks.length === 0) return await sendMessage(chatId, '✅ No open tasks.');

  let msg = '📋 *OPEN TASKS*\n\n';
  tasks.forEach(t => {
    msg += `→ \`${t.id.substring(0, 8)}\` ${t.title} (P${t.priority})\n`;
  });
  await sendMessage(chatId, msg);
}

async function cmdReminders(chatId) {
  const { data: reminders } = await supabase
    .from('reminders')
    .select('message, trigger_at')
    .eq('fired', false)
    .order('trigger_at', { ascending: true });

  if (!reminders || reminders.length === 0) return await sendMessage(chatId, '🔕 No reminders.');

  let msg = '⏰ *REMINDERS*\n\n';
  reminders.forEach(r => {
    msg += `→ ${r.message}\n  📅 ${new Date(r.trigger_at).toLocaleString()}\n\n`;
  });
  await sendMessage(chatId, msg);
}
