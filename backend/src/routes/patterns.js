const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// GET /api/patterns
router.get('/', async (req, res) => {
  try {
    const { confidence, limit = 50 } = req.query;
    let query = supabase.from('patterns').select('*')
      .order('created_at', { ascending: false }).limit(parseInt(limit));
    if (confidence) query = query.eq('confidence', confidence);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ patterns: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch patterns' });
  }
});

module.exports = router;
