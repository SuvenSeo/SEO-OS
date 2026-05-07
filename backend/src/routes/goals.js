const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/goals
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase.from('goals').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ goals: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals
router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('goals').insert(req.body).select().single();
    if (error) throw error;
    res.status(201).json({ goal: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/goals/:id
router.patch('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('goals').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ goal: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('goals').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
