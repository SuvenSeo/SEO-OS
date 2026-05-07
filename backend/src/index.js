require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Route imports
const telegramRoutes = require('./routes/telegram');
const taskRoutes = require('./routes/tasks');
const memoryRoutes = require('./routes/memory');
const reminderRoutes = require('./routes/reminders');
const ideaRoutes = require('./routes/ideas');
const patternRoutes = require('./routes/patterns');
const configRoutes = require('./routes/config');
const chatRoutes = require('./routes/chat');
const knowledgeRoutes = require('./routes/knowledge');
const proactiveRoutes = require('./routes/proactive');
const auditLogRoutes = require('./routes/audit-log');
const goalRoutes = require('./routes/goals');
const projectRoutes = require('./routes/projects');
const habitRoutes = require('./routes/habits');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));

// ── Health Check ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'alive',
    service: 'SEOS Backend',
    timestamp: new Date().toISOString(),
  });
});

// ── Routes ─────────────────────────────────────────────────
// Telegram webhook (matches setWebhook URL)
app.use('/api/telegram', telegramRoutes);

// API routes (auth protected)
app.use('/api/tasks', taskRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/ideas', ideaRoutes);
app.use('/api/patterns', patternRoutes);
app.use('/api/config', configRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/proactive', proactiveRoutes);
app.use('/api/audit-log', auditLogRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/habits', habitRoutes);

// ── 404 Handler ────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global Error Handler ───────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[SEOS Error]', err.message);
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start Server ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  SEOS Backend — Running on :${PORT}   ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

module.exports = app;
