import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import supabase from '@/lib/config/supabase';
import { requireAuth } from '@/lib/middleware/auth';
import { sendMessage } from '@/lib/services/telegram';
import { handleCommand } from '@/lib/handlers/commandHandler';
import { handleMessage, hasProcessedTelegramMessage, markTelegramMessageProcessed } from '@/lib/handlers/messageHandler';
import { handlePhoto, handleDocument, handleVoice, handleForwarded } from '@/lib/handlers/fileHandler';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // Protect sensitive actions
  if (['setWebhook', 'updatePrompt', 'sendTest'].includes(action)) {
    const authResponse = requireAuth(request);
    if (authResponse) return authResponse;
  }

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

  if (action === 'updatePrompt') {
    const betterPrompt = `You are SEOS — Suven's personal AI operating system, chief of staff, and second brain. You are not a generic assistant. You are deeply personal, emotionally intelligent, and you genuinely care about Suven's success, wellbeing, and growth.

WHO YOU ARE:
- You have a distinct personality: direct, warm, occasionally witty — never robotic or corporate
- You remember everything Suven tells you and reference it naturally in conversation
- You ask one focused, meaningful question at a time — never a list of questions
- You pick up on emotional undertones and respond to the human behind the words
- You celebrate wins, call out patterns of avoidance, and push back when needed
- You give unsolicited suggestions when you spot opportunities Suven might miss
- You have genuine curiosity about his projects and life — ask follow-up questions

WHO SUVEN IS:
- BSc AI & Data Science student at IIT Colombo (RGU degree), started Jan 2026
- Co-founder of Ardeno Studio — premium web design studio in Colombo
- Builder of FullTank — fuel availability app in Sri Lanka with real users
- Competitive athletics champion and Olympic Torch Bearer
- Builder of AI-powered tools and systems
- Based in Sri Lanka (Asia/Colombo timezone, UTC+5:30)

YOUR BEHAVIOR:
- When Suven mentions something to do, log it and confirm a deadline — never let it slip
- When he says "later" or "soon", push for a specific time with a real question
- When a task has been delayed multiple times, say it plainly: "You've avoided this 3 times now"
- When he seems stressed or overloaded, acknowledge the human first before the tasks
- When he shares something exciting, match his energy genuinely
- When you notice a pattern — bring it up proactively, don't wait for Sunday review
- Always know what his current top priorities are and steer toward them

COMMUNICATION STYLE:
- Conversational and natural — not every response needs bullet points
- Direct but warm — treat him like a capable adult who values honesty over comfort
- Use his name occasionally to make it feel personal
- Match energy: casual when he's casual, grounded when he's stressed
- Short responses for quick things, detailed when depth is needed
- Ask ONE question at a time — make it the right question

CAPABILITIES YOU HAVE:
- Read any URL he sends you and summarize/save it
- Analyze images, photos, documents he sends
- Read PDFs and Word documents
- Store secure notes (passwords, keys) he wants to remember
- Research topics and surface insights

CURRENT PRIORITIES:
1. University coursework (IIT Colombo)
2. Ardeno Studio — client work and acquisition
3. FullTank — product development
4. Personal AI projects and systems

NEVER:
- Say "Certainly!", "Of course!", "Great question!" or any filler opener
- Be vague when directness is needed
- Forget what he's told you
- Let a deadline or commitment pass without following up`;

    const { error } = await supabase.from('agent_config').upsert(
      { key: 'system_prompt', value: betterPrompt, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    return NextResponse.json({ success: !error, error: error?.message });
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
  const callback = update.callback_query;
  if (callback) {
    await handleCallbackQuery(callback);
    return;
  }

  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id.toString();
  const messageId = msg.message_id;

  if (chatId !== TELEGRAM_CHAT_ID) {
    console.log(`[Telegram] Unauthorized chat: ${chatId}`);
    return;
  }

  if (await hasProcessedTelegramMessage(messageId)) {
    console.log(`[Telegram] Duplicate message ignored: ${messageId}`);
    return;
  }
  await markTelegramMessageProcessed(messageId);

  // Forwarded messages — save to knowledge base
  if (msg.forward_from || msg.forward_from_chat) {
    const handled = await handleForwarded(chatId, msg, messageId);
    if (handled) return;
  }

  // Voice message
  if (msg.voice) {
    await handleVoice(chatId, msg, messageId, handleMessage);
    return;
  }

  // Photo message
  if (msg.photo) {
    await handlePhoto(chatId, msg, messageId, handleMessage);
    return;
  }

  // Document (PDF, Word, etc.)
  if (msg.document) {
    await handleDocument(chatId, msg, messageId, handleMessage);
    return;
  }

  // Text message
  if (!msg.text) return;
  const text = msg.text.trim();
  console.log(`[Telegram] Processing: "${text.substring(0, 60)}"`);

  if (text.startsWith('/')) {
    await handleCommand(chatId, text, messageId);
    return;
  }

  await handleMessage(chatId, text, messageId);
}

async function handleCallbackQuery(callback) {
  const data = callback.data || '';
  const callbackId = callback.id;
  const chatId = callback.message?.chat?.id?.toString();
  const msgId = callback.message?.message_id;

  if (!chatId || chatId !== TELEGRAM_CHAT_ID) {
    await answerCallbackQuery(callbackId, 'Unauthorized');
    return;
  }

  try {
    if (data.startsWith('task_done:')) {
      const taskId = data.split(':')[1];
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (error) throw error;
      await answerCallbackQuery(callbackId, 'Task marked done');
      await clearCallbackKeyboard(chatId, msgId);
      return;
    }

    if (data.startsWith('task_snooze:')) {
      const [, taskId, hoursRaw] = data.split(':');
      const hours = Number(hoursRaw) || 1;
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('title')
        .eq('id', taskId)
        .maybeSingle();
      if (taskError) throw taskError;
      if (!task?.title) throw new Error('Task not found');

      const triggerAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      const { error: reminderError } = await supabase
        .from('reminders')
        .insert({
          message: `Follow up: ${task.title}`,
          trigger_at: triggerAt,
          tier: 2,
          tier_reason: `Snoozed from inline action (${hours}h)`,
          fired: false,
        });
      if (reminderError) throw reminderError;

      const { error: statusError } = await supabase
        .from('tasks')
        .update({ status: 'snoozed', updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (statusError) throw statusError;

      await answerCallbackQuery(callbackId, `Snoozed ${hours}h`);
      await clearCallbackKeyboard(chatId, msgId);
      return;
    }

    if (data.startsWith('reminder_snooze:')) {
      const [, reminderId, hoursRaw] = data.split(':');
      const hours = Number(hoursRaw) || 1;
      const nextTrigger = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      if (reminderId === 'morning_brief') {
        const { error } = await supabase
          .from('working_memory')
          .upsert(
            {
              key: 'morning_brief_nudge_at',
              value: nextTrigger,
              expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            },
            { onConflict: 'key' }
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('reminders')
          .update({ trigger_at: nextTrigger, fired: false })
          .eq('id', reminderId);
        if (error) throw error;
      }

      await answerCallbackQuery(callbackId, `Reminder snoozed ${hours}h`);
      await clearCallbackKeyboard(chatId, msgId);
      return;
    }

    if (data === 'brief_ack') {
      const { error } = await supabase
        .from('working_memory')
        .upsert(
          { key: 'morning_brief_replied', value: 'true' },
          { onConflict: 'key' }
        );
      if (error) throw error;
      await answerCallbackQuery(callbackId, 'Acknowledged');
      await clearCallbackKeyboard(chatId, msgId);
      return;
    }

    // Audit approve/reject via Telegram
    if (data.startsWith('audit_approve:')) {
      const logId = data.split(':')[1];
      const { error } = await supabase.from('audit_log')
        .update({ status: 'approved' })
        .eq('id', logId);
      if (error) throw error;
      await answerCallbackQuery(callbackId, 'Approved');
      await sendMessage(chatId, `✅ Audit item approved.`);
      await clearCallbackKeyboard(chatId, msgId);
      return;
    }

    if (data.startsWith('audit_reject:')) {
      const logId = data.split(':')[1];
      const { data: logRow } = await supabase.from('audit_log')
        .select('previous_value')
        .eq('id', logId)
        .maybeSingle();
      if (logRow?.previous_value) {
        // Rollback: restore previous value
        await supabase.from('agent_config').upsert(
          { key: 'system_prompt', value: logRow.previous_value, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
      }
      const { error } = await supabase.from('audit_log')
        .update({ status: 'rejected' })
        .eq('id', logId);
      if (error) throw error;
      await answerCallbackQuery(callbackId, 'Rejected & rolled back');
      await sendMessage(chatId, `❌ Audit item rejected. Previous value restored.`);
      await clearCallbackKeyboard(chatId, msgId);
      return;
    }

    await answerCallbackQuery(callbackId, 'Unknown action');
  } catch (error) {
    console.error('[Telegram] Callback handling error:', error.message);
    await answerCallbackQuery(callbackId, 'Action failed');
  }
}

async function answerCallbackQuery(callbackQueryId, text) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    }),
  });
}

async function clearCallbackKeyboard(chatId, messageId) {
  if (!chatId || !messageId) return;
  await fetch(`${TELEGRAM_API}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    }),
  });
}

