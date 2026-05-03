'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/utils';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

export default function MemoryPage() {
  const [coreMemory, setCoreMemory] = useState([]);
  const [workingMemory, setWorkingMemory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editKey, setEditKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { loadMemory(); }, []);

  async function loadMemory() {
    try {
      const [coreRes, workingRes] = await Promise.all([
        api.memory.core(),
        api.memory.working(),
      ]);
      setCoreMemory(coreRes.memory || []);
      setWorkingMemory(workingRes.memory || []);
    } catch (e) {
      console.error('Memory load error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit(key) {
    try {
      await api.memory.updateCore(key, editValue);
      setEditKey(null);
      loadMemory();
    } catch (e) {
      console.error('Save error:', e);
    }
  }

  async function addMemory(e) {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      await api.memory.updateCore(newKey, newValue);
      setNewKey('');
      setNewValue('');
      setShowAdd(false);
      loadMemory();
    } catch (e) {
      console.error('Add error:', e);
    }
  }

  async function deleteCore(key) {
    try {
      await api.memory.deleteCore(key);
      loadMemory();
    } catch (e) {
      console.error('Delete error:', e);
    }
  }

  async function deleteWorking(id) {
    try {
      await api.memory.deleteWorking(id);
      loadMemory();
    } catch (e) {
      console.error('Delete error:', e);
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Memory</h1>
        <p className="text-[var(--text-muted)] mt-1">What SEOS knows about you</p>
      </motion.div>

      {/* Core Memory */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.1 }}
        className="glass-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold tracking-[-0.02em] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            Core Memory
            <span className="text-xs text-[var(--text-muted)] font-normal ml-2">Persistent</span>
          </h2>
          <button onClick={() => setShowAdd(!showAdd)}
            className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors">
            + Add
          </button>
        </div>

        {showAdd && (
          <motion.form initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            onSubmit={addMemory} className="flex gap-3 mb-4">
            <input type="text" value={newKey} onChange={e => setNewKey(e.target.value)}
              placeholder="Key" className="w-40 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
            <input type="text" value={newValue} onChange={e => setNewValue(e.target.value)}
              placeholder="Value" className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
            <button type="submit" className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-medium">Save</button>
          </motion.form>
        )}

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-[var(--bg-surface-hover)] animate-pulse" />)}</div>
        ) : coreMemory.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm py-6 text-center">Core memory is empty. Start chatting to build it.</p>
        ) : (
          <div className="space-y-1">
            {coreMemory.map((mem, i) => (
              <motion.div key={mem.key}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring, delay: i * 0.03 }}
                className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-[var(--bg-surface-hover)] transition-colors group">
                <span className="text-xs font-mono text-[var(--accent)] w-32 shrink-0 truncate font-medium">{mem.key}</span>
                {editKey === mem.key ? (
                  <div className="flex-1 flex gap-2">
                    <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--accent)] text-sm text-white focus:outline-none"
                      autoFocus onKeyDown={e => e.key === 'Enter' && saveEdit(mem.key)} />
                    <button onClick={() => saveEdit(mem.key)}
                      className="text-xs px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400">Save</button>
                    <button onClick={() => setEditKey(null)}
                      className="text-xs px-3 py-1 rounded-lg bg-zinc-500/10 text-zinc-400">Cancel</button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-[var(--text-secondary)] truncate">{mem.value}</span>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditKey(mem.key); setEditValue(mem.value); }}
                        className="text-xs px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400">Edit</button>
                      <button onClick={() => deleteCore(mem.key)}
                        className="text-xs px-2 py-1 rounded-lg bg-red-500/10 text-red-400">Delete</button>
                    </div>
                  </>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Working Memory */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.2 }}
        className="glass-card p-6">
        <h2 className="text-lg font-semibold tracking-[-0.02em] mb-5 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          Working Memory
          <span className="text-xs text-[var(--text-muted)] font-normal ml-2">Ephemeral</span>
        </h2>

        {loading ? (
          <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-12 rounded-lg bg-[var(--bg-surface-hover)] animate-pulse" />)}</div>
        ) : workingMemory.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm py-6 text-center">No active working memory.</p>
        ) : (
          <div className="space-y-1">
            {workingMemory.map((mem, i) => (
              <motion.div key={mem.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring, delay: i * 0.03 }}
                className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-[var(--bg-surface-hover)] transition-colors group">
                <span className="text-xs font-mono text-blue-400 w-32 shrink-0 truncate font-medium">{mem.key}</span>
                <span className="flex-1 text-sm text-[var(--text-secondary)] truncate">{mem.value}</span>
                {mem.expires_at && (
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">Expires: {formatRelative(mem.expires_at)}</span>
                )}
                <button onClick={() => deleteWorking(mem.id)}
                  className="text-xs px-2 py-1 rounded-lg bg-red-500/10 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Delete
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
