import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  let query = supabase.from('journal_entries').select('*').order('created_at', { ascending: false }).limit(limit);
  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}

export async function POST(request) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const body = await request.json();
  const { data, error } = await supabase.from('journal_entries').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data }, { status: 201 });
}
