import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fired = searchParams.get('fired');

  let query = supabase.from('reminders').select('*').order('trigger_at', { ascending: true });
  if (fired !== null) query = query.eq('fired', fired === 'true');

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reminders: data });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('reminders').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reminder: data }, { status: 201 });
}
