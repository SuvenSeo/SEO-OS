const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// ── GET /api/memory/core ───────────────────────────────────
router.get('/core', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('core_memory')
      .select('*')
      .order('key');

    if (error) throw error;
    res.json({ memory: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch core memory' });
  }
});

// ── PUT /api/memory/core/:key ──────────────────────────────
// Upsert a core memory key-value pair
router.put('/core/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!value) {
      return res.status(400).json({ error: 'Value is required' });
    }

    const { data, error } = await supabase
      .from('core_memory')
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
      .select()
      .single();

    if (error) throw error;
    res.json({ memory: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update core memory' });
  }
});

// ── DELETE /api/memory/core/:key ───────────────────────────
router.delete('/core/:key', async (req, res) => {
  try {
    const { error } = await supabase
      .from('core_memory')
      .delete()
      .eq('key', req.params.key);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete core memory' });
  }
});

// ── GET /api/memory/working ────────────────────────────────
router.get('/working', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('working_memory')
      .select('*')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ memory: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch working memory' });
  }
});

// ── POST /api/memory/working ───────────────────────────────
router.post('/working', async (req, res) => {
  try {
    const { key, value, expires_at } = req.body;

    if (!key || !value) {
      return res.status(400).json({ error: 'Key and value are required' });
    }

    const { data, error } = await supabase
      .from('working_memory')
      .insert({ key, value, expires_at: expires_at || null })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ memory: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create working memory' });
  }
});

// ── DELETE /api/memory/working/:id ─────────────────────────
router.delete('/working/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('working_memory')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete working memory' });
  }
});

module.exports = router;
