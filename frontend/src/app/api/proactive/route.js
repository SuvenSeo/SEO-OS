import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { generateResponse } from '@/lib/services/groq';
import { sendMessage } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CRON_SECRET = process.env.CRON_SECRET;

/** Max episodic_memory rows to keep (oldest removed by daily cron). */
const EPISODIC_MEMORY_RETENTION = 1500;

// Vercel: set CRON_SECRET in Production — platform sends Authorization: Bearer <CRON_SECRET>.
// Crons run on Production only. Hobby plan allows at most one cron invocation per day per job;
// sub-daily schedules (e.g. */5) require a paid plan — see https://vercel.com/docs/cron-jobs/usage-and-pricing
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Proactive] 401:', !CRON_SECRET ? 'missing CRON_SECRET env' : 'authorization mismatch');
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

      case 'memory-prune': {
        const { deleted } = await pruneEpisodicMemory();
        return NextResponse.json({ ok: true, action: 'memory-prune', deleted });
      }

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

  const [{ data: tasks }, { data: patterns }, { data: todayReminders }] = await Promise.all([
    supabase.from('tasks').select('*').eq('status', 'open').order('priority'),
    supabase.from('patterns').select('*').order('created_at', { ascending: false }).limit(3),
    supabase.from('reminders').select('*').eq('fired', false)
      .gte('trigger_at', today.toISOString()).lte('trigger_at', tomorrow.toISOString()),
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
End with one direct question about today's priority.`;

  const brief = await generateResponse(systemPrompt, [{ role: 'user', content: briefPrompt }], {
    temperature: 0.5, max_tokens: 1024,
  });

  await sendMessage(CHAT_ID, brief);

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

  if (!isWaking) return { fired: 0, skipped: 'outside waking hours' };

  // 1. Morning brief nudge
  const { data: wmRows } = await supabase.from('working_memory')
    .select('key, value').in('key', ['morning_brief_replied', 'morning_brief_nudge_at'])
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);

  const wm = Object.fromEntries((wmRows || []).map(r => [r.key, r.value]));
  if (wm['morning_brief_nudge_at'] && new Date(wm['morning_brief_nudge_at']) <= now && wm['morning_brief_replied'] !== 'true') {
    await sendMessage(CHAT_ID, `👋 You haven't responded to the morning brief yet, Suven. What's the plan today?`);
    await supabase.from('working_memory').delete().eq('key', 'morning_brief_nudge_at');
    fired++;
  }

  // 2. Fire due reminders
  const { data: reminders } = await supabase.from('reminders')
    .select('*').eq('fired', false).lte('trigger_at', now.toISOString());

  for (const r of (reminders || [])) {
    const followUp = getFollowUpQuestion(r.tier);
    await sendMessage(CHAT_ID, `⏰ *REMINDER (Tier ${r.tier})*\n\n${r.message}\n\n_${followUp}_`);
    await supabase.from('reminders').update({ fired: true, last_notified_at: now.toISOString() }).eq('id', r.id);
    fired++;
  }

  // 3. Smart-frequency task pings
  const { data: openTasks } = await supabase.from('tasks')
    .select('*').eq('status', 'open').neq('tier', 4);

  for (const t of (openTasks || [])) {
    if (shouldNotifyTask(t, now, isWaking)) {
      const followUp = getFollowUpQuestion(t.tier);
      let msg = `📋 *TASK FOLLOW-UP (Tier ${t.tier})*\n\n*${t.title}*`;
      if (t.deadline) {
        msg += `\nDue: ${new Date(t.deadline).toLocaleString('en-US', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
      }
      msg += `\n\n_${followUp}_`;
      await sendMessage(CHAT_ID, msg);
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

  for (const t of (overdue || [])) {
    const daysLate = Math.ceil((now - new Date(t.deadline)) / (1000 * 60 * 60 * 24));
    const followUps = (t.follow_up_count || 0);

    // Only escalate every 4+ hours
    const lastNotified = t.last_notified_at ? new Date(t.last_notified_at) : new Date(t.created_at);
    if ((now - lastNotified) < 4 * 60 * 60 * 1000) continue;

    let tone = followUps < 2
      ? `Task "${t.title}" is ${daysLate}d overdue. Status?`
      : `You've avoided "${t.title}" for ${daysLate} days (${followUps}x followed up). What's actually blocking this?`;

    await sendMessage(CHAT_ID, `⚠️ *ACCOUNTABILITY*\n\n${tone}`);
    await supabase.from('tasks').update({
      follow_up_count: followUps + 1,
      last_notified_at: now.toISOString(),
    }).eq('id', t.id);
    fired++;
  }

  return { fired };
}

// ─── Weekly Review ──────────────────────────────────────────────────────────
async function triggerWeeklyReview() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [{ data: completed }, { data: failed }, { data: ideas }, { data: patterns }] = await Promise.all([
    supabase.from('tasks').select('title').eq('status', 'done').gte('updated_at', weekAgo.toISOString()),
    supabase.from('tasks').select('title').eq('status', 'open').not('deadline', 'is', null).lte('deadline', new Date().toISOString()),
    supabase.from('ideas').select('content').gte('created_at', weekAgo.toISOString()),
    supabase.from('patterns').select('observation').gte('created_at', weekAgo.toISOString()),
  ]);

  const systemPrompt = await getFullPrompt('weekly review');
  const reviewPrompt = `Generate a weekly review:

✅ Completed (${(completed || []).length}):
${(completed || []).map(t => `- ${t.title}`).join('\n') || '- None'}

❌ Missed/Overdue (${(failed || []).length}):
${(failed || []).map(t => `- ${t.title}`).join('\n') || '- None'}

💡 Ideas logged: ${(ideas || []).length}
📊 Patterns: ${(patterns || []).map(p => p.observation).join('; ') || 'None'}

Write a direct, honest paragraph about the week. Then list 3-5 specific intentions for next week.`;

  const review = await generateResponse(systemPrompt, [{ role: 'user', content: reviewPrompt }], {
    temperature: 0.6, max_tokens: 2048,
  });

  await sendMessage(CHAT_ID, `📊 *WEEKLY REVIEW*\n\n${review}`);
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
    if (!task.deadline) return diffHours >= 1;
    const minsToDeadline = (new Date(task.deadline) - now) / (1000 * 60);
    if (minsToDeadline > 0) {
      if (minsToDeadline <= 30) return diffMins >= 30;
      if (minsToDeadline <= 60) return diffMins >= 60;
      if (minsToDeadline <= 180) return diffMins >= 180;
      return false;
    }
    return diffMins >= 30; // Overdue Tier 1: every 30 min
  }
  if (task.tier === 2) return diffHours >= 2;
  if (task.tier === 3) return diffHours >= 4;
  return false;
}
