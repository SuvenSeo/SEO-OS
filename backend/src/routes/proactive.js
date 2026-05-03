const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { generateResponse } = require('../services/groq');
const { sendMessage } = require('../services/telegram');
const { loadSystemPrompt } = require('../services/context');
const auth = require('../middleware/auth');

router.use(auth);

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ── POST /api/proactive/morning-brief ──────────────────────
router.post('/morning-brief', async (req, res) => {
  try {
    await triggerMorningBrief();
    res.json({ success: true, action: 'morning-brief' });
  } catch (error) {
    console.error('[Proactive] Morning brief error:', error.message);
    res.status(500).json({ error: 'Failed to generate morning brief' });
  }
});

async function triggerMorningBrief() {
  // Fetch today's data
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [tasksRes, patternsRes, remindersRes] = await Promise.all([
    supabase.from('tasks').select('*').eq('status', 'open').order('priority'),
    supabase.from('patterns').select('*').order('created_at', { ascending: false }).limit(3),
    supabase.from('reminders').select('*').eq('fired', false)
      .gte('trigger_at', today.toISOString()).lte('trigger_at', tomorrow.toISOString()),
  ]);

  const tasks = tasksRes.data || [];
  const patterns = patternsRes.data || [];
  const todayReminders = remindersRes.data || [];

  // Tasks due today
  const dueToday = tasks.filter(t => {
    if (!t.deadline) return false;
    const dl = new Date(t.deadline);
    return dl >= today && dl < tomorrow;
  });

  const overdue = tasks.filter(t => {
    if (!t.deadline) return false;
    return new Date(t.deadline) < today;
  });

  // Build brief with Groq
  const systemPrompt = await loadSystemPrompt();
  const briefPrompt = `Generate a morning brief for Suven. Use this exact format:

Good morning Suven.

TODAY:
${dueToday.length > 0 ? dueToday.map(t => `→ ${t.title} [P${t.priority}]`).join('\n') : '→ No deadlines today'}

${overdue.length > 0 ? `OVERDUE:\n${overdue.map(t => `→ ${t.title} [P${t.priority}] — ${t.follow_up_count}x followed up`).join('\n')}\n` : ''}
OPEN (${tasks.length} total):
${tasks.slice(0, 8).map(t => `→ P${t.priority}: ${t.title}`).join('\n')}
${tasks.length > 8 ? `→ ...and ${tasks.length - 8} more` : ''}

${patterns.length > 0 ? `WATCH:\n${patterns.map(p => `→ [${p.confidence}] ${p.observation}`).join('\n')}\n` : ''}
${todayReminders.length > 0 ? `REMINDERS TODAY:\n${todayReminders.map(r => `→ ${r.message}`).join('\n')}\n` : ''}
What's the priority today?

Keep the format clean and direct. Add a one-line observation if you see a pattern worth calling out.`;

  const brief = await generateResponse(systemPrompt, [{ role: 'user', content: briefPrompt }], {
    temperature: 0.5, max_tokens: 1024,
  });

  await sendMessage(CHAT_ID, brief);

  // Set morning brief reply flags in working_memory
  const nudgeAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const flagExpiry = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  await Promise.all([
    // Flag: has Suven replied yet? (telegram.js sets this to 'true' when a message comes in 8-11am)
    supabase.from('working_memory').upsert(
      { key: 'morning_brief_replied', value: 'false', expires_at: flagExpiry },
      { onConflict: 'key' }
    ),
    // Flag: when to fire the nudge
    supabase.from('working_memory').upsert(
      { key: 'morning_brief_nudge_at', value: nudgeAt, expires_at: flagExpiry },
      { onConflict: 'key' }
    ),
  ]);
}

