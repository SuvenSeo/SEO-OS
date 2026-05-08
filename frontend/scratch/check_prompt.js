import supabase from '../src/lib/config/supabase.js';

async function checkPrompt() {
  const { data, error } = await supabase
    .from('agent_config')
    .select('value')
    .eq('key', 'system_prompt')
    .single();

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log('--- SYSTEM PROMPT ---');
  console.log(data.value);
  console.log('--- END ---');
  process.exit(0);
}

checkPrompt();
