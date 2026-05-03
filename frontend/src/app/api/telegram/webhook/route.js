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

  if (action === 'sendTest') {
    try {
      const testChatId = process.env.TELEGRAM_CHAT_ID;
      const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: testChatId,
          text: '🔴 Test message from SEOS webhook',
        }),
      });
      const data = await response.json();
      return NextResponse.json({
        success: data.ok,
        result: data,
        sentTo: testChatId,
      });
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to send test message', details: error.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    usage: 'Use ?action=setWebhook|getWebhook|test|sendTest',
  });
}

export async function POST(req) {
  try {
    const update = await req.json();

    // Respond immediately to Telegram to prevent timeout
    // We don't await the handler so Vercel returns 200 OK fast
    handleUpdate(update).catch(async (err) => {
      console.error('[Telegram Handler Error]', err);
      try {
        const chatId = update?.message?.chat?.id;
        if (chatId) {
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `❌ Error: ${err.message}`,
            }),
          });
        }
      } catch (sendErr) {
        console.error('[Telegram] Failed to send error message:', sendErr);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Webhook Error]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleUpdate(update) {
  console.log('[Telegram] ========== handleUpdate START ==========');
  console.log('[Telegram] Received update:', JSON.stringify(update));

  if (!update.message) {
    console.log('[Telegram] No message object, ignoring');
    return;
  }
  if (!update.message.text) {
    console.log('[Telegram] No message text, ignoring. Message type:', Object.keys(update.message));
    return;
  }

  const chatId = update.message.chat.id.toString();
  const messageText = update.message.text.trim();
  const messageId = update.message.message_id;

  console.log(`[Telegram] Parsed - chatId: ${chatId}, messageId: ${messageId}`);
  console.log(`[Telegram] Message text: "${messageText.substring(0, 100)}..."`);
  console.log(`[Telegram] Expected CHAT_ID from env: "${process.env.TELEGRAM_CHAT_ID}"`);
  console.log(`[Telegram] Match check: "${chatId}" === "${process.env.TELEGRAM_CHAT_ID}" ? ${chatId === process.env.TELEGRAM_CHAT_ID}`);

  // Verify it's from the authorized user
  if (chatId !== process.env.TELEGRAM_CHAT_ID) {
    console.warn(`[Telegram] Unauthorized chat ID: "${chatId}" !== "${process.env.TELEGRAM_CHAT_ID}"`);
    return;
  }
  console.log('[Telegram] Chat ID authorized, proceeding...');

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
  console.log('[handleMessage] Step 1: Saving user message...');
  const { error: insertError } = await supabase.from('episodic_memory').insert({
    role: 'user',
    content: text,
    telegram_message_id: messageId,
  });
  if (insertError) {
    console.error('[handleMessage] Failed to save user message:', insertError);
    throw new Error(`DB insert failed: ${insertError.message}`);
  }
  console.log('[handleMessage] Step 1: OK');

  console.log('[handleMessage] Step 2: Getting system prompt...');
  let systemPrompt;
  try {
    systemPrompt = await getFullPrompt(text);
    console.log('[handleMessage] Step 2: OK');
  } catch (err) {
    console.error('[handleMessage] Failed to get prompt:', err);
    throw new Error(`getFullPrompt failed: ${err.message}`);
  }

  console.log('[handleMessage] Step 3: Fetching recent messages...');
  const { data: recentMessages, error: fetchError } = await supabase
    .from('episodic_memory')
    .select('role, content')
    .order('created_at', { ascending: false })
    .limit(10);
  if (fetchError) {
    console.error('[handleMessage] Failed to fetch messages:', fetchError);
    throw new Error(`DB fetch failed: ${fetchError.message}`);
  }
  console.log('[handleMessage] Step 3: OK, fetched', recentMessages?.length || 0, 'messages');

  const messages = (recentMessages || [])
    .reverse()
    .map(m => ({ role: m.role, content: m.content }));

  console.log('[handleMessage] Step 4: Generating AI response...');
  let aiResponse;
  try {
    aiResponse = await generateResponse(systemPrompt, messages);
    console.log('[handleMessage] Step 4: OK, response length:', aiResponse?.length);
  } catch (err) {
    console.error('[handleMessage] AI generation failed:', err);
    throw new Error(`AI generation failed: ${err.message}`);
  }

  console.log('[handleMessage] Step 5: Saving AI response...');
  const { error: aiInsertError } = await supabase.from('episodic_memory').insert({
    role: 'assistant',
    content: aiResponse,
  });
  if (aiInsertError) {
    console.error('[handleMessage] Failed to save AI response:', aiInsertError);
    throw new Error(`DB insert AI failed: ${aiInsertError.message}`);
  }
  console.log('[handleMessage] Step 5: OK');

  console.log('[handleMessage] Step 6: Processing exchange...');
  let summary, summaryText;
  try {
    summary = await processExchange(text, aiResponse);
    summaryText = formatSummary(summary);
    console.log('[handleMessage] Step 6: OK');
  } catch (err) {
    console.error('[handleMessage] Process exchange failed:', err);
    summaryText = '';
  }

  console.log('[handleMessage] Step 7: Sending Telegram message...');
  try {
    await sendMessage(chatId, aiResponse + summaryText);
    console.log('[handleMessage] Step 7: OK - Message sent!');
  } catch (err) {
    console.error('[handleMessage] Failed to send message:', err);
    throw new Error(`Send failed: ${err.message}`);
  }
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
