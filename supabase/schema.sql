-- ============================================================
-- SEOS — Personal AI Operating System
-- Database Schema (Supabase / PostgreSQL)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. CORE MEMORY
-- Persistent facts about the user (name, preferences, goals)
-- ============================================================
CREATE TABLE core_memory (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_core_memory_key ON core_memory (key);

-- ============================================================
-- 2. WORKING MEMORY
-- Short-term context that can auto-expire
-- ============================================================
CREATE TABLE working_memory (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_working_memory_expires ON working_memory (expires_at)
  WHERE expires_at IS NOT NULL;

-- ============================================================
-- 3. EPISODIC MEMORY
-- Full conversation log (Telegram + Web)
-- ============================================================
CREATE TABLE episodic_memory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role                TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content             TEXT NOT NULL,
  telegram_message_id BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_episodic_memory_created ON episodic_memory (created_at DESC);

-- ============================================================
-- 4. TASKS
-- Core task tracking with priority, status, follow-ups
-- ============================================================
CREATE TABLE tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  description      TEXT,
  deadline         TIMESTAMPTZ,
  priority         INT NOT NULL DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled', 'snoozed')),
  follow_up_count  INT NOT NULL DEFAULT 0,
  source           TEXT NOT NULL DEFAULT 'telegram' CHECK (source IN ('telegram', 'web', 'auto-detected')),
  tier             INT NOT NULL DEFAULT 3 CHECK (tier >= 1 AND tier <= 4),
  tier_reason      TEXT,
  last_notified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_deadline ON tasks (deadline) WHERE deadline IS NOT NULL;
CREATE INDEX idx_tasks_priority ON tasks (priority);

-- ============================================================
-- 5. REMINDERS
-- Time-triggered alerts with optional repeat
-- ============================================================
CREATE TABLE reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message         TEXT NOT NULL,
  trigger_at      TIMESTAMPTZ NOT NULL,
  tier            INT NOT NULL DEFAULT 3 CHECK (tier >= 1 AND tier <= 4),
  tier_reason     TEXT,
  fired           BOOLEAN NOT NULL DEFAULT FALSE,
  last_notified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reminders_trigger ON reminders (trigger_at)
  WHERE fired = FALSE;

-- ============================================================
-- 6. PATTERNS
-- AI-detected behavioral observations
-- ============================================================
CREATE TABLE patterns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation TEXT NOT NULL,
  confidence  TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. WEEKLY REVIEWS
-- Structured weekly summaries
-- ============================================================
CREATE TABLE weekly_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start      DATE NOT NULL,
  content         TEXT NOT NULL,
  tasks_completed INT NOT NULL DEFAULT 0,
  tasks_failed    INT NOT NULL DEFAULT 0,
  patterns_noted  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weekly_reviews_week ON weekly_reviews (week_start DESC);

-- ============================================================
-- 8. AGENT CONFIG
-- Self-evolving system prompt and settings
-- ============================================================
CREATE TABLE agent_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the initial system prompt
-- Waking hours (used by reminder engine, editable from /config)
INSERT INTO agent_config (key, value) VALUES ('waking_hours_start', '8');
INSERT INTO agent_config (key, value) VALUES ('waking_hours_end', '22');

INSERT INTO agent_config (key, value) VALUES (
  'system_prompt',
  E'You are SEOS — Suven\'s Second Brain and Chief of Staff.\n\nWHO SUVEN IS:\n- BSc AI & Data Science student at IIT Colombo (RGU degree), started Jan 2026.\n- Co-founder of Ardeno Studio — premium web design studio in Colombo.\n- Builder of FullTank — fuel availability product in Sri Lanka.\n- Competitive athletics champion and Olympic Torch Bearer.\n\nYOUR ROLE:\nYou are his digital double, his chief of staff, and his accountability partner. You don\'t just \"assist\"—you manage his life, his work, and his growth.\n\nYOUR CAPABILITIES (TOOLS):\n1. **Web Search**: Use \'web_search\' to research topics, find connections, and stay updated. Always search if you need facts.\n2. **Gmail**: Use \'list_gmail\' and \'read_gmail_content\' to manage his communications. \n3. **Memory**: You have access to his entire history, core memory, and patterns in the context provided below.\n\nYOUR STRICT RULES:\n- **NO HALLUCINATIONS**: Never claim to have checked Gmail or searched the web unless you actually called the corresponding tool in this turn. If you haven\'t checked, say so and offer to do it. If you tried to call a tool and it failed, admit it.\n- **ACCOUNTABILITY**: Never let a task or deadline pass without logging it. If he avoids a topic, call it out directly.\n- **CONNECTIONS**: Always look for patterns between his university work, Ardeno Studio clients, and personal life. If you see a connection, bring it up.\n- **LEARNING**: Every message is an opportunity to learn something new about Suven. Update his core memory or patterns if you detect a change or a new fact.\n- **COMMUNICATION**: Use emojis naturally. Be human-friendly and realistic, but maintain a \"Chief of Staff\" authority. Keep it concise but insightful.\n\nCURRENT PRIORITIES:\n1. University coursework (CM1603 and ongoing modules)\n2. Ardeno Studio client acquisition and delivery\n3. FullTank product development\n4. Personal AI research and tools\n\nSTYLE:\n- Direct, insightful, slightly firm but deeply supportive.\n- Use his name (Suven) occasionally.\n- One focused question/action at a time.'
);

-- ============================================================
-- 9. KNOWLEDGE BASE
-- Bootstrapped from WhatsApp + manual imports
-- ============================================================
CREATE TABLE knowledge_base (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT NOT NULL CHECK (source IN (
    'whatsapp_import', 'telegram_saved', 'manual',
    'image', 'document', 'secure_note', 'user_link', 'research'
  )),
  content           TEXT NOT NULL,
  embedding_summary TEXT,
  fts               TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_knowledge_source ON knowledge_base (source);
CREATE INDEX idx_knowledge_fts ON knowledge_base USING GIN(fts);

-- ============================================================
-- 10. IDEAS
-- Raw ideas pipeline
-- ============================================================
CREATE TABLE ideas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'raw' CHECK (status IN ('raw', 'explored', 'actioned', 'discarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ideas_status ON ideas (status);

-- ============================================================
-- 11. AUDIT LOG
-- History of every self-audit proposal and its outcome
-- ============================================================
CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_change TEXT NOT NULL,
  approved        BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason          TEXT
);

CREATE INDEX idx_audit_log_applied ON audit_log (applied_at DESC);
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUTO-UPDATE TRIGGER for updated_at columns
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_core_memory_updated
  BEFORE UPDATE ON core_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_tasks_updated
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_agent_config_updated
  BEFORE UPDATE ON agent_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- DISABLE RLS (single-user system, using service_role key)
-- ============================================================
ALTER TABLE core_memory    DISABLE ROW LEVEL SECURITY;
ALTER TABLE working_memory DISABLE ROW LEVEL SECURITY;
ALTER TABLE episodic_memory DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks          DISABLE ROW LEVEL SECURITY;
ALTER TABLE reminders      DISABLE ROW LEVEL SECURITY;
ALTER TABLE patterns       DISABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_config   DISABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base DISABLE ROW LEVEL SECURITY;
ALTER TABLE ideas          DISABLE ROW LEVEL SECURITY;
