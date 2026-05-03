const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// ── GET /api/ideas ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('ideas')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ ideas: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// ── POST /api/ideas ────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const { data, error } = await supabase
      .from('ideas')
      .insert({ content, status: 'raw' })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ idea: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create idea' });
  }
});

// ── PATCH /api/ideas/:id ───────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['raw', 'explored', 'actioned', 'discarded'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('ideas')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ idea: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update idea' });
  }
});

// ── DELETE /api/ideas/:id ──────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('ideas')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

module.exports = router;
