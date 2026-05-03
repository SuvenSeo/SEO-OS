import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function DELETE(request, { params }) {
  const { id } = await params;
  const { error } = await supabase.from('working_memory').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
