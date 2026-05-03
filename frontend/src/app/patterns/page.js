'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

const confidenceConfig = {
  low: { color: 'text-zinc-400', bg: 'bg-zinc-500/15', border: 'border-zinc-500/20', dot: 'bg-zinc-400' },
  medium: { color: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500/20', dot: 'bg-amber-400' },
  high: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
};

export default function PatternsPage() {
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.patterns.list();
        setPatterns(res.patterns || []);
      } catch (e) {
        console.error('Patterns load error:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Patterns</h1>
        <p className="text-[var(--text-muted)] mt-1">Behavioral observations detected by SEOS over time</p>
      </motion.div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-20 rounded-xl bg-[var(--bg-surface)] animate-pulse" />
          ))}
        </div>
      ) : patterns.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="text-4xl mb-4">📊</div>
          <p className="text-[var(--text-muted)]">No patterns detected yet.</p>
          <p className="text-xs text-[var(--text-muted)] mt-2">Patterns emerge from ongoing conversations and task tracking.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-[var(--border)]" />

          <div className="space-y-4">
            {patterns.map((pattern, i) => {
              const cc = confidenceConfig[pattern.confidence] || confidenceConfig.medium;
              return (
                <motion.div key={pattern.id}
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring, delay: i * 0.05 }}
                  className="relative pl-12"
                >
                  {/* Timeline dot */}
                  <div className={`absolute left-[14px] top-5 w-3 h-3 rounded-full ${cc.dot} ring-4 ring-[var(--bg-primary)]`} />

                  <div className="glass-card p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${cc.bg} ${cc.color} border ${cc.border}`}>
                        {pattern.confidence} confidence
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">{formatRelative(pattern.created_at)}</span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{pattern.observation}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