// ── POST /api/proactive/evening-checkin ────────────────────
router.post('/evening-checkin', async (req, res) => {
  try {
    const { data: tasks } = await supabase.from('tasks').select('title, status, follow_up_count')
      .eq('status', 'open').order('priority').limit(5);

    const taskList = (tasks || []).map(t => `→ ${t.title}`).join('\n');

    const msg = `What did you get done today? Any updates on your tasks?\n\nStill open:\n${taskList || '(none)'}`;
    await sendMessage(CHAT_ID, msg);

    res.json({ success: true, action: 'evening-checkin' });
  } catch (error) {
    console.error('[Proactive] Evening check-in error:', error.message);
    res.status(500).json({ error: 'Failed to send evening check-in' });
  }
});

// ── POST /api/proactive/reminder-check ─────────────────────
router.post('/reminder-check', async (req, res) => {
  try {
    const now = new Date();

    // --- Read waking hours from agent_config ---
    const { data: configRows } = await supabase
      .from('agent_config')
      .select('key, value')
      .in('key', ['waking_hours_start', 'waking_hours_end']);

    const configMap = Object.fromEntries((configRows || []).map(r => [r.key, parseInt(r.value, 10)]));
    const wakingStart = configMap['waking_hours_start'] ?? 8;
    const wakingEnd   = configMap['waking_hours_end']   ?? 22;

    // Get IST hour
    const istHour = parseInt(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false }),
      10
    );
    const isWakingHours = istHour >= wakingStart && istHour <= wakingEnd;

    let fired = 0;

    // 1. Morning brief nudge check
    const { data: wmRows } = await supabase
      .from('working_memory')
      .select('key, value')
      .in('key', ['morning_brief_replied', 'morning_brief_nudge_at'])
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);

    const wm = Object.fromEntries((wmRows || []).map(r => [r.key, r.value]));
    const nudgeAt = wm['morning_brief_nudge_at'];
    const replied = wm['morning_brief_replied'];

    if (nudgeAt && new Date(nudgeAt) <= now && replied !== 'true') {
      await sendMessage(CHAT_ID,
        `👋 You haven't responded to the morning brief yet, Suven. What's the plan today?`
      );
      // Clear the nudge so it only fires once
      await supabase.from('working_memory').delete().eq('key', 'morning_brief_nudge_at');
      fired++;
    }

    // 2. Explicit reminders
    const { data: reminders } = await supabase.from('reminders')
      .select('*').eq('fired', false).lte('trigger_at', now.toISOString());

    for (const r of (reminders || [])) {
      const followUp = getFollowUpQuestion(r.tier);
      await sendMessage(CHAT_ID, `⏰ *REMINDER (Tier ${r.tier})*\n\n${r.message}\n\n_${followUp}_`);
      await supabase.from('reminders').update({
        fired: true,
        last_notified_at: now.toISOString()
      }).eq('id', r.id);
      fired++;
    }

    // 3. Open task smart-frequency pings
    const { data: tasks } = await supabase.from('tasks')
      .select('*').eq('status', 'open').neq('tier', 4);

    for (const t of (tasks || [])) {
      if (shouldNotifyTask(t, now, isWakingHours)) {
        const followUp = getFollowUpQuestion(t.tier);
        let msg = `📋 *TASK FOLLOW-UP (Tier ${t.tier})*\n\n*${t.title}*`;
        if (t.deadline) {
          const dl = new Date(t.deadline);
          msg += `\nDue: ${dl.toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`;
        }
        msg += `\n\n_${followUp}_`;
        await sendMessage(CHAT_ID, msg);
        await supabase.from('tasks').update({
          last_notified_at: now.toISOString(),
          follow_up_count: t.follow_up_count + 1
        }).eq('id', t.id);
        fired++;
      }
    }

    res.json({ success: true, fired });
  } catch (error) {
    console.error('[Proactive] Reminder check error:', error.message);
    res.status(500).json({ error: 'Failed to check reminders' });
  }
});

function getFollowUpQuestion(tier) {
  switch (tier) {
    case 1: return "Have you started? How much is left?";
    case 2: return "Any progress on this?";
    case 3: return "Still on your radar?";
    default: return "Any updates?";
  }
}

