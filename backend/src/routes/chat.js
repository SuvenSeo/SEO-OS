const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { generateResponse } = require('../services/groq');
const { getFullPrompt } = require('../services/context');
const { processExchange, formatSummary } = require('../services/postProcessor');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/chat/history — paginated episodic memory
router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { data, error, count } = await supabase
      .from('episodic_memory')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) throw error;

    res.json({
      messages: (data || []).reverse(),
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// POST /api/chat/send — send message from web dashboard
router.post('/send', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Save user message
    await supabase.from('episodic_memory').insert({ role: 'user', content: message });

    // Build context
    const { fullPrompt, recentMessages } = await getFullPrompt();

    const messages = (recentMessages || [])
      .slice(0, 10) // Limit to 10 for the model message array
      .reverse()
      .map(m => ({ role: m.role, content: m.content }));

    // Call Groq
    const aiResponse = await generateResponse(fullPrompt, messages);

    // Save AI response
    await supabase.from('episodic_memory').insert({ role: 'assistant', content: aiResponse });

    // Post-process
    const summary = await processExchange(message, aiResponse);

    res.json({ response: aiResponse, summary });
  } catch (error) {
    console.error('[Chat] Send error:', error.message);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

module.exports = router;
