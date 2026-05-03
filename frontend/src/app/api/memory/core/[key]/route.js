import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function PUT(request, { params }) {
  const { key } = await params;
  const { value } = await request.json();
  const { data, error } = await supabase
    .from('core_memory')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memory: data });
}

export async function DELETE(request, { params }) {
  const { key } = await params;
  const { error } = await supabase.from('core_memory').delete().eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