function shouldNotifyTask(task, now, isWakingHours) {
  const lastNotified = task.last_notified_at ? new Date(task.last_notified_at) : new Date(task.created_at);
  const diffMs = now - lastNotified;
  const diffMins = diffMs / (1000 * 60);
  const diffHours = diffMs / (1000 * 60 * 60);

  if (task.tier === 1) {
    if (!task.deadline) return diffHours >= 1; // Fallback for Tier 1 without deadline
    const deadline = new Date(task.deadline);
    const msToDeadline = deadline - now;
    const minsToDeadline = msToDeadline / (1000 * 60);

    // T-3h, T-1h, T-30m logic
    if (minsToDeadline > 0) {
      if (minsToDeadline <= 30 && diffMins >= 30) return true;
      if (minsToDeadline <= 60 && diffMins >= 60) return true;
      if (minsToDeadline <= 180 && diffMins >= 180) return true;
      return false;
    }
    // Overdue Tier 1: Every 30 mins
    return diffMins >= 30;
  }

  if (task.tier === 2) {
    // Every 2 hours during waking hours
    return isWakingHours && diffHours >= 2;
  }

  if (task.tier === 3) {
    // Every 4 hours
    return diffHours >= 4;
  }

  return false;
}

// ── POST /api/proactive/accountability ─────────────────────
router.post('/accountability', async (req, res) => {
  try {
    const now = new Date();

    const { data: overdue } = await supabase.from('tasks').select('*')
      .eq('status', 'open').not('deadline', 'is', null).lte('deadline', now.toISOString());

    if (!overdue || overdue.length === 0) {
      return res.json({ success: true, flagged: 0 });
    }

    const systemPrompt = await loadSystemPrompt();

    for (const t of overdue) {
      const daysLate = Math.ceil((now - new Date(t.deadline)) / (1000 * 60 * 60 * 24));
      const followUpNum = t.follow_up_count + 1;

      // Build escalating prompt based on how many times this has been flagged
      let toneInstruction;
      if (followUpNum === 1) {
        toneInstruction = 'Send a standard, direct nudge. Note the task is overdue and ask for a status update.';
      } else if (followUpNum === 2) {
        toneInstruction = 'Be more direct. This is the second time flagging this. Call it out clearly and ask what is blocking progress.';
      } else {
        toneInstruction = `This is follow-up #${followUpNum}. Call out the avoidance pattern explicitly and bluntly. Something is being avoided here. Do not soften the message. Use the task title and how many days late it is. End with one direct question about what is actually blocking it.`;
      }

      const escalationPrompt = `You are SEOS, Suven's chief of staff.

Task: "${t.title}"
Days overdue: ${daysLate}
Times followed up: ${t.follow_up_count}

Instruction: ${toneInstruction}

Write a short, direct Telegram message (2-4 lines max). No emojis at the start. Be direct, not harsh for the sake of it — but honest.`;

      const message = await generateResponse(systemPrompt, [{ role: 'user', content: escalationPrompt }], {
        temperature: 0.6, max_tokens: 256,
      });

      await sendMessage(CHAT_ID, `⚠️ *ACCOUNTABILITY*\n\n${message}`);
      await supabase.from('tasks').update({ follow_up_count: followUpNum }).eq('id', t.id);
    }

    res.json({ success: true, flagged: overdue.length });
  } catch (error) {
    console.error('[Proactive] Accountability error:', error.message);
    res.status(500).json({ error: 'Failed to run accountability check' });
  }
});

// ── POST /api/proactive/weekly-review ──────────────────────
router.post('/weekly-review', async (req, res) => {
  try {
    await triggerWeeklyReview();
    res.json({ success: true, action: 'weekly-review' });
  } catch (error) {
    console.error('[Proactive] Weekly review error:', error.message);
    res.status(500).json({ error: 'Failed to generate weekly review' });
  }
});

