import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { generateResponse, generateStructuredExtraction } from '@/lib/services/groq';
import { sendMessage, sendChatAction } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';
import { processExchange, formatSummary } from '@/lib/services/postProcessor';
import { downloadTelegramFile, readUrl, analyzeImage, parsePdf, parseWord, getBestPhotoFileId, extractUrls } from '@/lib/services/fileProcessor';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ENTITY_PEOPLE_KEY = 'entity_people';
const ENTITY_PROJECTS_KEY = 'entity_projects';
const MOOD_TRACKING_COOLDOWN_KEY = 'mood_tracking_last_at';
const MESSAGE_DEDUPE_TTL_HOURS = 24;

/** Inserts a knowledge_base row; logs { error } with source + operation. Returns { error } for callers that need to branch. */
async function insertKnowledgeBase(row, operation) {
  const { error } = await supabase.from('knowledge_base').insert(row);
  if (error) {
    console.error('[KnowledgeBase]', error, { source: row.source, operation });
  }
  return { error };
}

function parseStructuredJson(raw, fallback) {
  try {
    const cleaned = (raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

function normalizeEntityName(name) {
  return (name || '').replace(/\s+/g, ' ').trim();
}

async function extractEntitiesFromMessage(text) {
  const prompt = `Extract named entities from this message.
Return ONLY JSON with shape:
{
  "people": [{"name":"", "context":""}],
  "projects": [{"name":"", "context":""}]
}
Rules:
- Include people names (friends, clients, professors, collaborators).
- Include project/product/workstream names.
- Keep context concise (<100 chars).
- If none, use empty arrays.

MESSAGE:
"${text}"`;

  const raw = await generateStructuredExtraction(prompt);
  const parsed = parseStructuredJson(raw, { people: [], projects: [] });

  const people = (Array.isArray(parsed.people) ? parsed.people : [])
    .map(p => ({ name: normalizeEntityName(p.name), context: (p.context || '').trim() }))
    .filter(p => p.name.length >= 2 && p.name.length <= 60);
  const projects = (Array.isArray(parsed.projects) ? parsed.projects : [])
    .map(p => ({ name: normalizeEntityName(p.name), context: (p.context || '').trim() }))
    .filter(p => p.name.length >= 2 && p.name.length <= 80);

  return { people, projects };
}

async function upsertEntityMemory(key, entities) {
  if (!entities.length) return;

  const { data: existing, error: readError } = await supabase
    .from('core_memory')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (readError) throw readError;

  const map = new Map();
  const existingLines = (existing?.value || '').split('\n').map(x => x.trim()).filter(Boolean);
  for (const line of existingLines) {
    const [name, context = '', lastSeen = ''] = line.split('|').map(s => s.trim());
    if (!name) continue;
    map.set(name.toLowerCase(), { name, context, lastSeen });
  }

  const now = new Date().toISOString();
  for (const entity of entities) {
    const id = entity.name.toLowerCase();
    const prior = map.get(id);
    map.set(id, {
      name: entity.name,
      context: entity.context || prior?.context || '',
      lastSeen: now,
    });
  }

  const merged = [...map.values()]
    .slice(-80)
    .map(e => `${e.name} | ${e.context || '-'} | ${e.lastSeen}`)
    .join('\n');

  const { error: upsertError } = await supabase
    .from('core_memory')
    .upsert(
      {
        key,
        value: merged,
        updated_at: now,
      },
      { onConflict: 'key' }
    );
  if (upsertError) throw upsertError;
}

async function trackEntitiesInBackground(text) {
  if (!text || text.length < 4) return;
  const entities = await extractEntitiesFromMessage(text);
  await Promise.all([
    upsertEntityMemory(ENTITY_PEOPLE_KEY, entities.people),
    upsertEntityMemory(ENTITY_PROJECTS_KEY, entities.projects),
  ]);
}

async function detectMoodSignal(text) {
  const raw = await generateStructuredExtraction(`Detect emotional signal from this message.
Return JSON only:
{
  "mood": "positive|neutral|stressed|frustrated|anxious|focused|excited|overwhelmed|sad",
  "intensity": "low|medium|high",
  "confidence": "low|medium|high",
  "observation": "short first-person-relevant pattern note"
}

MESSAGE:
"${text}"`);

  return parseStructuredJson(raw, {
    mood: 'neutral',
    intensity: 'low',
    confidence: 'low',
    observation: '',
  });
}

async function trackMoodInBackground(text) {
  if (!text || text.length < 8) return;

  const now = new Date();
  const { data: cooldown } = await supabase
    .from('working_memory')
    .select('value')
    .eq('key', MOOD_TRACKING_COOLDOWN_KEY)
    .maybeSingle();
  if (cooldown?.value && new Date(cooldown.value) > now) return;

  const mood = await detectMoodSignal(text);
  if (!mood || mood.mood === 'neutral' || mood.confidence === 'low') return;

  const confidence = mood.confidence === 'high' ? 'high' : 'medium';
  const observation = `[mood:${mood.mood}|${mood.intensity}] ${mood.observation || 'Emotional signal detected from latest user message.'}`;
  const { error } = await supabase.from('patterns').insert({ observation, confidence });
  if (error) throw error;

  const nextTrackAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  await supabase
    .from('working_memory')
    .upsert(
      { key: MOOD_TRACKING_COOLDOWN_KEY, value: nextTrackAt, expires_at: nextTrackAt },
      { onConflict: 'key' }
    );
}

async function hasProcessedTelegramMessage(messageId) {
  if (!messageId) return false;
  const key = `telegram_processed_${messageId}`;
  const { data, error } = await supabase
    .from('working_memory')
    .select('id')
    .eq('key', key)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1);
  if (error) {
    console.error('[Telegram] Dedupe check failed:', error.message);
    return false;
  }
  return (data || []).length > 0;
}

async function markTelegramMessageProcessed(messageId) {
  if (!messageId) return;
  const key = `telegram_processed_${messageId}`;
  const expiresAt = new Date(Date.now() + MESSAGE_DEDUPE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('working_memory').insert({
    key,
    value: '1',
    expires_at: expiresAt,
  });
  if (error) {
    console.error('[Telegram] Dedupe mark failed:', error.message);
  }
}

function sanitizeAssistantReply(response, recentMessages = []) {
  const fallback = "Got it. Let's reset and keep this useful. Tell me exactly what you want me to do right now.";
  const text = (response || '').trim();
  if (!text) return fallback;

  if (/(i(?:'| a)m not going to engage|i(?:'| a)ve had enough|this is not a conversation|end of conversation|not acceptable)/i.test(text)) {
    return fallback;
  }

  const hasHistory = (recentMessages || []).length >= 4;
  if (hasHistory && /(our conversation just started|this is the beginning of our conversation|i don't know much about you|i'm a blank slate)/i.test(text)) {
    return 'I do have your ongoing context. If you want, I can show your current tasks/reminders or clear/reset them.';
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const uniqueLines = [];
  const seen = new Set();
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueLines.push(line);
  }

  return uniqueLines.join('\n').trim() || fallback;
}

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

  // Voice message
  if (msg.voice) {
    await handleVoice(chatId, msg, messageId);
    return;
  }

  // Photo message
  if (msg.photo) {
    await handlePhoto(chatId, msg, messageId);
    return;
  }

  // Document (PDF, Word, etc.)
  if (msg.document) {
    await handleDocument(chatId, msg, messageId);
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

async function handlePhoto(chatId, msg, messageId) {
  try {
    await sendMessage(chatId, '🔍 Analyzing image...');
    const fileId = getBestPhotoFileId(msg.photo);
    const { url: imageUrl } = await downloadTelegramFile(fileId);
    const caption = msg.caption || '';
    const prompt = caption
      ? `${caption}\n\nAlso describe the image in detail and extract any visible text.`
      : 'Describe this image in detail. Extract all visible text. Give a thorough analysis of what you see.';

    const analysis = await analyzeImage(imageUrl, prompt);

    await insertKnowledgeBase(
      {
        source: 'image',
        content: `[Image analysis] ${analysis}`,
        embedding_summary: analysis.substring(0, 200),
      },
      'handlePhoto'
    );

    // Pass to AI with context
    await handleMessage(chatId, `[I sent an image. Analysis: ${analysis}]`, messageId);
  } catch (err) {
    console.error('[Telegram] Photo error:', err.message);
    await sendMessage(chatId, `❌ Couldn't analyze image: ${err.message}`);
  }
}

async function handleDocument(chatId, msg, messageId) {
  const mime = msg.document?.mime_type || '';
  const fileName = msg.document?.file_name || 'file';

  try {
    await sendMessage(chatId, `📄 Reading *${fileName}*...`);
    const { buffer } = await downloadTelegramFile(msg.document.file_id);

    let content = '';

    if (mime === 'application/pdf' || fileName.endsWith('.pdf')) {
      content = await parsePdf(buffer);
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.docx')
    ) {
      content = await parseWord(buffer);
    } else if (mime.startsWith('text/') || fileName.endsWith('.txt')) {
      content = new TextDecoder().decode(buffer).substring(0, 6000);
    } else if (mime.startsWith('image/')) {
      const { url: imageUrl } = await downloadTelegramFile(msg.document.file_id);
      content = await analyzeImage(imageUrl);
    } else {
      return await sendMessage(chatId, `⚠️ I can read PDFs, Word docs, text files, and images. This file type (${mime}) isn't supported yet.`);
    }

    await insertKnowledgeBase(
      {
        source: 'document',
        content: `[Document: ${fileName}]\n${content}`,
        embedding_summary: content.substring(0, 200),
      },
      'handleDocument'
    );

    await handleMessage(chatId, `[I sent a document "${fileName}". Content: ${content}]`, messageId);
  } catch (err) {
    console.error('[Telegram] Document error:', err.message);
    await sendMessage(chatId, `❌ Couldn't read document: ${err.message}`);
  }
}

async function handleVoice(chatId, msg, messageId) {
  try {
    await sendChatAction(chatId, 'typing');
    const { buffer } = await downloadTelegramFile(msg.voice.file_id);

    // Transcribe with Groq Whisper (free)
    const groqKey = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '').split(',')[0].trim();
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: 'audio/ogg' }), 'voice.ogg');
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'en');

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}` },
      body: formData,
    });

    if (!resp.ok) throw new Error(`Whisper error: ${resp.status}`);
    const data = await resp.json();
    const transcript = data.text || '';

    if (!transcript) {
      return await sendMessage(chatId, '⚠️ Could not transcribe voice message.');
    }

    await sendMessage(chatId, `🎙️ _"${transcript}"_`);
    await handleMessage(chatId, transcript, messageId);
  } catch (err) {
    console.error('[Telegram] Voice error:', err.message);
    await sendMessage(chatId, `❌ Voice processing failed: ${err.message}`);
  }
}

async function handleMessage(chatId, text, messageId) {
  // Show typing indicator
  await sendChatAction(chatId, 'typing');

  // Auto-detect URLs in the message and read them
  const urls = extractUrls(text);
  let processedText = text;
  if (urls.length > 0 && !text.startsWith('[')) {
    for (const url of urls.slice(0, 2)) {
      try {
        await sendMessage(chatId, `🔗 Reading ${url}...`);
        const content = await readUrl(url);
        await insertKnowledgeBase(
          {
            source: 'user_link',
            content: `[URL: ${url}]\n${content}`,
            embedding_summary: content.substring(0, 200),
          },
          `handleMessage:url:${url}`
        );
        processedText = processedText.replace(url, `[URL content from ${url}: ${content.substring(0, 500)}...]`);
      } catch (err) {
        console.warn(`[Telegram] URL read failed for ${url}:`, err.message);
      }
    }
  }

  // Run DB writes + context fetch in parallel
  const [, , systemPrompt, recentResult] = await Promise.all([
    // Save user message
    supabase.from('episodic_memory').insert({
      role: 'user',
      content: processedText,
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
    getFullPrompt(processedText),
    // Fetch recent conversation history
    supabase.from('episodic_memory').select('role, content').order('created_at', { ascending: false }).limit(20),
  ]);

  const messages = (recentResult.data || [])
    .reverse()
    .map(m => ({ role: m.role, content: m.content }));

  // Generate AI response
  let aiResponse;
  try {
    aiResponse = await generateResponse(systemPrompt, messages);
  } catch (err) {
    console.error('[Telegram] AI generation failed:', err.message);
    await sendMessage(chatId, '⚠️ All AI providers are currently down. Try again in a minute.');
    return;
  }

  const safeResponse = sanitizeAssistantReply(aiResponse, messages);

  // Send reply FIRST — user sees it immediately
  await sendMessage(chatId, safeResponse);
  console.log('[Telegram] AI response sent');

  // Skip post-processing for short/casual messages (saves an API call)
  const isShort = processedText.length < 15 && !processedText.match(/remind|task|deadline|schedule|set|save/i);

  // Save AI response + post-process in background (user already has reply)
  await Promise.all([
    supabase.from('episodic_memory').insert({ role: 'assistant', content: safeResponse }),
    isShort ? Promise.resolve() : processExchange(processedText, safeResponse).then(summary => {
      const summaryText = formatSummary(summary);
      if (summaryText.trim()) {
        return sendMessage(chatId, summaryText);
      }
    }).catch(err => console.error('[Telegram] Post-processor error:', err.message)),
    trackEntitiesInBackground(processedText).catch(err => console.error('[Telegram] Entity tracking error:', err.message)),
    trackMoodInBackground(processedText).catch(err => console.error('[Telegram] Mood tracking error:', err.message)),
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
    case '/review':
      await cmdBrief(chatId);
      break;
    case '/done': {
      const arg = text.split(' ')[1];
      await cmdDone(chatId, arg);
      break;
    }
    case '/clear': {
      const arg = text.split(' ')[1];
      await cmdClear(chatId, arg);
      break;
    }
    case '/save': {
      const parts = text.split(' ');
      const label = parts[1];
      const value = parts.slice(2).join(' ');
      await cmdSave(chatId, label, value);
      break;
    }
    case '/read': {
      const url = text.split(' ')[1];
      await cmdReadUrl(chatId, url);
      break;
    }
    case '/research': {
      const topic = text.split(' ').slice(1).join(' ');
      await cmdResearch(chatId, topic);
      break;
    }
    case '/help':
      await sendMessage(chatId, '📋 *Commands*\n/tasks — open tasks\n/reminders — upcoming reminders\n/ideas — raw ideas\n/memory — core memory\n/brief — morning brief\n/review — quick daily review\n/done [id] — mark task done\n/done all — mark ALL tasks done\n/clear tasks — delete open tasks\n/clear reminders — delete upcoming reminders\n/clear all — clear tasks + reminders\n/save [label] [value] — store secure note/password\n/read [url] — read and save a link\n/research [topic] — deep dive a topic\n/help — this list');
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

async function cmdDone(chatId, arg) {
  if (!arg) {
    return await sendMessage(chatId, '❌ Usage: /done [task-id] or /done all');
  }

  if (arg.toLowerCase() === 'all') {
    const { data: tasks } = await supabase
      .from('tasks')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .in('status', ['open', 'snoozed'])
      .select('title');
    const count = tasks?.length || 0;
    return await sendMessage(chatId, `✅ Marked ${count} task(s) as done.`);
  }

  // Fetch open tasks and match partial ID in JS (UUID columns don't support ilike)
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title')
    .in('status', ['open', 'snoozed']);

  const match = tasks?.find(t => t.id.startsWith(arg.toLowerCase()));
  if (!match) {
    return await sendMessage(chatId, `❌ Task not found: \`${arg}\`\nGet IDs from /tasks`);
  }

  await supabase
    .from('tasks')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', match.id);

  await sendMessage(chatId, `✅ Done: *${match.title}*`);
}

