import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get('unread') === 'true';
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  if (unreadOnly) query = query.eq('read', false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data });
}

export async function PUT(request) {
  const { ids } = await request.json();
  if (!ids?.length) return NextResponse.json({ error: 'ids required' }, { status: 400 });
  const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
