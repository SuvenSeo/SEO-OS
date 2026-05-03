const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/knowledge
router.get('/', async (req, res) => {
  try {
    const { source, limit = 50 } = req.query;
    let query = supabase.from('knowledge_base').select('*')
      .order('created_at', { ascending: false }).limit(parseInt(limit));
    if (source) query = query.eq('source', source);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ knowledge: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch knowledge' });
  }
});

module.exports = router;
