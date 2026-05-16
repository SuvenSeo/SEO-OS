import { NextResponse } from 'next/server';
import supabase from '@/lib/config/supabase';
import { requireAuth } from '@/lib/middleware/auth';
import { generateResponse } from '@/lib/services/groq';
import { getFullPrompt } from '@/lib/services/context';
import { processExchange, formatSummary } from '@/lib/services/postProcessor';
import { searchWeb } from '@/lib/services/search';
import { listMessages, getMessageContent } from '@/lib/services/gmail';

export async function POST(request) {
  const authResponse = requireAuth(request);
  if (authResponse) return authResponse;

  try {
    const { message } = await request.json();
    if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

    // 1. Store user message
    await supabase.from('episodic_memory').insert({ role: 'user', content: message });

    // 2. Fetch recent conversation
    const { data: recentRows } = await supabase
      .from('episodic_memory')
      .select('role, content, tool_calls, tool_call_id, name')
      .order('created_at', { ascending: false })
      .limit(12);

    const messages = (recentRows || [])
      .reverse()
      .map(m => {
        const msg = { role: m.role, content: m.content || '' };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.name) msg.name = m.name;
        return msg;
      });

    // 3. Start Tool Loop
    let finalResponse = '';
    const maxToolIterations = 5;
    let iteration = 0;

    while (iteration < maxToolIterations) {
      iteration++;
      
      const systemPrompt = await getFullPrompt(message);
      const aiMessage = await generateResponse(systemPrompt, messages);

      // Add assistant's message to local loop history
      messages.push(aiMessage);

      // Save assistant's message (including tool_calls) to episodic memory
      await supabase.from('episodic_memory').insert({
        role: 'assistant',
        content: aiMessage.content || '',
        tool_calls: aiMessage.tool_calls || null,
      });

      // If no tool calls, this is the final answer
      if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
        finalResponse = aiMessage.content;
        break;
      }

      // Process each tool call
      for (const toolCall of aiMessage.tool_calls) {
        const { name, arguments: argsString } = toolCall.function;
        const args = JSON.parse(argsString);
        let result = '';

        console.log(`[Chat API] Executing tool: ${name}`, args);

        if (name === 'web_search') {
          result = await searchWeb(args.query);
        } else if (name === 'list_gmail') {
          result = await listMessages(args.query);
        } else if (name === 'read_gmail_content') {
          result = await getMessageContent(args.messageId);
        } else {
          result = 'Unknown tool: ' + name;
        }

        // Add tool result to local history
        const toolResultMessage = {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: name,
          content: result,
        };
        messages.push(toolResultMessage);

        // Save tool result to episodic memory
        await supabase.from('episodic_memory').insert(toolResultMessage);
      }
    }

    // 4. Post-process (detect tasks, reminders, ideas, patterns)
    const summary = await processExchange(message, finalResponse);
    const summaryText = formatSummary(summary);

    // 5. Auto-ingest substantial information into Knowledge Base
    if (message.length > 300 || message.includes('http') || (finalResponse && finalResponse.length > 500)) {
      await supabase.from('knowledge_base').insert({
        content: `User: ${message}\n\nAI: ${finalResponse}`,
        source: 'web-chat-auto',
      });
    }

    return NextResponse.json({ 
      response: finalResponse + summaryText, 
      summary 
    });
  } catch (error) {
    console.error('[Chat Send Error]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
