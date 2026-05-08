import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: false,
    telegram: false,
    groq: false,
  };

  try {
    // Supabase check
    const { error } = await supabase.from('agent_config').select('key').limit(1);
    checks.supabase = !error;

    // Telegram check
    if (process.env.TELEGRAM_BOT_TOKEN) {
      const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
      const data = await res.json();
      checks.telegram = data.ok === true;
    }

    // Groq check
    const groqKey = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '').split(',')[0].trim();
    if (groqKey) {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${groqKey}` },
      });
      checks.groq = res.ok;
    }

    checks.status = checks.supabase && checks.telegram ? 'healthy' : 'degraded';
  } catch (err) {
    checks.status = 'error';
    checks.error = err.message;
  }

  const statusCode = checks.status === 'healthy' ? 200 : checks.status === 'degraded' ? 200 : 500;
  return NextResponse.json(checks, { status: statusCode });
}
