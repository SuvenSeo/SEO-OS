import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { generateResponse, generateStructuredExtraction } from '@/lib/services/groq';
import { sendMessage } from '@/lib/services/telegram';
import { getFullPrompt } from '@/lib/services/context';

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
const GMAIL_ACCESS_TOKEN = process.env.GMAIL_ACCESS_TOKEN || '';
const GMAIL_USER_ID = process.env.GMAIL_USER_ID || 'me';

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
    await sendMessage(CHAT_ID, `⏰ *REMINDER (Tier ${r.tier})*\n\n${r.message}\n\n_${followUp}_`, {
      reply_markup: buildReminderActionKeyboard(r.id),
    });
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

  for (const t of (overdue || [])) {
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

  // 5. Proactive insight engine (deadline clusters + overcommit detection)
  fired += await maybeSendProactiveInsights(now, openTasks || []);

  // 6. Idle-session consolidation (2h+ inactivity)
  fired += await maybeSummarizeIdleConversation(now);

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

async function triggerEmailDigest() {
  const emails = await fetchImportantEmails();
  if (emails.length === 0) {
    await sendMessage(CHAT_ID, '📬 No unread important emails found right now.');
    return;
  }

  const emailBlock = emails
    .map((e, idx) => `${idx + 1}. ${e.subject} — ${e.from}\n${e.snippet}`)
    .join('\n\n');

  const digest = await generateResponse(
    'You summarize inbox items for an executive assistant.',
    [{ role: 'user', content: `Summarize these emails in concise bullets and highlight urgency:\n\n${emailBlock}` }],
    { temperature: 0.3, max_tokens: 500 }
  );

  const actionItems = await extractEmailActionItems(emails);
  const created = await createTasksFromEmailActions(actionItems);

  await sendMessage(
    CHAT_ID,
    `📬 *EMAIL DIGEST*\n\n${digest}\n\n_${created} action task(s) added from emails._`
  );
}

function resolveCronAuth(request) {
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) {
    return { ok: true, mode: 'bearer' };
  }

  // Vercel Cron adds x-vercel-cron, which is the platform-native verification signal.
  const vercelCronHeader = request.headers.get('x-vercel-cron');
  if (vercelCronHeader) {
    return { ok: true, mode: 'vercel-cron' };
  }

  if (CRON_SECRET && authHeader) {
    return { ok: false, reason: 'authorization mismatch' };
  }
  if (CRON_SECRET && !authHeader) {
    return { ok: false, reason: 'missing authorization header' };
  }
  return { ok: false, reason: 'missing cron verification (CRON_SECRET or x-vercel-cron)' };
}

async function consolidateAndPruneEpisodicMemory() {
  const { count, error: countError } = await supabase
    .from('episodic_memory')
    .select('id', { count: 'exact', head: true });
  if (countError) {
    console.error('[Proactive] count episodic_memory failed:', countError.message);
    throw countError;
  }

  const totalRows = count || 0;
  const excess = Math.max(0, totalRows - EPISODIC_MEMORY_RETENTION);

  let summarized = 0;
  if (excess > 0) {
    const { data: pruneCandidates, error: candidateError } = await supabase
      .from('episodic_memory')
      .select('role, content, created_at')
      .order('created_at', { ascending: true })
      .limit(Math.min(excess, EPISODIC_SUMMARY_BATCH));
    if (candidateError) {
      console.error('[Proactive] load prune candidates failed:', candidateError.message);
      throw candidateError;
    }

    if (pruneCandidates && pruneCandidates.length > 0) {
      const consolidation = await summarizeEpisodesForCoreMemory(pruneCandidates, excess);
      await appendConsolidatedSummary(consolidation.narrative);
      await appendConsolidatedFacts(consolidation.facts);
      summarized = pruneCandidates.length;
    }
  }

  const { deleted } = await pruneEpisodicMemory();
  return { deleted, summarized, excessBeforePrune: excess };
}

