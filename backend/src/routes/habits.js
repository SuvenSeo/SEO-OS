const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/habits
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase.from('habits').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ habits: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/habits
router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('habits').insert(req.body).select().single();
    if (error) throw error;
    res.status(201).json({ habit: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/habits/:id
router.patch('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('habits').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ habit: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/habits/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('habits').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
