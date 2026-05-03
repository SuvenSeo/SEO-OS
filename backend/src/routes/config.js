const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/config — get all config
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('agent_config').select('*').order('key');
    if (error) throw error;
    res.json({ config: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// GET /api/config/:key — get specific config
router.get('/:key', async (req, res) => {
  try {
    const { data, error } = await supabase.from('agent_config').select('*')
      .eq('key', req.params.key).single();
    if (error) throw error;
    res.json({ config: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// PUT /api/config/:key — upsert config value
router.put('/:key', async (req, res) => {
  try {
    const { value } = req.body;
    if (!value) return res.status(400).json({ error: 'Value is required' });

    const { data, error } = await supabase.from('agent_config')
      .upsert({ key: req.params.key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select().single();
    if (error) throw error;
    res.json({ config: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update config' });
  }
});

module.exports = router;
