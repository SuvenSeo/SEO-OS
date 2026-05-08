require('dotenv').config();
const supabase = require('../config/supabase');

async function checkPrompt() {
  const { data, error } = await supabase
    .from('agent_config')
    .select('value')
    .eq('key', 'system_prompt')
    .single();

  if (error) {
    console.error('Error fetching prompt:', error.message);
    return;
  }

  console.log('--- CURRENT SYSTEM PROMPT ---');
  console.log(data.value);
}

checkPrompt();
