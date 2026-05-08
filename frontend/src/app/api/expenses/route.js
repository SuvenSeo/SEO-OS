import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  let query = supabase.from('expenses').select('*').order('created_at', { ascending: false }).limit(limit);
  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expenses: data });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('expenses').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: data }, { status: 201 });
}
