import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase;

if (!supabaseUrl || !supabaseKey) {
  // Create a proxy that throws an error when actually used, not during module load
  supabase = new Proxy({}, {
    get() {
      throw new Error('[SEOS] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }
  });
} else {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export default supabase;
