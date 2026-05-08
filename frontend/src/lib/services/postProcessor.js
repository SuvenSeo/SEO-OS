import supabase from '../config/supabase.js';
import { generateStructuredExtraction } from './groq.js';

const ACTIONABLE_PATTERNS = [
  /\b(remind me|set (a )?reminder|reminder)\b/i,
  /\b(i need to|i have to|i must|todo|to-do|task|deadline|due)\b/i,
  /\b(by \d{1,2}(:\d{2})?\s?(am|pm)|tomorrow|today|next week|this week)\b/i,
  /\b(idea|brainstorm|note this|remember this|save this)\b/i,
  /\b(clear|delete|remove|reset|start fresh|wipe)\b/i,
];

function isActionableUserMessage(message = '') {
  const text = (message || '').trim();
  if (!text || text.startsWith('/')) return false;
  return ACTIONABLE_PATTERNS.some((pattern) => pattern.test(text));
}

function parseCleanupIntent(message = '') {
  const text = (message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return { clearTasks: false, clearReminders: false, clearSingleReminder: false };

  const clearAll = /(reset (everything|all)|clear everything|wipe everything|start fresh)/i.test(text);
  const clearTasks = clearAll || /(clear|delete|remove).*(all )?(tasks|task list)/i.test(text);
  const clearRemindersAll = clearAll || /(clear|delete|remove).*(all )?(reminders|reminder list)/i.test(text);
  const clearSingleReminder = !clearAll && !clearRemindersAll && /(remove|delete|clear|cancel).*(that|this) reminder/i.test(text);

  return {
    clearTasks,
    clearReminders: clearRemindersAll || clearSingleReminder,
    clearSingleReminder,
  };
}

async function applyCleanupIntent(intent) {
  const summary = { cleared_tasks: 0, cleared_reminders: 0 };

  if (intent.clearTasks) {
    const { count } = await supabase
      .from('tasks')
      .delete({ count: 'exact' })
      .in('status', ['open', 'snoozed']);
    summary.cleared_tasks = count || 0;
  }

  if (intent.clearReminders) {
    if (intent.clearSingleReminder) {
      const { data: nextReminder } = await supabase
        .from('reminders')
        .select('id')
        .eq('fired', false)
        .order('trigger_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextReminder?.id) {
        const { count } = await supabase
          .from('reminders')
          .delete({ count: 'exact' })
          .eq('id', nextReminder.id);
        summary.cleared_reminders = count || 0;
      }
    } else {
      const { count } = await supabase
        .from('reminders')
        .delete({ count: 'exact' })
        .eq('fired', false);
      summary.cleared_reminders = count || 0;
    }
  }

  return summary;
}

function normalizeReminderMessage(message = '') {
  return (message || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Post-process an AI conversation exchange.
 * Detects tasks, reminders, ideas, and memory updates.
 * Auto-inserts detected items into the database.
 *
 * @param {string} userMessage - What the user said
 * @param {string} aiResponse - What the AI responded
 * @returns {Promise<object>} Summary of what was detected and created
 */
export async function processExchange(userMessage, aiResponse) {
  const cleanupIntent = parseCleanupIntent(userMessage);
  const shouldExtract = isActionableUserMessage(userMessage);

  const summary = {
    tasks: 0,
    reminders: 0,
    ideas: 0,
    memory_updates: 0,
    snoozed: 0,
    cleared_tasks: 0,
    cleared_reminders: 0,
    patterns: 0,
  };

  if (cleanupIntent.clearTasks || cleanupIntent.clearReminders) {
    const cleanupSummary = await applyCleanupIntent(cleanupIntent);
    summary.cleared_tasks = cleanupSummary.cleared_tasks;
    summary.cleared_reminders = cleanupSummary.cleared_reminders;
  }

  if (!shouldExtract) {
    return summary;
  }

  const extractionPrompt = `Analyze this conversation exchange and extract any actionable items.

USER MESSAGE: "${userMessage}"

AI RESPONSE: "${aiResponse}"

Extract the following as JSON:
{
  "tasks": [
    {
      "title": "short title",
      "description": "details if any",
      "deadline": "ISO date string or null",
      "priority": 3,
      "tier": 1|2|3|4,
      "tier_reason": "one line reason for this tier"
    }
  ],
  "reminders": [
    {
      "message": "reminder text",
      "trigger_at": "ISO date string",
      "tier": 1|2|3,
      "tier_reason": "one line reason for this tier"
    }
  ],
  "ideas": [
    {
      "content": "the idea"
    }
  ],
  "memory_updates": [
    {
      "key": "memory key",
      "value": "memory value",
      "type": "core|working"
    }
  ],
  "snooze_requests": [
    {
      "target": "what task or reminder to snooze (brief description)",
      "snooze_until": "ISO date string for when to re-surface it",
      "duration_description": "e.g. '2 hours', 'tomorrow morning'"
    }
  ],
  "patterns": [
    {
      "observation": "detailed observation of a habit, pattern, or connection",
      "confidence": "high|medium|low",
      "category": "productivity|work|personal|uni"
    }
  ]
}

Urgency Tier Classification (USE YOUR JUDGMENT):
- Tier 1 (Critical): Time-locked today/tomorrow. Urgent, specific time mentioned, or high-stakes (exams, meetings, strict deadlines).
- Tier 2 (Important): Day-level task. Important work/uni projects that need focus today but lack a specific hour-lock.
- Tier 3 (General): Vague or future-dated tasks. Things for "tomorrow", "this week", or general "to-do" items.
- Tier 4 (Soft): No real deadline. Exploration, "someday", "maybe", "could be cool". (Classify these as ideas).

Rules:
- Extract items ONLY from USER MESSAGE. AI RESPONSE is context, not a source of new commitments.
- Never create tasks/reminders from assistant coaching, motivational language, or follow-up prompts.
- Do NOT use keyword matching. Use the meaning and context of the conversation to decide the tier.
- Provide a concise "tier_reason" for every task and reminder explaining your classification.
- Only extract items that were explicitly mentioned or clearly implied.
- For tasks: look for action items, things to do, commitments made.
- For reminders: look for specific times mentioned ("remind me at...", "tomorrow at...").
- For ideas: look for brainstorming, "what if", project ideas, things to explore.
- For patterns: look for behavioral loops (procrastination triggers), project connections (e.g. Ardeno design for FullTank), or repeating habits. Only extract if evidenced in this specific exchange.
- For memory updates: look for new facts about the user (preferences, decisions, updates).
- Deadlines should be in ISO 8601 format. Use current date context: ${new Date().toISOString()}
- If nothing was detected for a category, return an empty array.
- Snooze detection: if the user says "remind me in X hours/days", "not now", "snooze", "later today", "tomorrow morning", "remind me again" — detect it as a snooze_request with snooze_until set to the appropriate future ISO time.

Return ONLY valid JSON.`;

  try {
    const raw = await generateStructuredExtraction(extractionPrompt);

    let extracted;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extracted = JSON.parse(cleaned);
    } catch (parseError) {
      console.warn('[PostProcessor] Failed to parse extraction:', parseError.message);
      return summary;
    }

    // Insert detected tasks — skip duplicates (same title already open)
    if (extracted.tasks && extracted.tasks.length > 0) {
      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('title')
        .in('status', ['open', 'snoozed']);

      const existingTitles = new Set(
        (existingTasks || []).map(t => t.title.toLowerCase().trim())
      );

      for (const task of extracted.tasks) {
        if (!task?.title?.trim()) continue;
        if (existingTitles.has(task.title.toLowerCase().trim())) continue;
        const { error } = await supabase.from('tasks').insert({
          title: task.title,
          description: task.description || null,
          deadline: task.deadline || null,
          priority: task.priority || 3,
          status: 'open',
          source: 'auto-detected',
          tier: task.tier || 3,
          tier_reason: task.tier_reason || null,
        });
        if (!error) summary.tasks++;
      }
    }

    // Insert detected reminders
    if (extracted.reminders && extracted.reminders.length > 0) {
      const { data: existingReminders } = await supabase
        .from('reminders')
        .select('message, trigger_at')
        .eq('fired', false)
        .gte('trigger_at', new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString());

      const reminderFingerprints = new Set(
        (existingReminders || []).map((r) => {
          const ts = new Date(r.trigger_at).getTime();
          return `${normalizeReminderMessage(r.message)}|${Number.isNaN(ts) ? 0 : ts}`;
        })
      );

      for (const reminder of extracted.reminders) {
        if (!reminder.trigger_at) continue;
        const triggerAtMs = new Date(reminder.trigger_at).getTime();
        if (Number.isNaN(triggerAtMs)) continue;
        const normalizedMessage = normalizeReminderMessage(reminder.message);
        const exactKey = `${normalizedMessage}|${triggerAtMs}`;
        const nearDuplicate = [...reminderFingerprints].some((fp) => {
          const [msg, tsRaw] = fp.split('|');
          const ts = Number(tsRaw);
          return msg === normalizedMessage && Math.abs(ts - triggerAtMs) <= (15 * 60 * 1000);
        });
        if (nearDuplicate) continue;

        const { error } = await supabase.from('reminders').insert({
          message: reminder.message,
          trigger_at: reminder.trigger_at,
          tier: reminder.tier || 3,
          tier_reason: reminder.tier_reason || null,
          fired: false,
        });
        if (!error) {
          reminderFingerprints.add(exactKey);
          summary.reminders++;
        }
      }
    }

    // Insert detected ideas
    if (extracted.ideas && extracted.ideas.length > 0) {
      for (const idea of extracted.ideas) {
        const { error } = await supabase.from('ideas').insert({
          content: idea.content,
          status: 'raw',
        });
        if (!error) summary.ideas++;
      }
    }

    // Process memory updates
    if (extracted.memory_updates && extracted.memory_updates.length > 0) {
      for (const mem of extracted.memory_updates) {
        if (!mem?.key || !mem?.value) continue;
        if (mem.type === 'core') {
          const { error } = await supabase
            .from('core_memory')
            .upsert(
              { key: mem.key, value: mem.value, updated_at: new Date().toISOString() },
              { onConflict: 'key' }
            );
          if (!error) summary.memory_updates++;
        } else if (mem.type === 'working') {
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await supabase.from('working_memory').delete().eq('key', mem.key);
          const { error } = await supabase.from('working_memory').insert({
            key: mem.key,
            value: mem.value,
            expires_at: expiresAt,
          });
          if (!error) summary.memory_updates++;
        }
      }
    }

    // Handle snooze requests
    if (extracted.snooze_requests && extracted.snooze_requests.length > 0) {
      for (const snooze of extracted.snooze_requests) {
        if (!snooze.snooze_until) continue;
        const { error } = await supabase.from('reminders').insert({
          message: `Snoozed: ${snooze.target}`,
          trigger_at: snooze.snooze_until,
          tier: 2,
          tier_reason: `Snoozed by user — resurface ${snooze.duration_description}`,
          fired: false,
        });
        if (!error) summary.snoozed++;
      }
    }

    // Insert detected patterns
    if (extracted.patterns && extracted.patterns.length > 0) {
      for (const pattern of extracted.patterns) {
        if (!pattern.observation) continue;
        const { error } = await supabase.from('patterns').insert({
          observation: pattern.observation,
          confidence: pattern.confidence || 'medium',
          category: pattern.category || 'general',
        });
        if (!error) summary.patterns++;
      }
    }

    return summary;
  } catch (error) {
    console.error('[PostProcessor] Error:', error.message);
    return summary;
  }
}

/**
 * Format the post-processing summary for display.
 */
export function formatSummary(summary) {
  const parts = [];
  if (summary.cleared_tasks > 0) parts.push(`🗑️ ${summary.cleared_tasks} task(s) cleared`);
  if (summary.cleared_reminders > 0) parts.push(`🧹 ${summary.cleared_reminders} reminder(s) removed`);
  if (summary.tasks > 0) parts.push(`📋 ${summary.tasks} task(s) logged`);
  if (summary.reminders > 0) parts.push(`⏰ ${summary.reminders} reminder(s) set`);
  if (summary.snoozed > 0) parts.push(`😴 ${summary.snoozed} snoozed`);
  if (summary.ideas > 0) parts.push(`💡 ${summary.ideas} idea(s) captured`);
  if (summary.patterns > 0) parts.push(`📊 ${summary.patterns} pattern(s) detected`);
  if (summary.memory_updates > 0) parts.push(`🧠 ${summary.memory_updates} memory update(s)`);

  if (parts.length === 0) return '';
  return '\n\n_' + parts.join(' · ') + '_';
}
