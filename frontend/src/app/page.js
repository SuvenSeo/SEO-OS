'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { formatRelative, priorityLabel } from '@/lib/utils';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [ideas, setIdeas] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      const [tasksRes, remindersRes, ideasRes] = await Promise.all([
        api.tasks.list({ status: 'open' }),
        api.reminders.list({ fired: 'false' }),
        api.ideas.list({ status: 'raw' }),
      ]);
      setTasks(tasksRes.tasks || []);
      setReminders(remindersRes.reminders || []);
      setIdeas(ideasRes.ideas || []);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleChat(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setChatLoading(true);
    setChatResponse('');
    try {
      const res = await api.chat.send(chatInput);
      setChatResponse(res.response);
      setChatInput('');
      loadDashboard(); // Refresh in case tasks/ideas were auto-detected
    } catch (e) {
      setChatResponse('Error: ' + e.message);
    } finally {
      setChatLoading(false);
    }
  }

  async function markDone(id) {
    try {
      await api.tasks.update(id, { status: 'done' });
      setTasks(tasks.filter(t => t.id !== id));
    } catch (e) {
      console.error('Mark done error:', e);
    }
  }

  const dueToday = tasks.filter(t => {
    if (!t.deadline) return false;
    const dl = new Date(t.deadline);
    const today = new Date();
    return dl.toDateString() === today.toDateString();
  });

  const stats = [
    { label: 'Open Tasks', value: tasks.length, color: 'var(--accent)' },
    { label: 'Due Today', value: dueToday.length, color: '#f59e0b' },
    { label: 'Reminders', value: reminders.length, color: '#3b82f6' },
    { label: 'Raw Ideas', value: ideas.length, color: '#a855f7' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Command Center</h1>
        <p className="text-[var(--text-muted)] mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </motion.div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.05 }}
            className="glass-card p-5 group cursor-default"
          >
            <p className="text-sm text-[var(--text-muted)] mb-1">{stat.label}</p>
            <p className="text-3xl font-bold tracking-[-0.04em]" style={{ color: stat.color }}>
              {loading ? '—' : stat.value}
            </p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Today's Tasks */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.2 }}
          className="col-span-2 glass-card p-6"
        >
          <h2 className="text-lg font-semibold tracking-[-0.02em] mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            Open Tasks
          </h2>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 rounded-xl bg-[var(--bg-surface-hover)] animate-pulse" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm py-8 text-center">No open tasks. Suspiciously clean.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {tasks.slice(0, 10).map((task, i) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring, delay: i * 0.03 }}
                  className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] transition-colors group"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`text-xs font-mono font-bold priority-${task.priority}`}>
                      P{task.priority}
                    </span>
                    <span className="text-sm truncate">{task.title}</span>
                    {task.deadline && (
                      <span className="text-xs text-[var(--text-muted)] shrink-0">
                        {formatRelative(task.deadline)}
                      </span>
                    )}
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => markDone(task.id)}
                    className="opacity-0 group-hover:opacity-100 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all"
                  >
                    Done
                  </motion.button>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Active Reminders */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.3 }}
          className="glass-card p-6"
        >
          <h2 className="text-lg font-semibold tracking-[-0.02em] mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            Reminders
          </h2>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="h-14 rounded-xl bg-[var(--bg-surface-hover)] animate-pulse" />
              ))}
            </div>
          ) : reminders.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm py-8 text-center">No upcoming reminders.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {reminders.slice(0, 8).map((r) => (
                <div
                  key={r.id}
                  className="px-4 py-3 rounded-xl bg-[var(--bg-surface)] text-sm"
                >
                  <p className="text-white truncate">{r.message}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {new Date(r.trigger_at).toLocaleString('en-US', {
                      timeZone: 'Asia/Colombo', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                    {r.repeat_interval && ` · ${r.repeat_interval}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Quick Chat */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.4 }}
        className="glass-card p-6"
      >
        <h2 className="text-lg font-semibold tracking-[-0.02em] mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
          Quick Chat
        </h2>

        {chatResponse && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 px-4 py-3 rounded-xl bg-[var(--bg-surface)] text-sm text-[var(--text-secondary)] whitespace-pre-wrap"
          >
            {chatResponse}
          </motion.div>
        )}

        <form onSubmit={handleChat} className="flex gap-3">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Talk to SEOS..."
            className="flex-1 px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            disabled={chatLoading}
          />
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={chatLoading}
            className="px-6 py-3 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
          >
            {chatLoading ? 'Thinking...' : 'Send'}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
}
