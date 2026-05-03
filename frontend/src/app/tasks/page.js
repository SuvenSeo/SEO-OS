'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { formatDate, priorityLabel } from '@/lib/utils';

const spring = { type: 'spring', stiffness: 300, damping: 30 };
const statusTabs = ['open', 'snoozed', 'done', 'cancelled'];
const priorityColors = {
  1: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/20' },
  2: { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/20' },
  3: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
  4: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/20' },
  5: { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/20' },
};

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('open');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 3, deadline: '' });

  useEffect(() => { loadTasks(); }, []);

  async function loadTasks() {
    try {
      const res = await api.tasks.list();
      setTasks(res.tasks || []);
    } catch (e) {
      console.error('Tasks load error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function createTask(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      await api.tasks.create({
        title: form.title,
        description: form.description || null,
        priority: parseInt(form.priority),
        deadline: form.deadline || null,
      });
      setForm({ title: '', description: '', priority: 3, deadline: '' });
      setShowModal(false);
      loadTasks();
    } catch (e) {
      console.error('Create task error:', e);
    }
  }

  async function updateStatus(id, status) {
    try {
      await api.tasks.update(id, { status });
      loadTasks();
    } catch (e) {
      console.error('Update error:', e);
    }
  }

  async function deleteTask(id) {
    try {
      await api.tasks.delete(id);
      loadTasks();
    } catch (e) {
      console.error('Delete error:', e);
    }
  }

  const filtered = tasks.filter(t => t.status === activeTab);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={spring}
        className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.04em]">Tasks</h1>
          <p className="text-[var(--text-muted)] mt-1">{tasks.filter(t => t.status === 'open').length} open · {tasks.filter(t => t.status === 'done').length} completed</p>
        </div>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={() => setShowModal(true)}
          className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors">
          + New Task
        </motion.button>
      </motion.div>

      {/* Status Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--bg-surface)] w-fit">
        {statusTabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              activeTab === tab ? 'bg-[var(--accent-muted)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-white'
            }`}>
            {tab} ({tasks.filter(t => t.status === tab).length})
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {loading ? (
          [1, 2, 3, 4].map(i => (
            <div key={i} className="h-20 rounded-xl bg-[var(--bg-surface)] animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-[var(--text-muted)]">No {activeTab} tasks.</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filtered.map((task, i) => {
              const pc = priorityColors[task.priority] || priorityColors[3];
              return (
                <motion.div key={task.id}
                  layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }} transition={{ ...spring, delay: i * 0.03 }}
                  className="glass-card p-5 group hover:border-[var(--border-hover)] transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${pc.bg} ${pc.text} border ${pc.border}`}>
                          P{task.priority}
                        </span>
                        <h3 className="text-sm font-medium truncate">{task.title}</h3>
                      </div>
                      {task.description && (
                        <p className="text-xs text-[var(--text-muted)] ml-[52px] line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 ml-[52px]">
                        {task.deadline && (
                          <span className="text-[10px] text-[var(--text-muted)]">Due: {formatDate(task.deadline)}</span>
                        )}
                        {task.follow_up_count > 0 && (
                          <span className="text-[10px] text-amber-400">Followed up {task.follow_up_count}x</span>
                        )}
                        <span className="text-[10px] text-[var(--text-muted)] capitalize">{task.source}</span>
                      </div>
                    </div>

                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {task.status === 'open' && (
                        <>
                          <button onClick={() => updateStatus(task.id, 'done')}
                            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
                            Done
                          </button>
                          <button onClick={() => updateStatus(task.id, 'snoozed')}
                            className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                            Snooze
                          </button>
                        </>
                      )}
                      {task.status !== 'open' && task.status !== 'done' && (
                        <button onClick={() => updateStatus(task.id, 'open')}
                          className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors">
                          Reopen
                        </button>
                      )}
                      <button onClick={() => deleteTask(task.id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                        Delete
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Create Task Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }} transition={spring}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md glass-card p-6 border border-[var(--border)]">
              <h2 className="text-xl font-bold tracking-[-0.03em] mb-6">New Task</h2>
              <form onSubmit={createTask} className="space-y-4">
                <div>
                  <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Title</label>
                  <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                    placeholder="What needs to be done?" autoFocus />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Description</label>
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none h-20"
                    placeholder="Optional details..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Priority</label>
                    <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white focus:outline-none focus:border-[var(--accent)] transition-colors">
                      <option value={1}>P1 — Critical</option>
                      <option value={2}>P2 — High</option>
                      <option value={3}>P3 — Medium</option>
                      <option value={4}>P4 — Low</option>
                      <option value={5}>P5 — Someday</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Deadline</label>
                    <input type="datetime-local" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white focus:outline-none focus:border-[var(--accent)] transition-colors" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    Cancel
                  </button>
                  <motion.button type="submit" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                    className="flex-1 px-4 py-3 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors">
                    Create Task
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
