require('dotenv').config();
const supabase = require('../config/supabase');

async function checkHistory() {
  const { data, error } = await supabase
    .from('episodic_memory')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching history:', error.message);
    return;
  }

  console.log('--- RECENT HISTORY ---');
  data.reverse().forEach(m => {
    console.log(`[${m.role}] ${m.content.substring(0, 100)}...`);
    if (m.tool_calls) console.log('  TOOL CALLS:', JSON.stringify(m.tool_calls));
  });
}

checkHistory();
