import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { generateResponse, generateStructuredExtraction } from '@/lib/services/groq';
import { sendMessage } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';
import { listMessages, getMessageContent, listMessagesRaw } from '@/lib/services/gmail';

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CRON_SECRET = process.env.CRON_SECRET;

/** Max episodic_memory rows to keep (oldest removed by daily cron). */
const EPISODIC_MEMORY_RETENTION = 500;
const EPISODIC_SUMMARY_BATCH = 120;
const EPISODIC_CORE_MEMORY_KEY = 'episodic_consolidated_summary';
const EPISODIC_FACTS_MEMORY_KEY = 'episodic_consolidated_facts';
const EPISODIC_CORE_MEMORY_MAX_CHARS = 12000;
const IDLE_SUMMARY_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const SESSION_BREAK_MS = 90 * 60 * 1000;
const DEADLINE_CLUSTER_COOLDOWN_HOURS = 10;
const OVERCOMMIT_COOLDOWN_HOURS = 10;
const DEADLINE_CLUSTER_KEY = 'insight_deadline_cluster_sent_until';
const OVERCOMMIT_KEY = 'insight_overcommit_sent_until';
const IDLE_SUMMARY_CURSOR_KEY = 'idle_summary_last_message_at';
const GOOGLE_CALENDAR_TOKEN = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN || '';
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

export async function fetchImportantEmails() {
  try {
    return await listMessagesRaw('is:unread category:primary newer_than:3d', 8);
  } catch (error) {
    console.error('[Proactive] fetchImportantEmails error:', error.message);
    return [];
  }
}

// RESTORED HELPERS
function getFollowUpQuestion(tier) {
  switch (tier) {
    case 1: return "This is critical. Is it handled?";
    case 2: return "Checking in on this. Any progress?";
    default: return "Still on the list?";
  }
}

function isMetaAutoTask(task) {
  return task.tags?.includes('auto') || task.title?.includes('[Auto]');
}

function shouldNotifyTask(task, now, isWaking) {
  if (!isWaking) return false;
  const last = task.last_notified_at ? new Date(task.last_notified_at) : new Date(task.created_at);
  const diffHours = (now - last) / (1000 * 60 * 60);
  const interval = task.tier === 1 ? 4 : task.tier === 2 ? 24 : 48;
  return diffHours >= interval;
}

async function extractEmailActionItems(emails) { return []; }
async function createTasksFromEmailActions(items) { return 0; }

