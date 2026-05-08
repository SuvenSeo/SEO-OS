'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

export default function KnowledgePage() {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const params = { page: String(page), limit: '30' };
      if (search) params.search = search;
      if (sourceFilter) params.source = sourceFilter;
      const res = await api.knowledge.list(params);
      setEntries(res.entries || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('Failed to load knowledge:', err);
    }
    setLoading(false);
  };

  useEffect(() => { loadEntries(); }, [page, sourceFilter]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadEntries();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this knowledge entry?')) return;
    try {
      await api.knowledge.delete(id);
      setEntries(entries.filter(e => e.id !== id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const sources = [...new Set(entries.map(e => e.source))].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        <span className="text-sm text-[var(--text-secondary)]">{total} entries</span>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search knowledge..."
          className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
        />
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm"
        >
          <option value="">All Sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit" className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
          Search
        </button>
      </form>

      {loading ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">No knowledge entries found.</div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {entries.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                        {entry.source}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {entry.embedding_summary && (
                      <p className="text-sm font-medium mb-1">{entry.embedding_summary}</p>
                    )}
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-3">
                      {entry.content}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="text-xs text-[var(--text-secondary)] hover:text-red-500 transition-colors shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {total > 30 && (
        <div className="flex justify-center gap-3">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 text-sm rounded-lg border border-[var(--border)] disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-sm py-1">Page {page} of {Math.ceil(total / 30)}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(total / 30)}
            className="px-3 py-1 text-sm rounded-lg border border-[var(--border)] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
