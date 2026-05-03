import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request, { params }) {
  const { key } = await params;
  const { data, error } = await supabase
    .from('agent_config')
    .select('*')
    .eq('key', key)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ config: data });
}

export async function PUT(request, { params }) {
  const { key } = await params;
  const { value } = await request.json();
  const { data, error } = await supabase
    .from('agent_config')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
