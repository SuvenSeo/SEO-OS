import supabase from '@/lib/config/supabase';

/**
 * Insert a knowledge_base row with error logging.
 * Returns { error } for callers that need to branch.
 */
export async function insertKnowledgeBase(row, operation) {
  const { error } = await supabase.from('knowledge_base').insert(row);
  if (error) {
    console.error('[KnowledgeBase]', error, { source: row.source, operation });
  }
  return { error };
}

/**
 * Parse JSON from LLM output, stripping code fences.
 */
export function parseStructuredJson(raw, fallback) {
  try {
    const cleaned = (raw || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

/**
 * Normalize entity names for comparison.
 */
export function normalizeEntityName(name) {
  return (name || '').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize text for dedup comparison.
 */
export function normalizeForCompare(text = '') {
  return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Check if a message is a simple greeting.
 */
export function isGreetingOnlyMessage(text = '') {
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized || normalized.length > 60) return false;
  if (/[/?]/.test(normalized) || /\b(remind|task|deadline|clear|delete|remove|save|research|read)\b/i.test(normalized)) {
    return false;
  }
  return /^(hi|hii+|hello+|helloo+|hey+|heyy+|yo+|sup+|hola+|good (morning|afternoon|evening)|what'?s up|whats up|how are you)\W*$/.test(normalized);
}

/**
 * Build a warm greeting reply.
 */
export function buildWarmGreetingReply() {
  return "Hey Suven 👋 I'm here. Want to just chat, set a reminder, or get a quick summary of your day?";
}

/**
 * Build Colombo timezone trigger ISO string.
 */
export function buildColomboTriggerIso(dayOffset, hour24, minute) {
  const colomboNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' }));
  colomboNow.setSeconds(0, 0);
  colomboNow.setDate(colomboNow.getDate() + dayOffset);
  colomboNow.setHours(hour24, minute, 0, 0);
  const utcMs = colomboNow.getTime() - (5.5 * 60 * 60 * 1000);
  return new Date(utcMs).toISOString();
}
