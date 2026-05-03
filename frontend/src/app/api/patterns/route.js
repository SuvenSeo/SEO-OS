import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('patterns')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ patterns: data });
}
