import supabase from '@/lib/config/supabase';
import { generateResponse, generateStructuredExtraction } from '@/lib/services/groq';
import { sendMessage, sendChatAction } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';
import { processExchange, formatSummary } from '@/lib/services/postProcessor';
import { readUrl, extractUrls } from '@/lib/services/fileProcessor';
import { searchWeb } from '@/lib/services/search';
import { listMessages, getMessageContent } from '@/lib/services/gmail';
import {
  insertKnowledgeBase,
  parseStructuredJson,
  normalizeEntityName,
  normalizeForCompare,
  isGreetingOnlyMessage,
  buildWarmGreetingReply,
  buildColomboTriggerIso,
} from '@/lib/handlers/utils';

const ENTITY_PEOPLE_KEY = 'entity_people';
const ENTITY_PROJECTS_KEY = 'entity_projects';
const MOOD_TRACKING_COOLDOWN_KEY = 'mood_tracking_last_at';

// ── Entity Extraction ─────────────────────────────────────────────────────────
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
      { key, value: merged, updated_at: now },
      { onConflict: 'key' }
    );
  if (upsertError) console.error('[Entity] upsert error:', upsertError.message);

  // Also upsert into dedicated entities table
  const type = key === ENTITY_PEOPLE_KEY ? 'person' : 'project';
  for (const entity of entities) {
    const { error } = await supabase.from('entities').upsert(
      {
        name: entity.name,
        type,
        context_summary: entity.context || null,
        last_mentioned: now,
        mention_count: 1,
      },
      { onConflict: 'name,type', ignoreDuplicates: false }
    ).then(async (result) => {
      if (!result.error) {
        // Increment mention count on conflict
        await supabase.rpc('increment_entity_mention', { entity_name: entity.name, entity_type: type }).catch(() => {});
      }
      return result;
    });
    if (error) console.error('[Entity] table upsert error:', error.message);
  }
}

async function trackEntitiesInBackground(text) {
  if (!text || text.length < 4) return;
  const entities = await extractEntitiesFromMessage(text);
  await Promise.all([
    upsertEntityMemory(ENTITY_PEOPLE_KEY, entities.people),
    upsertEntityMemory(ENTITY_PROJECTS_KEY, entities.projects),
  ]);
}

// ── Mood Tracking ─────────────────────────────────────────────────────────────
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

  // Write to both patterns and mood_log tables
  const { error: patternError } = await supabase.from('patterns').insert({ observation, confidence, category: 'personal' });
  if (patternError) console.error('[Mood] patterns insert error:', patternError.message);

  const { error: moodError } = await supabase.from('mood_log').insert({
    mood: mood.mood,
    intensity: mood.intensity,
    confidence: mood.confidence,
    observation: mood.observation,
    source: 'auto',
  });
  if (moodError) console.error('[Mood] mood_log insert error:', moodError.message);

  const nextTrackAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  await supabase
    .from('working_memory')
    .upsert(
      { key: MOOD_TRACKING_COOLDOWN_KEY, value: nextTrackAt, expires_at: nextTrackAt },
      { onConflict: 'key' }
    );
}

// ── Deduplication ─────────────────────────────────────────────────────────────
const MESSAGE_DEDUPE_TTL_HOURS = 24;

