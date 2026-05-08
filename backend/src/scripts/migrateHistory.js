require('dotenv').config();
const supabase = require('../config/supabase');

async function migrate() {
  console.log('Upgrading episodic_memory schema...');

  // 1. Drop existing role constraint
  const { error: dropError } = await supabase.rpc('execute_sql', {
    sql: 'ALTER TABLE episodic_memory DROP CONSTRAINT IF EXISTS episodic_memory_role_check;'
  });

  // 2. Add new columns and update constraint
  const { error: addError } = await supabase.rpc('execute_sql', {
    sql: `
      ALTER TABLE episodic_memory ADD COLUMN IF NOT EXISTS tool_calls JSONB;
      ALTER TABLE episodic_memory ADD COLUMN IF NOT EXISTS tool_call_id TEXT;
      ALTER TABLE episodic_memory ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE episodic_memory ADD CONSTRAINT episodic_memory_role_check CHECK (role IN ('user', 'assistant', 'system', 'tool'));
    `
  });

  if (dropError || addError) {
    console.error('Migration failed:', dropError?.message || addError?.message);
    // Fallback: If execute_sql is not available, we might need another way or tell user
    console.log('NOTE: If this failed, make sure your Supabase project allows execute_sql RPC or run the SQL manually in the dashboard.');
  } else {
    console.log('✅ episodic_memory upgraded successfully.');
  }
}

migrate();
