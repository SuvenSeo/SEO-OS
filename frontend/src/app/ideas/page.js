'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

const statusConfig = {
  raw: { label: 'Raw', bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
  explored: { label: 'Explored', bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/20' },
  actioned: { label: 'Actioned', bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  discarded: { label: 'Discarded', bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/20' },
};

export default function IdeasPage() {
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newIdea, setNewIdea] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => { loadIdeas(); }, []);

  async function loadIdeas() {
    try {
      const res = await api.ideas.list();
      setIdeas(res.ideas || []);
    } catch (e) {
      console.error('Ideas load error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function addIdea(e) {
    e.preventDefault();
    if (!newIdea.trim()) return;
    try {
      await api.ideas.create({ content: newIdea });
      setNewIdea('');
      loadIdeas();
    } catch (e) {
      console.error('Add idea error:', e);
    }
  }

  async function updateStatus(id, status) {
    try {
      await api.ideas.update(id, { status });
      loadIdeas();
    } catch (e) {
      console.error('Update error:', e);
    }
  }

  async function deleteIdea(id) {
    try {
      await api.ideas.delete(id);
      loadIdeas();
    } catch (e) {
      console.error('Delete error:', e);
    }
  }

  const filtered = filter === 'all' ? ideas : ideas.filter(i => i.status === filter);

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Ideas</h1>
        <p className="text-[var(--text-muted)] mt-1">{ideas.filter(i => i.status === 'raw').length} raw ideas in the pipeline</p>
      </motion.div>

      {/* Add Idea */}
      <motion.form initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.1 }}
        onSubmit={addIdea} className="flex gap-3">
        <input type="text" value={newIdea} onChange={e => setNewIdea(e.target.value)}
          placeholder="Capture a new idea..."
          className="flex-1 px-5 py-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors" />
        <motion.button type="submit" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          className="px-6 py-3.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors">
          + Add
        </motion.button>
      </motion.form>

      {/* Filter */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--bg-surface)] w-fit">
        {['all', 'raw', 'explored', 'actioned', 'discarded'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              filter === f ? 'bg-[var(--accent-muted)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-white'
            }`}>
            {f}
          </button>
        ))}
      </div>

      {/* Ideas Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 rounded-xl bg-[var(--bg-surface)] animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-[var(--text-muted)]">No ideas here yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((idea, i) => {
              const sc = statusConfig[idea.status];
              return (
                <motion.div key={idea.id} layout
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }} transition={{ ...spring, delay: i * 0.03 }}
                  className="glass-card p-5 group">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${sc.bg} ${sc.text} border ${sc.border}`}>
                      {sc.label}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">{formatRelative(idea.created_at)}</span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mb-4 line-clamp-3">{idea.content}</p>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {idea.status === 'raw' && (
                      <>
                        <button onClick={() => updateStatus(idea.id, 'explored')}
                          className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400">Explore</button>
                        <button onClick={() => updateStatus(idea.id, 'actioned')}
                          className="text-[10px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">Action</button>
                      </>
                    )}
                    <button onClick={() => updateStatus(idea.id, 'discarded')}
                      className="text-[10px] px-2 py-1 rounded bg-zinc-500/10 text-zinc-400">Discard</button>
                    <button onClick={() => deleteIdea(idea.id)}
                      className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 ml-auto">Delete</button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