export async function GET(request) {
  const auth = resolveCronAuth(request);
  if (!auth.ok) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Proactive] 401:', auth.reason);
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'morning-brief':
        await triggerMorningBrief();
        return NextResponse.json({ ok: true, action: 'morning-brief' });

      case 'evening-checkin':
        await triggerEveningCheckin();
        return NextResponse.json({ ok: true, action: 'evening-checkin' });

      case 'weekly-review':
        await triggerWeeklyReview();
        return NextResponse.json({ ok: true, action: 'weekly-review' });

      case 'email-digest':
        await triggerEmailDigest();
        return NextResponse.json({ ok: true, action: 'email-digest' });

      case 'memory-prune':
        return NextResponse.json({
          ok: true,
          action: 'memory-prune',
          ...(await consolidateAndPruneEpisodicMemory()),
        });

      case 'reminder-check':
      default:
        // Default action: check reminders + task follow-ups
        const result = await checkRemindersAndTasks();
        return NextResponse.json({ ok: true, action: 'reminder-check', ...result });
    }
  } catch (error) {
    console.error(`[Proactive] ${action || 'reminder-check'} error:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── Morning Brief ──────────────────────────────────────────────────────────
async function triggerMorningBrief() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [{ data: tasks }, { data: patterns }, { data: todayReminders }, todayEvents] = await Promise.all([
    supabase.from('tasks').select('*').eq('status', 'open').order('priority'),
    supabase.from('patterns').select('*').order('created_at', { ascending: false }).limit(3),
    supabase.from('reminders').select('*').eq('fired', false)
      .gte('trigger_at', today.toISOString()).lte('trigger_at', tomorrow.toISOString()),
    fetchTodayCalendarEvents(today, tomorrow),
  ]);

  const allTasks = tasks || [];
  const dueToday = allTasks.filter(t => t.deadline && new Date(t.deadline) >= today && new Date(t.deadline) < tomorrow);
  const overdue = allTasks.filter(t => t.deadline && new Date(t.deadline) < today);

  const systemPrompt = await getFullPrompt('morning brief');
  const briefPrompt = `Generate a morning brief for Suven. Be concise and direct.

TODAY'S DEADLINES:
${dueToday.length > 0 ? dueToday.map(t => `→ ${t.title} [P${t.priority}]`).join('\n') : '→ No deadlines today'}

${overdue.length > 0 ? `OVERDUE:\n${overdue.map(t => `→ ${t.title} [P${t.priority}] — ${t.follow_up_count}x followed up`).join('\n')}\n` : ''}
OPEN (${allTasks.length} total):
${allTasks.slice(0, 8).map(t => `→ P${t.priority}: ${t.title}`).join('\n')}

${(patterns || []).length > 0 ? `PATTERNS:\n${patterns.map(p => `→ [${p.confidence}] ${p.observation}`).join('\n')}\n` : ''}
${(todayReminders || []).length > 0 ? `REMINDERS TODAY:\n${todayReminders.map(r => `→ ${r.message}`).join('\n')}\n` : ''}
${todayEvents.length > 0 ? `CALENDAR TODAY:\n${todayEvents.map(e => `→ ${e.start}: ${e.summary}`).join('\n')}\n` : ''}
End with one direct question about today's priority.`;

  const brief = await generateResponse(systemPrompt, [{ role: 'user', content: briefPrompt }], {
    temperature: 0.5, max_tokens: 1024,
  });

  await sendMessage(CHAT_ID, brief, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Acknowledge', callback_data: 'brief_ack' },
          { text: '⏳ Remind in 1h', callback_data: 'reminder_snooze:morning_brief:1' },
        ],
      ],
    },
  });

  // Set nudge flags
  const nudgeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const flagExpiry = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  await Promise.all([
    supabase.from('working_memory').upsert(
      { key: 'morning_brief_replied', value: 'false', expires_at: flagExpiry },
      { onConflict: 'key' }
    ),
    supabase.from('working_memory').upsert(
      { key: 'morning_brief_nudge_at', value: nudgeAt, expires_at: flagExpiry },
      { onConflict: 'key' }
    ),
  ]);
}

// ─── Evening Check-in ───────────────────────────────────────────────────────
async function triggerEveningCheckin() {
  const { data: tasks } = await supabase.from('tasks').select('title, status, follow_up_count')
    .eq('status', 'open').order('priority').limit(5);

  const taskList = (tasks || []).map(t => `→ ${t.title}`).join('\n');
  await sendMessage(CHAT_ID,
    `What did you get done today, Suven? Any updates?\n\nStill open:\n${taskList || '(none)'}`
  );
}

