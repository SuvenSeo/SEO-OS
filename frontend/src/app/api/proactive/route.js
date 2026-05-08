import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import supabase from '@/lib/config/supabase';
import { requireCronAuth } from '@/lib/middleware/auth';
import { listMessagesRaw } from '@/lib/services/gmail';
import { generateStructuredExtraction, generateResponse } from '@/lib/services/groq';

const CHAT_ID = '725902251'; // Suven's Telegram ID
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const EPISODIC_MEMORY_RETENTION = 50; // Keep last 50 episodic memories

/**
 * Main cron handler for proactive autonomous actions.
 * Runs via GitHub Actions (not Vercel cron).
 */
export async function GET(req) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  // Idempotency guard — skip if last run was < 5 minutes ago
  const { data: lastRun } = await supabase
    .from('working_memory')
    .select('value')
    .eq('key', 'proactive_last_run')
    .maybeSingle();
  if (lastRun?.value) {
    const elapsed = Date.now() - new Date(lastRun.value).getTime();
    if (elapsed < 5 * 60 * 1000) {
      return NextResponse.json({ success: true, skipped: true, reason: 'Ran within last 5 minutes' });
    }
  }
  await supabase.from('working_memory').upsert(
    { key: 'proactive_last_run', value: new Date().toISOString() },
    { onConflict: 'key' }
  );

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
      repeatingReminders: 0,
      idleProjects: 0,
      focusExpired: false,
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

    // Monthly Goal Progress (1st of month, 09:00 IST)
    if (istDate.getDate() === 1 && hour === 9 && minute < 15) {
      await triggerMonthlyGoalProgress();
    }

    // 3. Constant Background Routines
    // - Every hour: Email Action-Item Digest
    if (minute < 10) {
      const emailCount = await triggerEmailDigest();
      results.emailDigest = `Processed. Created ${emailCount} tasks.`;
    }

    // - Every run: Check due reminders and escalations
    results.remindersAndTasks = await checkRemindersAndTasks();

    // - Every run: Process repeating reminders
    results.repeatingReminders = await processRepeatingReminders();

    // - Every run: Consolidate/Prune episodic memory
    results.memoryPruned = await pruneEpisodicMemory();

    // - Every run: Check focus mode expiry
    results.focusExpired = await checkFocusExpiry();

    // - Hourly: Check idle projects
    if (minute < 10) {
      results.idleProjects = await checkIdleProjects();
    }

    // - Every run: Store notification for proactive messages
    await supabase.from('notifications').insert({
      type: 'proactive',
      title: 'Proactive tick',
      content: `Ran at ${istTime}. Reminders fired: ${results.remindersAndTasks || 0}`,
    }).then(({ error }) => { if (error) console.error('[Proactive] Notification insert error:', error.message); });

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
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [completedRes, createdRes, patternsRes, moodRes] = await Promise.all([
    supabase.from('tasks').select('title').eq('status', 'done').gte('updated_at', weekAgo),
    supabase.from('tasks').select('title').gte('created_at', weekAgo),
    supabase.from('patterns').select('observation, confidence').gte('created_at', weekAgo).order('created_at', { ascending: false }).limit(5),
    supabase.from('mood_log').select('mood, intensity').gte('created_at', weekAgo),
  ]);

  const completed = completedRes.data || [];
  const created = createdRes.data || [];
  const patterns = patternsRes.data || [];
  const moods = moodRes.data || [];

  const completedTitles = completed.map(t => `→ ${t.title}`).join('\n') || '(none)';
  const patternList = patterns.map(p => `→ ${p.observation}`).join('\n') || '(none detected)';
  const moodSummary = moods.length > 0
    ? `${moods.filter(m => m.mood === 'positive').length} positive, ${moods.filter(m => m.mood === 'stressed' || m.mood === 'frustrated').length} stressed`
    : 'No mood data';

  const momentum = completed.length > 0
    ? Math.round((completed.length / (completed.length + (created.length - completed.length))) * 100)
    : 0;

  const message = `📊 *Weekly Review*\n\n` +
    `*Tasks Completed:* ${completed.length}\n${completedTitles}\n\n` +
    `*Tasks Created:* ${created.length}\n` +
    `*Momentum Score:* ${momentum}%\n` +
    `*Mood This Week:* ${moodSummary}\n\n` +
    `*Patterns Detected:*\n${patternList}\n\n` +
    `_What should we focus on next week?_`;

  await sendMessage(CHAT_ID, message);

  // Save to weekly_reviews table
  const { error } = await supabase.from('weekly_reviews').insert({
    tasks_completed: completed.length,
    tasks_created: created.length,
    momentum_score: momentum,
    patterns_summary: patternList,
    mood_summary: moodSummary,
  });
  if (error) console.error('[Proactive] weekly_reviews insert error:', error.message);
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
      const followUp = getFollowUpQuestionEnhanced(t.tier, t.follow_up_count || 0);
      await sendMessage(CHAT_ID, `📋 *TASK FOLLOW-UP (Tier ${t.tier})*\n\n*${t.title}*\n\n_${followUp}_`, {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Done', callback_data: `task_done:${t.id}` },
            { text: '⏳ 1h', callback_data: `task_snooze:${t.id}:1` },
            { text: '⏳ 3h', callback_data: `task_snooze:${t.id}:3` },
            { text: '📅 Tomorrow', callback_data: `task_snooze:${t.id}:24` },
          ]]
        }
      });
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

