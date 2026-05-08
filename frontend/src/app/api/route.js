import { NextResponse } from 'next/server';

export async function GET() {
  const status = {
    supabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    groq: !!process.env.GROQ_API_KEY,
    gmail: !!process.env.GMAIL_CLIENT_ID && !!process.env.GMAIL_CLIENT_SECRET && !!process.env.GMAIL_REFRESH_TOKEN,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN
  };
  
  console.log('[HealthCheck] Env Status:', status);
  
  return NextResponse.json({ 
    status: 'online', 
    services: status,
    timestamp: new Date().toISOString()
  });
}
