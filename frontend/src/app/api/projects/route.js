import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const goalId = searchParams.get('goal_id');

  let query = supabase.from('projects').select('*').order('priority', { ascending: true });
  if (status) query = query.eq('status', status);
  if (goalId) query = query.eq('goal_id', goalId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data || [] });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('projects').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data }, { status: 201 });
}
