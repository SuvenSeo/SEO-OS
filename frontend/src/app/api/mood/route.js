import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const { data, error } = await supabase.from('mood_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ moods: data });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('mood_log').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mood: data }, { status: 201 });
}