async function cmdClear(chatId, arg) {
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

async function cmdSave(chatId, label, value) {
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

async function cmdReadUrl(chatId, url) {
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
    const systemPrompt = await import('@/lib/services/context').then(m => m.getFullPrompt(url));
    const summary = await generateResponse(systemPrompt, [
      { role: 'user', content: `Summarize this content from ${url}:\n\n${content}` }
    ]);
    await sendMessage(chatId, `🔗 *Read & saved*: ${url}\n\n${summary}`);
  } catch (err) {
    await sendMessage(chatId, `❌ Couldn't read that URL: ${err.message}`);
  }
}

async function cmdResearch(chatId, topic) {
  if (!topic) {
    return await sendMessage(chatId, '🔬 Usage: `/research [topic]`');
  }
  try {
    await sendMessage(chatId, `🔬 Researching *${topic}*...`);
    // Use Wikipedia and DuckDuckGo instant answers as free research sources
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

    const systemPrompt = await import('@/lib/services/context').then(m => m.getFullPrompt(topic));
    const report = await generateResponse(systemPrompt, [
      { role: 'user', content: `Based on this research about "${topic}", give me a concise, insightful summary with the most important points and what I should know:\n\n${sources.substring(0, 3000)}` }
    ]);

    await sendMessage(chatId, `🔬 *Research: ${topic}*\n\n${report}\n\n_Saved to your knowledge base._`);
  } catch (err) {
    await sendMessage(chatId, `❌ Research failed: ${err.message}`);
  }
}
