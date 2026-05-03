import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET() {
  const { data, error } = await supabase.from('core_memory').select('*').order('key');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memory: data });
}
