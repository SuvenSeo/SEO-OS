import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('audit_log').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ log: data }, { status: 201 });
}
