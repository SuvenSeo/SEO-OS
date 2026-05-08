-- SEOS Phase 1: Critical schema fixes
-- working_memory UNIQUE key, reminders repeat_interval, audit_log previous_value,
-- patterns category, tasks enhancements, new tables for phases 2-10

-- ---------------------------------------------------------------------------
-- 1) working_memory.key UNIQUE constraint (fixes silent upsert duplicates)
-- ---------------------------------------------------------------------------
-- First deduplicate existing rows: keep only the newest per key
DELETE FROM public.working_memory
WHERE id NOT IN (
  SELECT DISTINCT ON (key) id
  FROM public.working_memory
  ORDER BY key, created_at DESC
);

ALTER TABLE public.working_memory
  DROP CONSTRAINT IF EXISTS uq_working_memory_key;
ALTER TABLE public.working_memory
  ADD CONSTRAINT uq_working_memory_key UNIQUE (key);

-- ---------------------------------------------------------------------------
-- 2) reminders.repeat_interval for repeating reminders
-- ---------------------------------------------------------------------------
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS repeat_interval TEXT
  CHECK (repeat_interval IS NULL OR repeat_interval IN ('daily','weekly','monthly','custom'));

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS repeat_cron TEXT; -- custom cron expression for 'custom'

-- ---------------------------------------------------------------------------
-- 3) audit_log.previous_value for system prompt rollback
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS previous_value TEXT;

-- ---------------------------------------------------------------------------
-- 4) patterns.category column (postProcessor already inserts this)
-- ---------------------------------------------------------------------------
ALTER TABLE public.patterns
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';

-- ---------------------------------------------------------------------------
-- 5) tasks enhancements (effort, notes, subtasks, dependencies)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS estimated_minutes INT;
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL;
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS depends_on UUID[];

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON public.tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6) core_memory enhancements (confidence, tags)
-- ---------------------------------------------------------------------------
ALTER TABLE public.core_memory
  ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 1.0;
ALTER TABLE public.core_memory
  ADD COLUMN IF NOT EXISTS tags TEXT[];

-- ---------------------------------------------------------------------------
-- 7) knowledge_base enhancements (expires_at)
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 8) Entity tracking table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('person','project','place','organization')),
  role            TEXT,
  relationship    TEXT,
  context_summary TEXT,
  last_mentioned  TIMESTAMPTZ DEFAULT NOW(),
  mention_count   INT NOT NULL DEFAULT 1,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type
  ON public.entities (lower(name), type);
CREATE INDEX IF NOT EXISTS idx_entities_type ON public.entities (type);
CREATE INDEX IF NOT EXISTS idx_entities_last_mentioned ON public.entities (last_mentioned DESC);

-- ---------------------------------------------------------------------------
-- 9) Memory conflicts queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memory_conflicts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_key  TEXT NOT NULL,
  old_value   TEXT NOT NULL,
  new_value   TEXT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  resolution  TEXT, -- 'keep_old', 'keep_new', 'merge'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_conflicts_unresolved
  ON public.memory_conflicts (resolved) WHERE resolved = FALSE;

-- ---------------------------------------------------------------------------
-- 10) Mood log table (structured mood tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mood_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mood        TEXT NOT NULL,
  intensity   TEXT DEFAULT 'medium' CHECK (intensity IN ('low','medium','high')),
  confidence  TEXT DEFAULT 'medium' CHECK (confidence IN ('low','medium','high')),
  observation TEXT,
  source      TEXT DEFAULT 'auto' CHECK (source IN ('auto','manual','telegram')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mood_log_created ON public.mood_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- 11) Task history changelog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  action     TEXT NOT NULL CHECK (action IN ('created','updated','snoozed','done','cancelled','reopened')),
  old_value  JSONB,
  new_value  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_history_task ON public.task_history (task_id);
CREATE INDEX IF NOT EXISTS idx_task_history_created ON public.task_history (created_at DESC);

-- ---------------------------------------------------------------------------
-- 12) Task templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  tasks       JSONB NOT NULL DEFAULT '[]', -- array of {title, priority, tier, estimated_minutes}
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 13) Milestones (project checkpoints)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.milestones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  target_date TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON public.milestones (project_id);

-- ---------------------------------------------------------------------------
-- 14) Time blocks (daily scheduling)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_blocks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  label      TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time   TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','done','skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_blocks_start ON public.time_blocks (start_time);

-- ---------------------------------------------------------------------------
-- 15) Journal entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           TEXT NOT NULL DEFAULT 'free' CHECK (type IN ('free','evening','gratitude','reflection')),
  content        TEXT NOT NULL,
  extracted_tasks TEXT[], -- task titles extracted from free journal
  mood_score     INT CHECK (mood_score IS NULL OR (mood_score >= 1 AND mood_score <= 5)),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_created ON public.journal_entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_type ON public.journal_entries (type);

-- ---------------------------------------------------------------------------
-- 16) Notifications (proactive message history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL DEFAULT 'proactive',
  title      TEXT,
  content    TEXT NOT NULL,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (read) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications (created_at DESC);

-- ---------------------------------------------------------------------------
-- 17) Prompt versions (system prompt history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_text TEXT NOT NULL,
  diff_text   TEXT,
  version     INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_created ON public.prompt_versions (created_at DESC);

-- ---------------------------------------------------------------------------
-- 18) Experiments (A/B flags)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.experiments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  variant    TEXT NOT NULL DEFAULT 'a' CHECK (variant IN ('a','b')),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  config_a   JSONB DEFAULT '{}',
  config_b   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 19) Clients (Ardeno Studio)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  company       TEXT,
  status        TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','active','churned','paused')),
  email         TEXT,
  phone         TEXT,
  last_contact  TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients (status);

-- ---------------------------------------------------------------------------
-- 20) Proposals (Ardeno Studio)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proposals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  amount       DECIMAL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  follow_up_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_client ON public.proposals (client_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON public.proposals (status);

-- ---------------------------------------------------------------------------
-- 21) Invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  proposal_id  UUID REFERENCES public.proposals(id) ON DELETE SET NULL,
  amount       DECIMAL NOT NULL,
  status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','paid','overdue')),
  due_date     TIMESTAMPTZ,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices (status);

-- ---------------------------------------------------------------------------
-- 22) University modules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  semester    TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','dropped')),
  grade       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 23) Study sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.study_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id   UUID REFERENCES public.modules(id) ON DELETE SET NULL,
  module_name TEXT, -- fallback if module not linked
  duration_minutes INT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_created ON public.study_sessions (created_at DESC);

-- ---------------------------------------------------------------------------
-- 24) Training sessions (athletics)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.training_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT NOT NULL DEFAULT 'general',
  duration_minutes INT NOT NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 25) Expenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount      DECIMAL NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('food','transport','study','business','personal','health','entertainment','other')),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_created ON public.expenses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses (category);

-- ---------------------------------------------------------------------------
-- Disable RLS on all new tables (single-user system)
-- ---------------------------------------------------------------------------
ALTER TABLE public.entities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_conflicts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_blocks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Add updated_at triggers on new tables that need them
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_entities_updated') THEN
      CREATE TRIGGER trg_entities_updated
      BEFORE UPDATE ON public.entities
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clients_updated') THEN
      CREATE TRIGGER trg_clients_updated
      BEFORE UPDATE ON public.clients
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_proposals_updated') THEN
      CREATE TRIGGER trg_proposals_updated
      BEFORE UPDATE ON public.proposals
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END IF;
END
$$;