// ─── Reminder & Task Check ──────────────────────────────────────────────────
async function checkRemindersAndTasks() {
  const now = new Date();
  let fired = 0;

  // Get IST hour + waking hours config
  const istHour = parseInt(
    now.toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false }), 10
  );

  const { data: configRows } = await supabase.from('agent_config')
    .select('key, value').in('key', ['waking_hours_start', 'waking_hours_end']);
  const cfg = Object.fromEntries((configRows || []).map(r => [r.key, parseInt(r.value, 10)]));
  const wakingStart = cfg['waking_hours_start'] ?? 8;
  const wakingEnd = cfg['waking_hours_end'] ?? 22;
  const isWaking = istHour >= wakingStart && istHour <= wakingEnd;

  // 1. Morning brief nudge
  const { data: wmRows } = await supabase.from('working_memory')
    .select('key, value').in('key', ['morning_brief_replied', 'morning_brief_nudge_at'])
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);

  const wm = Object.fromEntries((wmRows || []).map(r => [r.key, r.value]));
  if (isWaking && wm['morning_brief_nudge_at'] && new Date(wm['morning_brief_nudge_at']) <= now && wm['morning_brief_replied'] !== 'true') {
    await sendMessage(CHAT_ID, `👋 You haven't responded to the morning brief yet, Suven. What's the plan today?`);
    await supabase.from('working_memory').delete().eq('key', 'morning_brief_nudge_at');
    fired++;
  }

  // 2. Fire due reminders
  const { data: reminders } = await supabase.from('reminders')
    .select('*').eq('fired', false).lte('trigger_at', now.toISOString());

  for (const r of (reminders || [])) {
    const { data: claimedReminder, error: claimError } = await supabase
      .from('reminders')
      .update({ fired: true, last_notified_at: now.toISOString() })
      .eq('id', r.id)
      .eq('fired', false)
      .select('id, message, tier')
      .maybeSingle();

    if (claimError) {
      console.error('[Proactive] reminder claim failed:', claimError.message);
      throw claimError;
    }
    if (!claimedReminder) continue;

    const followUp = getFollowUpQuestion(claimedReminder.tier);
    await sendMessage(CHAT_ID, `⏰ *REMINDER (Tier ${claimedReminder.tier})*\n\n${claimedReminder.message}\n\n_${followUp}_`, {
      reply_markup: buildReminderActionKeyboard(r.id),
    });
    fired++;
  }

  // 3. Smart-frequency task pings
  const { data: openTasks } = await supabase.from('tasks')
    .select('*').eq('status', 'open').neq('tier', 4);
  const actionableOpenTasks = (openTasks || []).filter((task) => !isMetaAutoTask(task));

  for (const t of actionableOpenTasks) {
    if (shouldNotifyTask(t, now, isWaking)) {
      const followUp = getFollowUpQuestion(t.tier);
      let msg = `📋 *TASK FOLLOW-UP (Tier ${t.tier})*\n\n*${t.title}*`;
      if (t.deadline) {
        msg += `\nDue: ${new Date(t.deadline).toLocaleString('en-US', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
      }
      msg += `\n\n_${followUp}_`;
      await sendMessage(CHAT_ID, msg, {
        reply_markup: buildTaskActionKeyboard(t.id),
      });
      await supabase.from('tasks').update({
        last_notified_at: now.toISOString(),
        follow_up_count: (t.follow_up_count || 0) + 1,
      }).eq('id', t.id);
      fired++;
    }
  }

  // 4. Accountability — overdue tasks with escalating tone
  const { data: overdue } = await supabase.from('tasks').select('*')
      .eq('status', 'open').not('deadline', 'is', null).lte('deadline', now.toISOString());

  if (isWaking) {
    for (const t of (overdue || [])) {
      if (isMetaAutoTask(t)) continue;
      const daysLate = Math.ceil((now - new Date(t.deadline)) / (1000 * 60 * 60 * 24));
      const followUps = (t.follow_up_count || 0);

      // Only escalate every 4+ hours
      const lastNotified = t.last_notified_at ? new Date(t.last_notified_at) : new Date(t.created_at);
      if ((now - lastNotified) < 4 * 60 * 60 * 1000) continue;

      let tone = followUps < 2
        ? `Task "${t.title}" is ${daysLate}d overdue. Status?`
        : `You've avoided "${t.title}" for ${daysLate} days (${followUps}x followed up). What's actually blocking this?`;

      await sendMessage(CHAT_ID, `⚠️ *ACCOUNTABILITY*\n\n${tone}`, {
        reply_markup: buildTaskActionKeyboard(t.id),
      });
      await supabase.from('tasks').update({
        follow_up_count: followUps + 1,
        last_notified_at: now.toISOString(),
      }).eq('id', t.id);
      fired++;
    }
  }

  // 5. Proactive insight engine (deadline clusters + overcommit detection)
  if (isWaking) {
    fired += await maybeSendProactiveInsights(now, actionableOpenTasks);
  }

  // 6. Idle-session consolidation (2h+ inactivity)
  fired += await maybeSummarizeIdleConversation(now);

  return { fired, taskFollowupsSkipped: isWaking ? 0 : actionableOpenTasks.length };
}
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
    emails.push({
      id: msg.id,
      from,
      subject,
      snippet: payload.snippet || '',
    });
  }

  return emails;
}

async function extractEmailActionItems(emails) {
  if (emails.length === 0) return [];
  const payload = emails
    .map((e, idx) => `${idx + 1}. Subject: ${e.subject}\nFrom: ${e.from}\nSnippet: ${e.snippet}`)
    .join('\n\n');

  const raw = await generateStructuredExtraction(`Extract action items from these emails.
Return JSON:
{
  "action_items": [
    { "title": "short action", "description": "details", "priority": 1-5 }
  ]
}
Only include concrete actions.

EMAILS:
${payload}`);

  try {
    const parsed = JSON.parse((raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    return Array.isArray(parsed.action_items) ? parsed.action_items : [];
  } catch {
    return [];
  }
}

async function createTasksFromEmailActions(items) {
  if (!items.length) return 0;

  const { data: existing } = await supabase.from('tasks').select('title').in('status', ['open', 'snoozed']);
  const existingTitles = new Set((existing || []).map(t => t.title.toLowerCase().trim()));

  let created = 0;
  for (const item of items) {
    const title = (item.title || '').trim();
    if (!title) continue;
    const id = title.toLowerCase();
    if (existingTitles.has(id)) continue;

    const { error } = await supabase.from('tasks').insert({
      title,
      description: item.description || 'Auto-created from email digest',
      priority: Number(item.priority) >= 1 && Number(item.priority) <= 5 ? Number(item.priority) : 3,
      status: 'open',
      source: 'auto-detected',
      tier: 2,
      tier_reason: 'Extracted from important unread email',
    });
    if (!error) {
      created++;
      existingTitles.add(id);
    }
  }
  return created;
}

async function pruneEpisodicMemory() {
  const { data, error } = await supabase.rpc('prune_episodic_memory', {
    p_keep: EPISODIC_MEMORY_RETENTION,
  });
  if (error) {
    console.error('[Proactive] pruneEpisodicMemory:', error.message);
    throw error;
  }
  const deleted = typeof data === 'number' ? data : Number(data) || 0;
  return { deleted };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function getFollowUpQuestion(tier) {
  switch (tier) {
    case 1: return "Have you started? How much is left?";
    case 2: return "Any progress on this?";
    case 3: return "Still on your radar?";
    default: return "Any updates?";
  }
}

function shouldNotifyTask(task, now, isWaking) {
  if (!isWaking) return false;
  const lastNotified = task.last_notified_at ? new Date(task.last_notified_at) : new Date(task.created_at);
  const diffMs = now - lastNotified;
  const diffMins = diffMs / (1000 * 60);
  const diffHours = diffMs / (1000 * 60 * 60);

  if (task.tier === 1) {
    if (!task.deadline) return diffHours >= 3;
    const minsToDeadline = (new Date(task.deadline) - now) / (1000 * 60);
    if (minsToDeadline > 0) {
      if (minsToDeadline <= 30) return diffMins >= 30;
      if (minsToDeadline <= 60) return diffMins >= 60;
      if (minsToDeadline <= 180) return diffMins >= 180;
      return diffHours >= 6;
    }
    return diffHours >= 3; // Overdue Tier 1
  }
  if (task.tier === 2) return diffHours >= 6;
  if (task.tier === 3) return diffHours >= 12;
  return false;
}

function isMetaAutoTask(task) {
  const title = (task?.title || '').toLowerCase();
  if (!title) return true;
  if (task?.source !== 'auto-detected') return false;
  return /(identify top priority|review open tasks|provide a specific task|prioritize tasks|delete tasks)/i.test(title);
}
