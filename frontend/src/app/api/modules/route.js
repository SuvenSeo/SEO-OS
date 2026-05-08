import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  let query = supabase.from('modules').select('*').order('code');
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ modules: data });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('modules').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ module: data }, { status: 201 });
}
