const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/projects
router.get('/', async (req, res) => {
  try {
    const { goal_id, status } = req.query;
    let query = supabase.from('projects').select('*').order('created_at', { ascending: false });
    if (goal_id) query = query.eq('goal_id', goal_id);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ projects: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects
router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('projects').insert(req.body).select().single();
    if (error) throw error;
    res.status(201).json({ project: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/projects/:id
router.patch('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('projects').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ project: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('projects').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
