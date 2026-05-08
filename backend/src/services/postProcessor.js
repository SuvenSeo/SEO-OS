const supabase = require('../config/supabase');
const { generateStructuredExtraction } = require('./groq');

/**
 * Post-process an AI conversation exchange.
 * Detects tasks, reminders, ideas, memory updates, and behavioral patterns.
 */
async function processExchange(userMessage, aiResponse) {
  const extractionPrompt = `Analyze this conversation exchange and extract any actionable items, insights, or patterns.

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
      "tier_reason": "one line reason"
    }
  ],
  "completed_tasks": [],
  "reminders": [
    {
      "message": "reminder text",
      "trigger_at": "ISO date string",
      "tier": 1|2|3,
      "tier_reason": "reason"
    }
  ],
  "deleted_reminders": [],
  "ideas": [
    { "content": "the idea" }
  ],
  "memory_updates": [
    { "key": "key", "value": "value", "type": "core|working" }
  ],
  "deleted_memory": [],
  "snooze_requests": [
    { "target": "desc", "snooze_until": "ISO", "duration_description": "2h" }
  ],
  "patterns": [
    {
      "observation": "detailed observation of a habit, pattern, or connection",
      "confidence": "high|medium|low",
      "category": "productivity|work|personal|uni"
    }
  ]
}

Rules for Patterns:
- Look for behavioral loops (e.g., procrastination triggers).
- Look for project connections (e.g., Ardeno design for FullTank).
- Only extract if evidenced in this specific exchange.

Return ONLY valid JSON. Current Time: ${new Date().toISOString()}`;

  try {
    const raw = await generateStructuredExtraction(extractionPrompt);
    
    let extracted;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extracted = JSON.parse(cleaned);
    } catch (parseError) {
      console.warn('[PostProcessor] Failed to parse extraction:', parseError.message);
      return { tasks: 0, reminders: 0, ideas: 0, memory_updates: 0, snoozed: 0, patterns: 0 };
    }

    const summary = { tasks: 0, reminders: 0, ideas: 0, memory_updates: 0, snoozed: 0, patterns: 0 };

    // 1. Insert Patterns
    if (extracted.patterns && extracted.patterns.length > 0) {
      for (const pattern of extracted.patterns) {
        const { error } = await supabase.from('patterns').insert({
          observation: pattern.observation,
          confidence: pattern.confidence || 'medium',
          category: pattern.category || 'general',
        });
        if (!error) summary.patterns++;
      }
    }

    // 2. Insert Tasks
    if (extracted.tasks && extracted.tasks.length > 0) {
      for (const task of extracted.tasks) {
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

    // 3. Insert Reminders
    if (extracted.reminders && extracted.reminders.length > 0) {
      for (const reminder of extracted.reminders) {
        if (!reminder.trigger_at) continue;
        const { error } = await supabase.from('reminders').insert({
          message: reminder.message,
          trigger_at: reminder.trigger_at,
          tier: reminder.tier || 3,
          tier_reason: reminder.tier_reason || null,
          fired: false,
        });
        if (!error) summary.reminders++;
      }
    }

    // 4. Insert Ideas
    if (extracted.ideas && extracted.ideas.length > 0) {
      for (const idea of extracted.ideas) {
        const { error } = await supabase.from('ideas').insert({
          content: idea.content,
          status: 'raw',
        });
        if (!error) summary.ideas++;
      }
    }

    // 5. Memory Updates
    if (extracted.memory_updates && extracted.memory_updates.length > 0) {
      for (const mem of extracted.memory_updates) {
        if (mem.type === 'core') {
          await supabase.from('core_memory').upsert({ key: mem.key, value: mem.value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        } else {
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await supabase.from('working_memory').insert({ key: mem.key, value: mem.value, expires_at: expiresAt });
        }
        summary.memory_updates++;
      }
    }

    // 6. Snooze
    if (extracted.snooze_requests && extracted.snooze_requests.length > 0) {
      for (const snooze of extracted.snooze_requests) {
        if (!snooze.snooze_until) continue;
        await supabase.from('reminders').insert({
          message: `Snoozed: ${snooze.target}`,
          trigger_at: snooze.snooze_until,
          tier: 2,
          tier_reason: `Snoozed by user`,
          fired: false,
        });
        summary.snoozed++;
      }
    }

    // 7. Deletions/Completions (Simplified)
    if (extracted.completed_tasks?.length > 0) {
      const { data: openTasks } = await supabase.from('tasks').select('id, title').eq('status', 'open');
      for (const doneTitle of extracted.completed_tasks) {
        const match = openTasks?.find(t => t.title.toLowerCase().includes(doneTitle.toLowerCase()));
        if (match) await supabase.from('tasks').update({ status: 'done' }).eq('id', match.id);
      }
    }

    return summary;
  } catch (error) {
    console.error('[PostProcessor] Error:', error.message);
    return { tasks: 0, reminders: 0, ideas: 0, memory_updates: 0, snoozed: 0, patterns: 0 };
  }
}

function formatSummary(summary) {
  const parts = [];
  if (summary.tasks > 0) parts.push(`📋 ${summary.tasks} task(s) logged`);
  if (summary.reminders > 0) parts.push(`⏰ ${summary.reminders} reminder(s) set`);
  if (summary.ideas > 0) parts.push(`💡 ${summary.ideas} idea(s) captured`);
  if (summary.patterns > 0) parts.push(`🧠 ${summary.patterns} pattern(s) detected`);
  if (summary.memory_updates > 0) parts.push(`🧬 Memory updated`);

  if (parts.length === 0) return '';
  return '\n\n_' + parts.join(' · ') + '_';
}

module.exports = { processExchange, formatSummary };