async function summarizeEpisodesForCoreMemory(rows, totalExcess) {
  const transcript = rows
    .map((r) => {
      const cleaned = r.content.replace(/\s+/g, ' ').trim().slice(0, 240);
      const ts = r.created_at ? new Date(r.created_at).toISOString().slice(0, 19) : 'unknown-time';
      return `[${ts}] ${r.role}: ${cleaned}`;
    })
    .join('\n');

  const systemPrompt = 'You condense personal chat logs into durable personal-memory facts.';
  const userPrompt = `Summarize this conversation archive into durable memory.
Rules:
- Output 4-8 bullet points.
- Preserve commitments, deadlines, decisions, priorities, and personal context.
- Keep each bullet under 160 characters.
- No filler or generic phrasing.
- Include uncertainty notes only if truly ambiguous.
Then output JSON with this exact shape:
{
  "decisions": ["..."],
  "commitments": ["..."],
  "deadlines": ["..."],
  "project_updates": ["..."],
  "personal_context": ["..."]
}
Each array can be empty. Return valid JSON only after the bullets, prefixed with "JSON:" on its own line.

Rows summarized now: ${rows.length}
Rows that will be pruned: ${totalExcess}

TRANSCRIPT:
${transcript}`;

  const raw = await generateResponse(
    systemPrompt,
    [{ role: 'user', content: userPrompt }],
    { temperature: 0.2, max_tokens: 450 }
  );

  const normalized = (raw || '').trim();
  const marker = '\nJSON:';
  const markerIndex = normalized.lastIndexOf(marker);
  const narrativeBody = markerIndex >= 0 ? normalized.slice(0, markerIndex).trim() : normalized;
  const factsRaw = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length).trim() : '';
  const facts = parseConsolidatedFacts(factsRaw);

  return {
    narrative: `[${new Date().toISOString()}] Consolidated ${rows.length}/${totalExcess} episodic rows\n${narrativeBody}`,
    facts,
  };
}

function parseConsolidatedFacts(raw) {
  if (!raw) {
    return {
      decisions: [],
      commitments: [],
      deadlines: [],
      project_updates: [],
      personal_context: [],
    };
  }

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
      deadlines: Array.isArray(parsed.deadlines) ? parsed.deadlines : [],
      project_updates: Array.isArray(parsed.project_updates) ? parsed.project_updates : [],
      personal_context: Array.isArray(parsed.personal_context) ? parsed.personal_context : [],
    };
  } catch (error) {
    console.warn('[Proactive] failed to parse consolidated facts JSON:', error.message);
    return {
      decisions: [],
      commitments: [],
      deadlines: [],
      project_updates: [],
      personal_context: [],
    };
  }
}