export async function hasProcessedTelegramMessage(messageId) {
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

export async function markTelegramMessageProcessed(messageId) {
  if (!messageId) return;
  const key = `telegram_processed_${messageId}`;
  const expiresAt = new Date(Date.now() + MESSAGE_DEDUPE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('working_memory').upsert(
    { key, value: '1', expires_at: expiresAt },
    { onConflict: 'key' }
  );
  if (error) console.error('[Telegram] Dedupe mark failed:', error.message);
}

// ── Reminder Intent Parsing ───────────────────────────────────────────────────
function extractReminderMessage(text = '') {
  const reminderMatch = text.match(/remind me(?:\s+(?:to|about))?\s+(.+)/i)
    || text.match(/set (?:a )?reminder(?:\s+(?:to|for))?\s+(.+)/i);
  let message = reminderMatch?.[1] || 'Follow up';
  message = message
    .replace(/\b(today|tomorrow)\b/ig, ' ')
    .replace(/\b(at|from)\s*\d{1,2}(?::\d{2})?\s*(am|pm)\b/ig, ' ')
    .replace(/\bevery (half an hour|30 minutes).*/ig, ' ')
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return message || 'Follow up';
}

export function parseNaturalReminderIntent(text = '') {
  if (!/\b(remind me|set (a )?reminder|reminder)\b/i.test(text)) return null;

  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const mentionsTomorrow = /\btomorrow\b/i.test(text);
  const mentionsToday = /\btoday\b/i.test(text);
  const reminderMessage = extractReminderMessage(text);

  if (!timeMatch) {
    return {
      intent: 'needs_time',
      dayLabel: mentionsTomorrow ? 'tomorrow' : (mentionsToday ? 'today' : 'tomorrow'),
      reminderMessage,
    };
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridiem = timeMatch[3].toLowerCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  let dayOffset = mentionsTomorrow ? 1 : 0;
  if (!mentionsTomorrow && !mentionsToday) {
    const nowColombo = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' }));
    const currentMinutes = nowColombo.getHours() * 60 + nowColombo.getMinutes();
    const targetMinutes = hour * 60 + minute;
    if (targetMinutes <= currentMinutes) dayOffset = 1;
  }

  return {
    intent: 'set',
    reminderMessage,
    triggerAt: buildColomboTriggerIso(dayOffset, hour, minute),
  };
}

function normalizeReminderForCompare(message = '') {
  return (message || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function hasSimilarPendingReminder(message, triggerAt) {
  const windowStart = new Date(new Date(triggerAt).getTime() - (60 * 60 * 1000)).toISOString();
  const windowEnd = new Date(new Date(triggerAt).getTime() + (60 * 60 * 1000)).toISOString();
  const { data, error } = await supabase
    .from('reminders')
    .select('message, trigger_at')
    .eq('fired', false)
    .gte('trigger_at', windowStart)
    .lte('trigger_at', windowEnd)
    .limit(30);
  if (error) {
    console.error('[Telegram] Reminder dedupe check failed:', error.message);
    return false;
  }

  const normalizedMessage = normalizeReminderForCompare(message);
  const targetMs = new Date(triggerAt).getTime();
  return (data || []).some((r) => {
    const sameMessage = normalizeReminderForCompare(r.message) === normalizedMessage;
    const ms = new Date(r.trigger_at).getTime();
    return sameMessage && Math.abs(ms - targetMs) <= (15 * 60 * 1000);
  });
}

// ── Response Sanitization ─────────────────────────────────────────────────────
function sanitizeAssistantReply(response, recentMessages = [], userText = '', lastAssistantText = '') {
  const fallback = "I'm here with you. Tell me what you want to do next, and I'll handle it.";
  const text = (response || '').trim();
  if (!text) return isGreetingOnlyMessage(userText) ? buildWarmGreetingReply() : fallback;

  const refusalOrScolding = /(i(?:'| a)m not going to engage|i(?:'| a)ve had enough|this is not a conversation|end of conversation|not acceptable)/i.test(text);
  if (refusalOrScolding) {
    if (isGreetingOnlyMessage(userText)) return buildWarmGreetingReply();
    if (/\b(remind me|set (a )?reminder|reminder)\b/i.test(userText)) {
      return "Got it. I can set that reminder. If you didn't include a time, tell me the exact time and I'll schedule it.";
    }
    return fallback;
  }

  const hasHistory = (recentMessages || []).length >= 4;
  if (hasHistory && /(our conversation just started|this is the beginning of our conversation|i don't know much about you|i'm a blank slate)/i.test(text)) {
    return "I do have your ongoing context. Want me to show reminders, tasks, or just continue chatting?";
  }

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const uniqueLines = [];
  const seen = new Set();
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueLines.push(line);
  }

  const cleaned = uniqueLines.join('\n').trim() || fallback;
  if (normalizeForCompare(cleaned) === normalizeForCompare(lastAssistantText || '')) {
    return isGreetingOnlyMessage(userText)
      ? buildWarmGreetingReply()
      : "Got you. I'm here and ready—tell me the next thing you want me to handle.";
  }
  return cleaned;
}

// ── Expense Detection from Natural Messages ───────────────────────────────────
function detectExpenseInMessage(text) {
  const match = text.match(/(?:spent|paid|bought|cost)\s+(?:rs\.?\s*)?(\d+[\d,]*)\s+(?:on|for)\s+(.+)/i);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(/,/g, ''));
  const description = match[2].trim();
  const categoryMap = {
    food: /\b(lunch|dinner|breakfast|coffee|tea|snack|meal|eat|food|restaurant)\b/i,
    transport: /\b(uber|taxi|bus|train|fuel|petrol|diesel|ride|transport)\b/i,
    study: /\b(book|course|tuition|stationery|print|textbook)\b/i,
    health: /\b(medicine|doctor|pharmacy|gym|health|vitamin)\b/i,
    entertainment: /\b(movie|game|netflix|spotify|subscription)\b/i,
  };
  let category = 'other';
  for (const [cat, regex] of Object.entries(categoryMap)) {
    if (regex.test(description)) { category = cat; break; }
  }
  return { amount, category, description };
}

// ── Main Message Handler ──────────────────────────────────────────────────────
export async function handleMessage(chatId, text, messageId) {
  await sendChatAction(chatId, 'typing');

  // Auto-detect URLs
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

  // Auto-detect expenses from natural language
  const expenseDetected = detectExpenseInMessage(processedText);
  if (expenseDetected) {
    const { error } = await supabase.from('expenses').insert(expenseDetected);
    if (!error) {
      await sendMessage(chatId, `💰 Auto-logged: *Rs. ${expenseDetected.amount}* (${expenseDetected.category}) — ${expenseDetected.description}`);
    }
  }

  // Save user message + update morning brief signal
  await Promise.all([
    supabase.from('episodic_memory').insert({
      role: 'user',
      content: processedText,
      telegram_message_id: messageId,
    }).then(({ error }) => { if (error) console.error('[Episodic] insert error:', error.message); }),
    (async () => {
      const istHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false }), 10);
      if (istHour >= 8 && istHour < 11) {
        await supabase.from('working_memory').upsert(
          { key: 'morning_brief_replied', value: 'true' },
          { onConflict: 'key' }
        );
      }
    })(),
  ]);

  // Prepare message history
  const { data: recentRows } = await supabase
    .from('episodic_memory')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  const messages = (recentRows || [])
    .reverse()
    .map(m => {
      const msg = { role: m.role, content: m.content };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.name) msg.name = m.name;
      return msg;
    });

  const lastAssistantText = [...messages].reverse().find((m) => m.role === 'assistant')?.content || '';

  // Quick greeting flow
  if (isGreetingOnlyMessage(processedText)) {
    const greetingResponse = sanitizeAssistantReply(buildWarmGreetingReply(), messages, processedText, lastAssistantText);
    await sendMessage(chatId, greetingResponse);
    await Promise.all([
      supabase.from('episodic_memory').insert({ role: 'assistant', content: greetingResponse }).then(({ error }) => { if (error) console.error('[Episodic] insert error:', error.message); }),
      trackEntitiesInBackground(processedText).catch(err => console.error('[Telegram] Entity tracking error:', err.message)),
      trackMoodInBackground(processedText).catch(err => console.error('[Telegram] Mood tracking error:', err.message)),
    ]);
    return;
  }

  // Quick reminder intent flow
  const reminderIntent = parseNaturalReminderIntent(processedText);
  if (reminderIntent?.intent === 'needs_time') {
    const askTime = `Got it — what time ${reminderIntent.dayLabel} should I remind you to ${reminderIntent.reminderMessage}?`;
    await sendMessage(chatId, askTime);
    await Promise.all([
      supabase.from('episodic_memory').insert({ role: 'assistant', content: askTime }).then(({ error }) => { if (error) console.error('[Episodic] insert error:', error.message); }),
      trackEntitiesInBackground(processedText).catch(err => console.error('[Telegram] Entity tracking error:', err.message)),
      trackMoodInBackground(processedText).catch(err => console.error('[Telegram] Mood tracking error:', err.message)),
    ]);
    return;
  }

  if (reminderIntent?.intent === 'set') {
    const exists = await hasSimilarPendingReminder(reminderIntent.reminderMessage, reminderIntent.triggerAt);
    let reminderResponse;
    if (exists) {
      reminderResponse = `Already set ✅ I'll remind you on ${new Date(reminderIntent.triggerAt).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}.`;
    } else {
      const { error } = await supabase.from('reminders').insert({
        message: reminderIntent.reminderMessage,
        trigger_at: reminderIntent.triggerAt,
        tier: 2,
        tier_reason: 'Direct natural-language reminder request',
        fired: false,
      });
      if (error) {
        console.error('[Telegram] Reminder insert failed:', error.message);
        reminderResponse = "I couldn't save that reminder right now. Try once more and I'll set it.";
      } else {
        reminderResponse = `Done ✅ I'll remind you on ${new Date(reminderIntent.triggerAt).toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}.`;
      }
    }

    await sendMessage(chatId, reminderResponse);
    await Promise.all([
      supabase.from('episodic_memory').insert({ role: 'assistant', content: reminderResponse }).then(({ error }) => { if (error) console.error('[Episodic] insert error:', error.message); }),
      trackEntitiesInBackground(processedText).catch(err => console.error('[Telegram] Entity tracking error:', err.message)),
      trackMoodInBackground(processedText).catch(err => console.error('[Telegram] Mood tracking error:', err.message)),
    ]);
    return;
  }

  // Tool Loop (Proactive Tool Engagement)
  let finalResponse = '';
  const maxToolIterations = 5;
  let iteration = 0;

  // Optimization: Hoist getFullPrompt outside the loop to avoid redundant DB queries
  // and expensive semantic re-ranking during multi-step tool calls.
  const systemPrompt = await getFullPrompt(processedText);

  while (iteration < maxToolIterations) {
    iteration++;
    
    const message = await generateResponse(systemPrompt, messages);

    messages.push(message);

    await supabase.from('episodic_memory').insert({
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.tool_calls || null,
    }).then(({ error }) => { if (error) console.error('[Episodic] insert error:', error.message); });

    if (!message.tool_calls || message.tool_calls.length === 0) {
      finalResponse = message.content;
      break;
    }

    for (const toolCall of message.tool_calls) {
      const { name, arguments: argsString } = toolCall.function;
      let args;
      try {
        args = JSON.parse(argsString);
      } catch {
        args = {};
      }
      let result = '';

      console.log(`[Telegram] Executing tool: ${name}`, args);

      if (name === 'web_search') {
        result = await searchWeb(args.query);
      } else if (name === 'list_gmail') {
        result = await listMessages(args.query);
      } else if (name === 'read_gmail_content') {
        result = await getMessageContent(args.messageId);
      } else if (name === 'set_reminder') {
        const { error } = await supabase.from('reminders').insert({
          message: args.message,
          trigger_at: args.triggerAt,
          tier: 2,
          fired: false
        });
        result = error ? `Error: ${error.message}` : `Reminder set for ${args.triggerAt}`;
      } else if (name === 'add_task') {
        const { error } = await supabase.from('tasks').insert({
          title: args.title,
          priority: args.priority || 3,
          deadline: args.deadline || null,
          status: 'open'
        });
        if (!error) {
          // Log task history
          await supabase.from('task_history').insert({
            task_id: null, // We don't have the id from insert without select
            action: 'created',
            new_value: { title: args.title, priority: args.priority },
          }).catch(() => {});
        }
        result = error ? `Error: ${error.message}` : `Task "${args.title}" added successfully.`;
      } else {
        result = 'Unknown tool: ' + name;
      }

      const toolResultMessage = {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: name,
        content: result,
      };
      messages.push(toolResultMessage);

      await supabase.from('episodic_memory').insert(toolResultMessage)
        .then(({ error }) => { if (error) console.error('[Episodic] tool result insert error:', error.message); });
    }
  }

  // Finalize and Reply
  if (finalResponse) {
    const safeResponse = sanitizeAssistantReply(finalResponse, messages, processedText, lastAssistantText);
    await sendMessage(chatId, safeResponse);

    const isShort = processedText.length < 15 && !processedText.match(/remind|task|deadline|schedule|set|save/i);
    
    await Promise.all([
      isShort ? Promise.resolve() : processExchange(processedText, safeResponse).then(summary => {
        const summaryText = formatSummary(summary);
        if (summaryText.trim()) return sendMessage(chatId, summaryText);
      }).catch(err => console.error('[Telegram] Post-processor error:', err.message)),
      trackEntitiesInBackground(processedText).catch(err => console.error('[Telegram] Entity tracking error:', err.message)),
      trackMoodInBackground(processedText).catch(err => console.error('[Telegram] Mood tracking error:', err.message)),
    ]);
  }
}