// ─── New Proactive Features ─────────────────────────────────────────────────

/**
 * Process repeating reminders — when a repeating reminder fires,
 * create the next occurrence based on repeat_interval.
 */
async function processRepeatingReminders() {
  const { data: firedRepeating, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('fired', true)
    .not('repeat_interval', 'is', null);

  if (error || !firedRepeating?.length) return 0;
  let created = 0;

  for (const r of firedRepeating) {
    const lastTrigger = new Date(r.trigger_at);
    let nextTrigger;

    switch (r.repeat_interval) {
      case 'daily':
        nextTrigger = new Date(lastTrigger.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        nextTrigger = new Date(lastTrigger.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        nextTrigger = new Date(lastTrigger);
        nextTrigger.setMonth(nextTrigger.getMonth() + 1);
        break;
      default:
        continue;
    }

    const { error: insertErr } = await supabase.from('reminders').insert({
      message: r.message,
      trigger_at: nextTrigger.toISOString(),
      tier: r.tier,
      tier_reason: `Repeating (${r.repeat_interval})`,
      fired: false,
      repeat_interval: r.repeat_interval,
      repeat_cron: r.repeat_cron,
    });
    if (!insertErr) {
      created++;
      // Clear repeat_interval from the fired copy so it doesn't regenerate again
      await supabase.from('reminders').update({ repeat_interval: null }).eq('id', r.id);
    }
  }
  return created;
}

/**
 * Check if focus mode has expired and notify user.
 */
async function checkFocusExpiry() {
  const { data: focus } = await supabase
    .from('working_memory')
    .select('value')
    .eq('key', 'focus_mode')
    .maybeSingle();

  if (!focus?.value) return false;
  const expiresAt = new Date(focus.value);
  if (expiresAt > new Date()) return false;

  await supabase.from('working_memory').delete().eq('key', 'focus_mode');
  await sendMessage(CHAT_ID, '🎯 *Focus mode ended.* How did the session go?');
  return true;
}

/**
 * Check for projects with no task activity in 14+ days.
 */
async function checkIdleProjects() {
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: projects } = await supabase
    .from('projects')
    .select('id, title')
    .eq('status', 'active');

  if (!projects?.length) return 0;

  let idle = 0;
  for (const project of projects) {
    const { data: recentTasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('project_id', project.id)
      .gte('updated_at', twoWeeksAgo)
      .limit(1);

    if (!recentTasks?.length) {
      idle++;
      await sendMessage(CHAT_ID, `💤 *Idle Project Detected:* "${project.title}" has had no activity in 2+ weeks. Still active?`, {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Still active', callback_data: `brief_ack` },
            { text: '📦 Archive it', callback_data: `task_done:${project.id}` },
          ]]
        }
      });
    }
  }
  return idle;
}

/**
 * Monthly goal progress report — runs on the 1st.
 */
async function triggerMonthlyGoalProgress() {
  const { data: goals } = await supabase
    .from('goals')
    .select('id, title, progress, target_date')
    .eq('status', 'active');

  if (!goals?.length) return;

  let msg = '📈 *Monthly Goal Progress*\n\n';
  for (const g of goals) {
    const bar = '█'.repeat(Math.round(g.progress / 10)) + '░'.repeat(10 - Math.round(g.progress / 10));
    msg += `→ *${g.title}* [${bar}] ${g.progress}%`;
    if (g.target_date) msg += ` _(target: ${new Date(g.target_date).toLocaleDateString()})_`;
    msg += '\n';
  }
  msg += '\n_Review your goals and adjust targets if needed._';

  await sendMessage(CHAT_ID, msg);
}

/**
 * Enhanced task follow-up — use psychologically aware messages for repeatedly snoozed tasks.
 */
function getFollowUpQuestionEnhanced(tier, followUpCount) {
  if (followUpCount >= 4) {
    return "You've avoided this multiple times now. What's the real blocker? Let's figure out the next tiny step together.";
  }
  if (followUpCount >= 3) {
    return "This keeps getting pushed. What's actually blocking you? Is it too big? Let me help break it down.";
  }
  switch (tier) {
    case 1: return "This is your top priority. Status?";
    case 2: return "Checking in on this. Any progress?";
    case 3: return "Is this still on your radar?";
    default: return "Any updates?";
  }
}
