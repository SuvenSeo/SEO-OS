-- Phase 6: goal hierarchy + habit tracking foundations

CREATE TABLE IF NOT EXISTS public.goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
  target_date timestamptz,
  progress    int NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_status ON public.goals (status);
CREATE INDEX IF NOT EXISTS idx_goals_target_date ON public.goals (target_date) WHERE target_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id     uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  title       text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'done')),
  priority    int NOT NULL DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_goal_id ON public.projects (goal_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects (status);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON public.tasks (project_id) WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.habits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  cadence          text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily', 'weekly', 'custom')),
  target_per_week  int NOT NULL DEFAULT 5 CHECK (target_per_week >= 1 AND target_per_week <= 14),
  current_streak   int NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  last_logged_at   timestamptz,
  notes            text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_habits_status ON public.habits (status);
CREATE INDEX IF NOT EXISTS idx_habits_last_logged ON public.habits (last_logged_at) WHERE last_logged_at IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_goals_updated') THEN
      CREATE TRIGGER trg_goals_updated
      BEFORE UPDATE ON public.goals
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_projects_updated') THEN
      CREATE TRIGGER trg_projects_updated
      BEFORE UPDATE ON public.projects
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_habits_updated') THEN
      CREATE TRIGGER trg_habits_updated
      BEFORE UPDATE ON public.habits
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END IF;
END
$$;

ALTER TABLE public.goals DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.habits DISABLE ROW LEVEL SECURITY;
