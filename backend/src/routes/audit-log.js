const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

router.use(auth);

// ── GET /api/audit-log ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('applied_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ logs: data });
  } catch (error) {
    console.error('[AuditLog] GET error:', error.message);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// ── POST /api/audit-log ────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { proposed_change, approved, reason } = req.body;

    if (!proposed_change) {
      return res.status(400).json({ error: 'proposed_change is required' });
    }

    const { data, error } = await supabase
      .from('audit_log')
      .insert({
        proposed_change,
        approved: approved === true,
        applied_at: new Date().toISOString(),
        reason: reason || null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ log: data });
  } catch (error) {
    console.error('[AuditLog] POST error:', error.message);
    res.status(500).json({ error: 'Failed to create audit log entry' });
  }
});

module.exports = router;
