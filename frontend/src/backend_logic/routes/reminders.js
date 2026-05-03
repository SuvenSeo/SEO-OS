const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { sendMessage } = require('../services/telegram');
const auth = require('../middleware/auth');

router.use(auth);

// ── GET /api/reminders ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { fired } = req.query;

    let query = supabase
      .from('reminders')
      .select('*')
      .order('trigger_at', { ascending: true });

    if (fired !== undefined) {
      query = query.eq('fired', fired === 'true');
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ reminders: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// ── POST /api/reminders ────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { message, trigger_at, tier, tier_reason } = req.body;

    if (!message || !trigger_at) {
      return res.status(400).json({ error: 'Message and trigger_at are required' });
    }

    const { data, error } = await supabase
      .from('reminders')
      .insert({
        message,
        trigger_at,
        tier: tier || 3,
        tier_reason: tier_reason || null,
        fired: false,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ reminder: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// ── DELETE /api/reminders/:id ──────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('reminders')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

module.exports = router;
