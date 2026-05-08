import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import supabase from '@/lib/config/supabase';
import { listMessagesRaw } from '@/lib/services/gmail';
import { generateStructuredExtraction } from '@/lib/services/groq';

const CHAT_ID = '725902251'; // Suven's Telegram ID
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const EPISODIC_MEMORY_RETENTION = 50; // Keep last 50 episodic memories

/**
 * Main cron handler for proactive autonomous actions.
 * Runs on Vercel Cron (configured in vercel.json).
 */
export async function GET(req) {
  try {
    // 1. Resolve IST Time
    const now = new Date();
    const istTime = now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
    const istDate = new Date(istTime);
    const hour = istDate.getHours();
    const minute = istDate.getMinutes();
    const day = istDate.getDay(); // 0 = Sunday

    console.log(`[Proactive] Tick at ${istTime} (H:${hour} M:${minute})`);

    const results = {
      morningBrief: false,
      eveningCheckin: false,
      weeklyReview: false,
      emailDigest: false,
      remindersAndTasks: null,
      memoryPruned: false,
    };

    // 2. Schedule Specific Routines
    // Morning Brief (08:30 IST)
    if (hour === 8 && minute >= 30 && minute < 45) {
      await triggerMorningBrief();
      results.morningBrief = true;
    }

    // Evening Check-in (21:30 IST)
    if (hour === 21 && minute >= 30 && minute < 45) {
      await triggerEveningCheckin();
      results.eveningCheckin = true;
    }

    // Weekly Review (Sunday 22:00 IST)
    if (day === 0 && hour === 22 && minute >= 0 && minute < 15) {
      await triggerWeeklyReview();
      results.weeklyReview = true;
    }

    // 3. Constant Background Routines
    // - Every hour: Email Action-Item Digest
    if (minute < 10) {
      const emailCount = await triggerEmailDigest();
      results.emailDigest = `Processed. Created ${emailCount} tasks.`;
    }

    // - Every run: Check due reminders and escalations
    results.remindersAndTasks = await checkRemindersAndTasks();

    // - Every run: Consolidate/Prune episodic memory
    results.memoryPruned = await pruneEpisodicMemory();

    return NextResponse.json({
      success: true,
      timestamp: istTime,
      results
    });

  } catch (error) {
    console.error('[Proactive] Global Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ─── Core Routines ──────────────────────────────────────────────────────────

async function triggerMorningBrief() {
  const { data: tasks } = await supabase.from('tasks')
    .select('*')
    .eq('status', 'open')
    .order('priority', { ascending: true })
    .limit(10);

  const taskSummary = (tasks || []).map(t => `• ${t.title} (Tier ${t.tier})`).join('\n');
  const mit = tasks?.find(t => t.tier === 1) || tasks?.[0];

  const message = `☀️ *Good Morning, Suven.*\n\n` +
    `Your Chief of Staff is online. Here is your outlook for today:\n\n` +
    `🚀 *Most Important Task:* ${mit ? mit.title : 'None set yet. Pick one!'}\n\n` +
    `📋 *Open Tasks:*\n${taskSummary || 'No tasks on the horizon.'}\n\n` +
    `Would you like me to prioritize these or find some gaps in your schedule?`;

  await sendMessage(CHAT_ID, message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Acknowledge', callback_data: 'brief_ack' },
          { text: '⏳ Remind in 1h', callback_data: 'reminder_snooze:morning_brief:1' },
        ],
      ],
    },
  });

  await supabase.from('working_memory').upsert({
    key: 'last_morning_brief',
    value: new Date().toISOString()
  });
}

async function triggerEveningCheckin() {
  const { data: tasks } = await supabase.from('tasks')
    .select('title, status')
    .eq('status', 'open')
    .order('priority')
    .limit(5);

  const taskList = (tasks || []).map(t => `→ ${t.title}`).join('\n');
  const message = `🌙 *Evening Check-in, Suven.*\n\n` +
    `What did you get done today? Any wins?\n\n` +
    `*Still on your plate:*\n${taskList || '(All clear!)'}\n\n` +
    `I'll be here if you need to brain-dump for tomorrow.`;

  await sendMessage(CHAT_ID, message);
}

async function triggerWeeklyReview() {
  await sendMessage(CHAT_ID, `📊 *Weekly Review Ready.*\n\nYou've closed 0 tasks this week. Let's review the upcoming week.`);
}

async function triggerEmailDigest() {
  const emails = await listMessagesRaw('is:unread category:primary', 5);
  if (!emails || emails.length === 0) return 0;

  const items = await extractEmailActionItems(emails);
  return await createTasksFromEmailActions(items);
}

async function checkRemindersAndTasks() {
  const now = new Date();
  let fired = 0;

  const { data: reminders } = await supabase.from('reminders')
    .select('*')
    .eq('fired', false)
    .lte('trigger_at', now.toISOString());

  for (const r of (reminders || [])) {
    await supabase.from('reminders').update({ fired: true }).eq('id', r.id);
    await sendMessage(CHAT_ID, `⏰ *REMINDER*\n\n${r.message}`);
    fired++;
  }

  const { data: openTasks } = await supabase.from('tasks')
    .select('*')
    .eq('status', 'open');

  for (const t of (openTasks || [])) {
    if (shouldNotifyTask(t, now)) {
      const followUp = getFollowUpQuestion(t.tier);
      await sendMessage(CHAT_ID, `📋 *TASK FOLLOW-UP (Tier ${t.tier})*\n\n*${t.title}*\n\n_${followUp}_`);
      await supabase.from('tasks').update({
        last_notified_at: now.toISOString(),
        follow_up_count: (t.follow_up_count || 0) + 1,
      }).eq('id', t.id);
      fired++;
    }
  }

  return fired;
}

async function pruneEpisodicMemory() {
  try {
    const { data, error } = await supabase.rpc('prune_episodic_memory', {
      p_keep: EPISODIC_MEMORY_RETENTION,
    });
    return !error;
  } catch {
    return false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function sendMessage(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...extra,
    }),
  });
  return res.json();
}

async function extractEmailActionItems(emails) {
  const prompt = `Extract concrete action items for Suven from these emails. 
Return ONLY JSON: { "action_items": [{ "title": "short", "description": "details", "priority": 1-5 }] }
EMAILS:
${emails.map(e => `Subject: ${e.subject}\nSnippet: ${e.snippet}`).join('\n\n')}`;

  const raw = await generateStructuredExtraction(prompt);
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return parsed.action_items || [];
  } catch {
    return [];
  }
}

async function createTasksFromEmailActions(items) {
  let count = 0;
  for (const item of items) {
    const { error } = await supabase.from('tasks').insert({
      title: item.title,
      description: item.description,
      priority: item.priority || 3,
      status: 'open',
      source: 'auto-detected',
      tier: 2
    });
    if (!error) count++;
  }
  return count;
}

function getFollowUpQuestion(tier) {
  switch (tier) {
    case 1: return "This is your top priority. Status?";
    case 2: return "Checking in on this. Any progress?";
    case 3: return "Is this still on your radar?";
    default: return "Any updates?";
  }
}

function shouldNotifyTask(task, now) {
  const lastNotified = task.last_notified_at ? new Date(task.last_notified_at) : new Date(task.created_at);
  const hoursSince = (now - lastNotified) / (1000 * 60 * 60);

  if (task.tier === 1 && hoursSince >= 4) return true;
  if (task.tier === 2 && hoursSince >= 12) return true;
  if (task.tier === 3 && hoursSince >= 24) return true;
  return false;
}
