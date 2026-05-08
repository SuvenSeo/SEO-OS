import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET() {
  const { data, error } = await supabase.from('agent_config').select('*').order('key');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}

export async function PUT(request) {
  try {
    const { key, value } = await request.json();
    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Key and value are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('agent_config')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config: data });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
