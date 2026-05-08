import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  let query = supabase.from('clients').select('*').order('updated_at', { ascending: false });
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('clients').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data }, { status: 201 });
}
