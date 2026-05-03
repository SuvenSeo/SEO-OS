const supabase = require('../config/supabase');
const { generateStructuredExtraction } = require('./groq');

/**
 * Post-process an AI conversation exchange.
 * Detects tasks, reminders, ideas, and memory updates.
 * Auto-inserts detected items into the database.
 * 
 * @param {string} userMessage - What the user said
 * @param {string} aiResponse - What the AI responded
 * @returns {Promise<object>} Summary of what was detected and created
 */
async function processExchange(userMessage, aiResponse) {
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
  ]
}

Urgency Tier Classification (USE YOUR JUDGMENT):
- Tier 1 (Critical): Time-locked today/tomorrow. Urgent, specific time mentioned, or high-stakes (exams, meetings, strict deadlines).
- Tier 2 (Important): Day-level task. Important work/uni projects that need focus today but lack a specific hour-lock.
- Tier 3 (General): Vague or future-dated tasks. Things for "tomorrow", "this week", or general "to-do" items.
- Tier 4 (Soft): No real deadline. Exploration, "someday", "maybe", "could be cool". (Classify these as ideas).

Rules:
- Do NOT use keyword matching. Use the meaning and context of the conversation to decide the tier.
- Provide a concise "tier_reason" for every task and reminder explaining your classification.
- Only extract items that were explicitly mentioned or clearly implied.
- For tasks: look for action items, things to do, commitments made.
- For reminders: look for specific times mentioned ("remind me at...", "tomorrow at...").
- For ideas: look for brainstorming, "what if", project ideas, things to explore.
- For memory updates: look for new facts about the user (preferences, decisions, updates).
- Deadlines should be in ISO 8601 format. Use current date context: ${new Date().toISOString()}
- If nothing was detected for a category, return an empty array.
- Snooze detection: if the user says "remind me in X hours/days", "not now", "snooze", "later today", "tomorrow morning", "remind me again" — detect it as a snooze_request with snooze_until set to the appropriate future ISO time.

Return ONLY valid JSON.`;

  try {
    const raw = await generateStructuredExtraction(extractionPrompt);
    
    // Parse the JSON response
    let extracted;
    try {
      // Handle potential markdown code blocks in response
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extracted = JSON.parse(cleaned);
    } catch (parseError) {
      console.warn('[PostProcessor] Failed to parse extraction:', parseError.message);
      return { tasks: 0, reminders: 0, ideas: 0, memory_updates: 0, snoozed: 0 };
    }

    const summary = { tasks: 0, reminders: 0, ideas: 0, memory_updates: 0, snoozed: 0 };

    // Insert detected tasks
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

    // Insert detected reminders
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
        if (mem.type === 'core') {
          // Upsert core memory
          const { error } = await supabase
            .from('core_memory')
            .upsert(
              { key: mem.key, value: mem.value, updated_at: new Date().toISOString() },
              { onConflict: 'key' }
            );
          if (!error) summary.memory_updates++;
        } else if (mem.type === 'working') {
          // Insert working memory (expires in 24h by default)
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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

    return summary;
  } catch (error) {
    console.error('[PostProcessor] Error:', error.message);
    return { tasks: 0, reminders: 0, ideas: 0, memory_updates: 0, snoozed: 0 };
  }
}

/**
 * Format the post-processing summary for display.
 */
function formatSummary(summary) {
  const parts = [];
  if (summary.tasks > 0) parts.push(`📋 ${summary.tasks} task(s) logged`);
  if (summary.reminders > 0) parts.push(`⏰ ${summary.reminders} reminder(s) set`);
  if (summary.snoozed > 0) parts.push(`😴 ${summary.snoozed} snoozed`);
  if (summary.ideas > 0) parts.push(`💡 ${summary.ideas} idea(s) captured`);
  if (summary.memory_updates > 0) parts.push(`🧠 ${summary.memory_updates} memory update(s)`);

  if (parts.length === 0) return '';
  return '\n\n_' + parts.join(' · ') + '_';
}

module.exports = { processExchange, formatSummary };
