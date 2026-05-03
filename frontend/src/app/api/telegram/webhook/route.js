import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { generateResponse } from '@/lib/services/groq';
import { sendMessage } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';
import { processExchange, formatSummary } from '@/lib/services/postProcessor';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// GET /api/telegram/webhook - Set the webhook URL
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'setWebhook') {
    try {
      const webhookUrl = `https://${request.headers.get('host')}/api/telegram/webhook`;

      const response = await fetch(`${TELEGRAM_API}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      });

      const data = await response.json();
      return NextResponse.json({
        success: data.ok,
        message: data.description || 'Webhook configured',
        webhookUrl,
      });
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to set webhook', details: error.message },
        { status: 500 }
      );
    }
  }

  if (action === 'getWebhook') {
    try {
      const response = await fetch(`${TELEGRAM_API}/getWebhookInfo`);
      const data = await response.json();
      return NextResponse.json(data);
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to get webhook info', details: error.message },
        { status: 500 }
      );
    }
  }

  if (action === 'test') {
    try {
      // Test bot token by calling getMe
      const response = await fetch(`${TELEGRAM_API}/getMe`);
      const data = await response.json();
      
      return NextResponse.json({
        botInfo: data,
        envVars: {
          chatId: process.env.TELEGRAM_CHAT_ID,
          hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
          tokenPrefix: process.env.TELEGRAM_BOT_TOKEN?.substring(0, 10) + '...',
        }
      });
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to test bot', details: error.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    usage: 'Use ?action=setWebhook to configure webhook, ?action=getWebhook to check status, ?action=test to verify bot',
  });
}

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
  console.log('[Telegram] Received update:', JSON.stringify(update));

  if (!update.message || !update.message.text) {
    console.log('[Telegram] No message text, ignoring');
    return;
  }

  const chatId = update.message.chat.id.toString();
  const messageText = update.message.text.trim();
  const messageId = update.message.message_id;

  console.log(`[Telegram] Message from chat ${chatId}: "${messageText.substring(0, 50)}..."`);
  console.log(`[Telegram] Expected CHAT_ID: ${process.env.TELEGRAM_CHAT_ID}`);

  // Verify it's from the authorized user
  if (chatId !== process.env.TELEGRAM_CHAT_ID) {
    console.warn(`[Telegram] Unauthorized chat ID: ${chatId} (expected: ${process.env.TELEGRAM_CHAT_ID})`);
    return;
  }

  // Check if it's a command
  if (messageText.startsWith('/')) {
    await handleCommand(chatId, messageText, messageId);
    return;
  }

  // Regular message flow
  try {
    await handleMessage(chatId, messageText, messageId);
  } catch (error) {
    console.error('[Telegram] handleMessage error:', error.message);
    console.error(error.stack);
    await sendMessage(chatId, `❌ Error: ${error.message}`);
  }
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
