const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

// All routes require auth
router.use(auth);

// ── GET /api/tasks ─────────────────────────────────────────
// List tasks with optional filters: status, priority
router.get('/', async (req, res) => {
  try {
    const { status, priority, limit = 50 } = req.query;

    let query = supabase
      .from('tasks')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', parseInt(priority));

    const { data, error } = await query;
    if (error) throw error;

    res.json({ tasks: data });
  } catch (error) {
    console.error('[Tasks] GET error:', error.message);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// ── POST /api/tasks ────────────────────────────────────────
// Create a new task
router.post('/', async (req, res) => {
  try {
    const { title, description, deadline, priority, source, tier, tier_reason } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title,
        description: description || null,
        deadline: deadline || null,
        priority: priority || 3,
        status: 'open',
        source: source || 'web',
        tier: tier || 3,
        tier_reason: tier_reason || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ task: data });
  } catch (error) {
    console.error('[Tasks] POST error:', error.message);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// ── PATCH /api/tasks/:id ───────────────────────────────────
// Update a task (status, priority, description, deadline)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};

    const allowedFields = ['title', 'description', 'deadline', 'priority', 'status', 'tier', 'tier_reason'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ task: data });
  } catch (error) {
    console.error('[Tasks] PATCH error:', error.message);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// ── DELETE /api/tasks/:id ──────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('[Tasks] DELETE error:', error.message);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;