async function appendConsolidatedSummary(summary) {
  const { data: existing, error: readError } = await supabase
    .from('core_memory')
    .select('value')
    .eq('key', EPISODIC_CORE_MEMORY_KEY)
    .maybeSingle();
  if (readError) {
    console.error('[Proactive] read episodic core memory failed:', readError.message);
    throw readError;
  }

  const merged = [existing?.value, summary]
    .filter(Boolean)
    .join('\n\n')
    .slice(-EPISODIC_CORE_MEMORY_MAX_CHARS);

  const { error: upsertError } = await supabase
    .from('core_memory')
    .upsert(
      {
        key: EPISODIC_CORE_MEMORY_KEY,
        value: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

  if (upsertError) {
    console.error('[Proactive] upsert episodic core memory failed:', upsertError.message);
    throw upsertError;
  }
}

async function appendConsolidatedFacts(facts) {
  const lines = [
    ...facts.decisions.map(x => `decision: ${x}`),
    ...facts.commitments.map(x => `commitment: ${x}`),
    ...facts.deadlines.map(x => `deadline: ${x}`),
    ...facts.project_updates.map(x => `project: ${x}`),
    ...facts.personal_context.map(x => `context: ${x}`),
  ].map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

  if (lines.length === 0) return;

  const { data: existing, error: readError } = await supabase
    .from('core_memory')
    .select('value')
    .eq('key', EPISODIC_FACTS_MEMORY_KEY)
    .maybeSingle();
  if (readError) {
    console.error('[Proactive] read episodic facts memory failed:', readError.message);
    throw readError;
  }

  const existingLines = (existing?.value || '')
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean);
  const mergedLines = [...new Set([...existingLines, ...lines])].slice(-160);
  const mergedValue = mergedLines.join('\n');

  const { error: upsertError } = await supabase
    .from('core_memory')
    .upsert(
      {
        key: EPISODIC_FACTS_MEMORY_KEY,
        value: mergedValue,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  if (upsertError) {
    console.error('[Proactive] upsert episodic facts memory failed:', upsertError.message);
    throw upsertError;
  }
}

async function maybeSendProactiveInsights(now, openTasks) {
  if (!openTasks.length) return 0;

  const { data: wmRows, error: wmError } = await supabase
    .from('working_memory')
    .select('key, value')
    .in('key', [DEADLINE_CLUSTER_KEY, OVERCOMMIT_KEY])
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`);
  if (wmError) {
    console.error('[Proactive] read insight cooldowns failed:', wmError.message);
    throw wmError;
  }

  const wm = Object.fromEntries((wmRows || []).map(r => [r.key, r.value]));
  let sent = 0;

  const tasksWithDeadline = openTasks.filter(t => t.deadline);
  const groupedByDate = new Map();
  for (const task of tasksWithDeadline) {
    const dayKey = new Date(task.deadline).toISOString().slice(0, 10);
    if (!groupedByDate.has(dayKey)) groupedByDate.set(dayKey, []);
    groupedByDate.get(dayKey).push(task);
  }
  const cluster = [...groupedByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .find(([, tasks]) => tasks.length >= 3);

  const clusterCooldownActive = wm[DEADLINE_CLUSTER_KEY] && new Date(wm[DEADLINE_CLUSTER_KEY]) > now;
  if (cluster && !clusterCooldownActive) {
    const [dayKey, tasks] = cluster;
    const preview = tasks.slice(0, 5).map(t => `• ${t.title}`).join('\n');
    await sendMessage(
      CHAT_ID,
      `🧭 *Proactive insight*\n\nYou have ${tasks.length} tasks clustering on ${dayKey}.\nPrioritize top 1-2 now to avoid last-minute stress.\n\n${preview}`
    );
    await upsertWorkingMemoryCooldown(DEADLINE_CLUSTER_KEY, DEADLINE_CLUSTER_COOLDOWN_HOURS);
    sent++;
  }

  const highPriorityCount = openTasks.filter(t => (t.tier || 3) <= 2).length;
  const overcommit = openTasks.length >= 12 || highPriorityCount >= 6;
  const overcommitCooldownActive = wm[OVERCOMMIT_KEY] && new Date(wm[OVERCOMMIT_KEY]) > now;
  if (overcommit && !overcommitCooldownActive) {
    await sendMessage(
      CHAT_ID,
      `⚖️ *Proactive insight*\n\nCurrent load looks high (${openTasks.length} open, ${highPriorityCount} high-priority).\nPick one must-win task and postpone one non-critical task today.`
    );
    await upsertWorkingMemoryCooldown(OVERCOMMIT_KEY, OVERCOMMIT_COOLDOWN_HOURS);
    sent++;
  }

  return sent;
}

async function maybeSummarizeIdleConversation(now) {
  const { data: latest, error: latestError } = await supabase
    .from('episodic_memory')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    console.error('[Proactive] read latest episodic message failed:', latestError.message);
    throw latestError;
  }
  if (!latest?.created_at) return 0;

  const lastMessageAt = new Date(latest.created_at);
  if ((now - lastMessageAt) < IDLE_SUMMARY_THRESHOLD_MS) return 0;

  const { data: cursorRow, error: cursorError } = await supabase
    .from('working_memory')
    .select('value')
    .eq('key', IDLE_SUMMARY_CURSOR_KEY)
    .maybeSingle();
  if (cursorError) {
    console.error('[Proactive] read idle-summary cursor failed:', cursorError.message);
    throw cursorError;
  }
  if (cursorRow?.value === latest.created_at) return 0;

  const { data: recentEpisodes, error: episodesError } = await supabase
    .from('episodic_memory')
    .select('role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(24);
  if (episodesError) {
    console.error('[Proactive] read recent episodes for idle summary failed:', episodesError.message);
    throw episodesError;
  }
  if (!recentEpisodes || recentEpisodes.length === 0) return 0;

  const ordered = [...recentEpisodes].reverse();
  let sessionStart = ordered.length - 1;
  for (let i = ordered.length - 1; i > 0; i--) {
    const cur = new Date(ordered[i].created_at).getTime();
    const prev = new Date(ordered[i - 1].created_at).getTime();
    if ((cur - prev) > SESSION_BREAK_MS) break;
    sessionStart = i - 1;
  }
  const session = ordered.slice(sessionStart);
  const transcript = session
    .map(r => `[${r.role}] ${r.content.replace(/\s+/g, ' ').trim().slice(0, 280)}`)
    .join('\n');

  const idleSummary = await generateResponse(
    'You summarize personal conversations into durable second-brain notes.',
    [{
      role: 'user',
      content: `Create a concise session summary with:\n1) key decisions\n2) open loops\n3) next-step commitments\n\nSESSION:\n${transcript}`,
    }],
    { temperature: 0.3, max_tokens: 300 }
  );

  const { error: summaryUpsertError } = await supabase
    .from('core_memory')
    .upsert(
      {
        key: 'last_idle_conversation_summary',
        value: `[${new Date().toISOString()}]\n${idleSummary.trim()}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  if (summaryUpsertError) {
    console.error('[Proactive] upsert idle summary failed:', summaryUpsertError.message);
    throw summaryUpsertError;
  }

  const { error: cursorUpsertError } = await supabase
    .from('working_memory')
    .upsert(
      {
        key: IDLE_SUMMARY_CURSOR_KEY,
        value: latest.created_at,
      },
      { onConflict: 'key' }
    );
  if (cursorUpsertError) {
    console.error('[Proactive] update idle-summary cursor failed:', cursorUpsertError.message);
    throw cursorUpsertError;
  }

  await sendMessage(CHAT_ID, '🧠 I summarized your last conversation session into memory for future context.');
  return 1;
}