async function triggerWeeklyReview() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [episodesRes, completedRes, failedRes, ideasRes, patternsRes] = await Promise.all([
    supabase.from('episodic_memory').select('role, content, created_at')
      .gte('created_at', weekAgo.toISOString()).order('created_at').limit(100),
    supabase.from('tasks').select('title').eq('status', 'done')
      .gte('updated_at', weekAgo.toISOString()),
    supabase.from('tasks').select('title').eq('status', 'open')
      .not('deadline', 'is', null).lte('deadline', new Date().toISOString()),
    supabase.from('ideas').select('content').gte('created_at', weekAgo.toISOString()),
    supabase.from('patterns').select('observation').gte('created_at', weekAgo.toISOString()),
  ]);

  const completed = completedRes.data || [];
  const failed = failedRes.data || [];
  const ideas = ideasRes.data || [];
  const patterns = patternsRes.data || [];

  const systemPrompt = await loadSystemPrompt();
  const reviewPrompt = `Generate a weekly review. Format:

Week Review — [date range for this past week]

✅ Completed (${completed.length}):
${completed.map(t => `- ${t.title}`).join('\n') || '- None'}

❌ Missed/Overdue (${failed.length}):
${failed.map(t => `- ${t.title}`).join('\n') || '- None'}

💡 Ideas logged: ${ideas.length}
📊 Patterns noticed:
${patterns.map(p => `- ${p.observation}`).join('\n') || '- None this week'}

Thoughts: [Write a direct, honest paragraph about the week — what went well, what didn't, patterns you see]

Next week intentions:
[3-5 specific actionable intentions based on the data]`;

  const review = await generateResponse(systemPrompt, [{ role: 'user', content: reviewPrompt }], {
    temperature: 0.6, max_tokens: 2048,
  });

  // Save to weekly_reviews
  await supabase.from('weekly_reviews').insert({
    week_start: weekAgo.toISOString().split('T')[0],
    content: review,
    tasks_completed: completed.length,
    tasks_failed: failed.length,
    patterns_noted: patterns.map(p => p.observation).join('; ') || null,
  });

  await sendMessage(CHAT_ID, review);
}

// ── POST /api/proactive/self-audit ─────────────────────────
router.post('/self-audit', async (req, res) => {
  try {
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

    const [reviewsRes, episodesRes, patternsRes] = await Promise.all([
      supabase.from('weekly_reviews').select('*')
        .gte('created_at', fourWeeksAgo.toISOString()).order('created_at'),
      supabase.from('episodic_memory').select('role, content')
        .gte('created_at', fourWeeksAgo.toISOString()).order('created_at').limit(200),
      supabase.from('patterns').select('*')
        .gte('created_at', fourWeeksAgo.toISOString()),
    ]);

    const systemPrompt = await loadSystemPrompt();
    const auditPrompt = `You are auditing your own system prompt. Based on the last 4 weeks of data, propose specific changes.

Current system prompt:
---
${systemPrompt}
---

Weekly reviews:
${(reviewsRes.data || []).map(r => r.content).join('\n---\n')}

Patterns observed:
${(patternsRes.data || []).map(p => p.observation).join('\n')}

Propose specific additions, removals, or modifications to the system prompt. Format as:
PROPOSED CHANGES:
1. [change description]
2. [change description]

REASONING: [why these changes would improve effectiveness]

UPDATED PROMPT: [the full updated system prompt]`;

    const audit = await generateResponse(systemPrompt, [{ role: 'user', content: auditPrompt }], {
      temperature: 0.4, max_tokens: 3000,
    });

    await sendMessage(CHAT_ID,
      `🔧 *SELF-AUDIT — System Prompt Review*\n\n${audit}\n\n_Reply "approve" to apply these changes, or "reject" to keep the current prompt._`
    );

    // Store proposal in working memory for webhook handler to check
    await supabase.from('working_memory').insert({
      key: 'pending_self_audit',
      value: audit,
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });

    res.json({ success: true, action: 'self-audit' });
  } catch (error) {
    console.error('[Proactive] Self-audit error:', error.message);
    res.status(500).json({ error: 'Failed to run self-audit' });
  }
});

// Export trigger functions for Telegram commands
module.exports = router;
module.exports.triggerMorningBrief = triggerMorningBrief;
module.exports.triggerWeeklyReview = triggerWeeklyReview;
