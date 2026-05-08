'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

export default function JournalPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEntry, setNewEntry] = useState('');
  const [creating, setCreating] = useState(false);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const res = await api.journal.list({ limit: '50' });
      setEntries(res.entries || []);
    } catch (err) {
      console.error('Failed to load journal:', err);
    }
    setLoading(false);
  };

  useEffect(() => { loadEntries(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newEntry.trim()) return;
    setCreating(true);
    try {
      const res = await api.journal.create({ type: 'free', content: newEntry.trim() });
      setEntries([res.entry, ...entries]);
      setNewEntry('');
    } catch (err) {
      console.error('Failed to create entry:', err);
    }
    setCreating(false);
  };

  const groupByDate = (items) => {
    const groups = {};
    items.forEach(item => {
      const date = new Date(item.created_at).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      if (!groups[date]) groups[date] = [];
      groups[date].push(item);
    });
    return groups;
  };

  const grouped = groupByDate(entries);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Journal</h1>

      <form onSubmit={handleCreate} className="space-y-3">
        <textarea
          value={newEntry}
          onChange={(e) => setNewEntry(e.target.value)}
          placeholder="Write anything... thoughts, reflections, plans..."
          rows={3}
          className="w-full px-4 py-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating || !newEntry.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {creating ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </form>

      {loading ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">No journal entries yet. Start writing above.</div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">{date}</h3>
              <div className="space-y-3">
                <AnimatePresence>
                  {items.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                          {entry.type || 'free'}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">
                          {new Date(entry.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {entry.mood && (
                          <span className="text-xs text-[var(--text-secondary)]">
                            Mood: {entry.mood}
                          </span>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
