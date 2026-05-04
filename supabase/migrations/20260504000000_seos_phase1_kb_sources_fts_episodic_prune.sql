-- SEOS Phase 1: widen knowledge_base.source CHECK, optional fts backfill, episodic prune RPC
-- Idempotent where possible for existing databases.

-- ---------------------------------------------------------------------------
-- 1) knowledge_base.source — align with all values used in application code
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_base
  DROP CONSTRAINT IF EXISTS knowledge_base_source_check;

ALTER TABLE public.knowledge_base
  ADD CONSTRAINT knowledge_base_source_check
  CHECK (source IN (
    'whatsapp_import',
    'telegram_saved',
    'manual',
    'image',
    'document',
    'secure_note',
    'user_link',
    'research'
  ));

-- ---------------------------------------------------------------------------
-- 2) Full-text search column + index (no-op if fts already present)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_base'
      AND column_name = 'fts'
  ) THEN
    ALTER TABLE public.knowledge_base
      ADD COLUMN fts tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

    CREATE INDEX IF NOT EXISTS idx_knowledge_fts
      ON public.knowledge_base USING gin (fts);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Retention prune for episodic_memory (keep N most recent by created_at)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_episodic_memory(p_keep integer DEFAULT 1500)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF p_keep IS NULL OR p_keep < 1 THEN
    RAISE EXCEPTION 'p_keep must be >= 1';
  END IF;

  DELETE FROM public.episodic_memory AS e
  USING (
    SELECT id
    FROM public.episodic_memory
    ORDER BY created_at DESC NULLS LAST
    OFFSET p_keep
  ) AS doomed
  WHERE e.id = doomed.id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_episodic_memory(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_episodic_memory(integer) TO service_role;
