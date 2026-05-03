import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('working_memory')
    .select('*')
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memory: data });
}
