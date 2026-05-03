import { NextResponse } from 'next/server';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Simple test endpoint
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
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: '🔴 Test message',
      }),
    });
    const data = await res.json();
    return NextResponse.json({ success: data.ok, result: data });
  }

  return NextResponse.json({
    botTokenSet: !!TELEGRAM_BOT_TOKEN,
    chatIdSet: !!TELEGRAM_CHAT_ID,
    groqKeySet: !!GROQ_API_KEY,
  });
}

export async function POST(req) {
  try {
    const update = await req.json();
    
    // Await the handler - Vercel terminates the function after response is sent
    // so fire-and-forget does NOT work on serverless
    await handleTelegramMessage(update);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Telegram] POST error:', error.message);
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

async function handleTelegramMessage(update) {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = msg.chat.id.toString();
  const text = msg.text.trim();

  // Security check
  if (chatId !== TELEGRAM_CHAT_ID) {
    console.log(`[Telegram] Unauthorized: ${chatId}`);
    return;
  }

  console.log(`[Telegram] Processing: "${text.substring(0, 50)}"`);

  // Handle commands immediately
  if (text.startsWith('/')) {
    await handleCommand(chatId, text);
    return;
  }

  // For regular messages, respond with AI
  await handleAIResponse(chatId, text);
}

async function handleAIResponse(chatId, text) {
  try {
    // Send "typing" first
    await fetch(`${TELEGRAM_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });

    // Get AI response from Groq
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are SEOS, a helpful AI assistant. Be concise and friendly.' },
          { role: 'user', content: text }
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const aiReply = data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

    // Send response to Telegram
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: aiReply,
        parse_mode: 'Markdown',
      }),
    });

    console.log('[Telegram] AI response sent');
  } catch (err) {
    console.error('[Telegram] Error:', err.message);
    // Send error to user
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `❌ Error: ${err.message}`,
      }),
    });
  }
}

async function handleCommand(chatId, text) {
  const cmd = text.split(' ')[0].toLowerCase();

  let reply = '';
  switch (cmd) {
    case '/start':
      reply = '🔴 *SEOS Online*\n\nYour AI Chief of Staff is active. How can I help?';
      break;
    case '/help':
      reply = '📋 *Commands*\n/start - Start the bot\n/help - Show this help';
      break;
    default:
      reply = `Unknown command: ${cmd}`;
  }

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: reply,
      parse_mode: 'Markdown',
    }),
  });
}
