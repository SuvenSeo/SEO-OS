import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { generateResponse } from '@/lib/services/groq';
import { getFullPrompt } from '@/lib/services/context';
import { processExchange, formatSummary } from '@/lib/services/postProcessor';

export async function POST(request) {
  try {
    const { message } = await request.json();
    if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

    // Store user message
    await supabase.from('episodic_memory').insert({ role: 'user', content: message });

    // Build context + prompt
    const systemPrompt = await getFullPrompt(message);

    // Fetch recent conversation
    const { data: recentMessages } = await supabase
      .from('episodic_memory')
      .select('role, content')
      .order('created_at', { ascending: false })
      .limit(10);

    const messages = (recentMessages || [])
      .reverse()
      .map(m => ({ role: m.role, content: m.content }));

    // Generate AI response
    const aiResponse = await generateResponse(systemPrompt, messages);

    // Store AI response
    await supabase.from('episodic_memory').insert({ role: 'assistant', content: aiResponse });

    // Post-process (detect tasks, reminders, ideas)
    const summary = await processExchange(message, aiResponse);
    const summaryText = formatSummary(summary);

    return NextResponse.json({ response: aiResponse + summaryText, summary });
  } catch (error) {
    console.error('[Chat Send Error]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
