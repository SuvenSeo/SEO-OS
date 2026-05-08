import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source');
  const search = searchParams.get('search');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const offset = (page - 1) * limit;

  let query = supabase.from('knowledge_base')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (source) query = query.eq('source', source);
  if (search) query = query.or(`content.ilike.%${search}%,embedding_summary.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data, total: count, page, limit });
}

export async function POST(request) {
  const body = await request.json();
  const { data, error } = await supabase.from('knowledge_base').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data }, { status: 201 });
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabase.from('knowledge_base').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
