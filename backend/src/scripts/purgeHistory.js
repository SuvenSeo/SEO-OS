require('dotenv').config();
const supabase = require('../config/supabase');

async function purge() {
  console.log('Purging hallucinated history...');
  
  const { error } = await supabase
    .from('episodic_memory')
    .delete()
    .neq('role', 'system'); // Keep system messages if any, though there shouldn't be

  if (error) {
    console.error('Failed to purge history:', error.message);
  } else {
    console.log('✅ History purged. SEOS is now fresh.');
  }
}

purge();