async function upsertWorkingMemoryCooldown(key, hours) {
  const expires = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('working_memory')
    .upsert(
      {
        key,
        value: expires,
        expires_at: expires,
      },
      { onConflict: 'key' }
    );
  if (error) {
    console.error('[Proactive] upsert working-memory cooldown failed:', error.message);
    throw error;
  }
}

function buildTaskActionKeyboard(taskId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Done', callback_data: `task_done:${taskId}` },
        { text: '😴 Snooze 1h', callback_data: `task_snooze:${taskId}:1` },
      ],
      [
        { text: '📅 Snooze 12h', callback_data: `task_snooze:${taskId}:12` },
      ],
    ],
  };
}

function buildReminderActionKeyboard(reminderId) {
  return {
    inline_keyboard: [
      [
        { text: '😴 Snooze 1h', callback_data: `reminder_snooze:${reminderId}:1` },
        { text: '📅 Snooze 12h', callback_data: `reminder_snooze:${reminderId}:12` },
      ],
    ],
  };
}

async function fetchTodayCalendarEvents(start, end) {
  if (!GOOGLE_CALENDAR_TOKEN) return [];

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`);
  url.searchParams.set('timeMin', start.toISOString());
  url.searchParams.set('timeMax', end.toISOString());
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '6');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${GOOGLE_CALENDAR_TOKEN}` },
  });
  if (!response.ok) {
    console.warn('[Proactive] Calendar fetch failed:', response.status);
    return [];
  }

  const data = await response.json();
  return (data.items || []).map(item => ({
    summary: item.summary || '(Untitled)',
    start: (item.start?.dateTime || item.start?.date || '').replace('T', ' ').slice(0, 16),
  }));
}

async function fetchImportantEmails() {
  if (!GMAIL_ACCESS_TOKEN) return [];

  const listUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(GMAIL_USER_ID)}/messages`);
  listUrl.searchParams.set('q', 'is:unread category:primary newer_than:3d');
  listUrl.searchParams.set('maxResults', '8');

  const listResp = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${GMAIL_ACCESS_TOKEN}` },
  });
  if (!listResp.ok) {
    console.warn('[Proactive] Gmail list fetch failed:', listResp.status);
    return [];
  }

  const listData = await listResp.json();
  const messages = listData.messages || [];
  const emails = [];

  for (const msg of messages) {
    const msgResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(GMAIL_USER_ID)}/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${GMAIL_ACCESS_TOKEN}` } }
    );
    if (!msgResp.ok) continue;
    const payload = await msgResp.json();
    const headers = payload.payload?.headers || [];
    const from = headers.find(h => h.name === 'From')?.value || 'Unknown sender';
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
