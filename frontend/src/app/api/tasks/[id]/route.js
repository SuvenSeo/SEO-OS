import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json();
  const { data, error } = await supabase.from('tasks').update(body).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
