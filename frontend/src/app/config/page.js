'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

export default function ConfigPage() {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingAudit, setPendingAudit] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [wakingStart, setWakingStart] = useState('8');
  const [wakingEnd, setWakingEnd] = useState('22');
  const [savingWaking, setSavingWaking] = useState(false);
  const [wakingSaved, setWakingSaved] = useState(false);

  useEffect(() => { loadConfig(); }, []);

  async function loadConfig() {
    try {
      const [promptRes, workingRes, wakingStartRes, wakingEndRes, logsRes] = await Promise.all([
        api.config.get('system_prompt'),
        api.memory.working(),
        api.config.get('waking_hours_start').catch(() => ({ config: { value: '8' } })),
        api.config.get('waking_hours_end').catch(() => ({ config: { value: '22' } })),
        api.auditLog.list().catch(() => ({ logs: [] })),
      ]);

      const prompt = promptRes.config?.value || '';
      setSystemPrompt(prompt);
      setOriginalPrompt(prompt);
      setWakingStart(wakingStartRes.config?.value || '8');
      setWakingEnd(wakingEndRes.config?.value || '22');
      setAuditLogs(logsRes.logs || []);

      // Check for pending self-audit in working memory
      const audit = (workingRes.memory || []).find(m => m.key === 'pending_self_audit');
      if (audit) setPendingAudit(audit);
    } catch (e) {
      console.error('Config load error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function savePrompt() {
    setSaving(true);
    try {
      await api.config.update('system_prompt', systemPrompt);
      setOriginalPrompt(systemPrompt);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Save error:', e);
    } finally {
      setSaving(false);
    }
  }

  async function saveWakingHours() {
    setSavingWaking(true);
    try {
      await Promise.all([
        api.config.update('waking_hours_start', wakingStart),
        api.config.update('waking_hours_end', wakingEnd),
      ]);
      setWakingSaved(true);
      setTimeout(() => setWakingSaved(false), 2000);
    } catch (e) {
      console.error('Waking hours save error:', e);
    } finally {
      setSavingWaking(false);
    }
  }

  async function approveAudit() {
    if (!pendingAudit) return;
    try {
      const auditText = pendingAudit.value;
      const promptMatch = auditText.match(/UPDATED PROMPT:\s*([\s\S]+)$/i);
      if (promptMatch) {
        const newPrompt = promptMatch[1].trim();
        await api.config.update('system_prompt', newPrompt);
        setSystemPrompt(newPrompt);
        setOriginalPrompt(newPrompt);
      }
      // Log the approval
      await api.auditLog.create({
        proposed_change: auditText.substring(0, 1000),
        approved: true,
        reason: 'Approved from /config dashboard',
      });
      await api.memory.deleteWorking(pendingAudit.id);
      setPendingAudit(null);
      loadConfig(); // Refresh audit log
    } catch (e) {
      console.error('Approve audit error:', e);
    }
  }

  async function rejectAudit() {
    if (!pendingAudit) return;
    try {
      // Log the rejection
      await api.auditLog.create({
        proposed_change: pendingAudit.value.substring(0, 1000),
        approved: false,
        reason: 'Rejected from /config dashboard',
      });
      await api.memory.deleteWorking(pendingAudit.id);
      setPendingAudit(null);
      loadConfig();
    } catch (e) {
      console.error('Reject audit error:', e);
    }
  }

  const hasChanges = systemPrompt !== originalPrompt;

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Configuration</h1>
        <p className="text-[var(--text-muted)] mt-1">Edit SEOS&apos;s brain directly</p>
      </motion.div>

      {/* Pending Self-Audit */}
      <AnimatePresence>
        {pendingAudit && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={spring} className="glass-card p-6 border border-amber-500/20">
            <h2 className="text-lg font-semibold tracking-[-0.02em] mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Pending Self-Audit Proposal
            </h2>
            <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4 max-h-64 overflow-y-auto">
              <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
                {pendingAudit.value}
              </pre>
            </div>
            <div className="flex gap-3">
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={approveAudit}
                className="px-5 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-sm font-medium hover:bg-emerald-500/25 transition-colors">
                Approve & Apply
              </motion.button>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={rejectAudit}
                className="px-5 py-2.5 rounded-xl bg-red-500/15 text-red-400 border border-red-500/20 text-sm font-medium hover:bg-red-500/25 transition-colors">
                Reject
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* System Prompt Editor */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.1 }} className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tracking-[-0.02em] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
            System Prompt
          </h2>
          <div className="flex items-center gap-3">
            {saved && (
              <motion.span initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                className="text-xs text-emerald-400">
                Saved successfully
              </motion.span>
            )}
            {hasChanges && <span className="text-xs text-amber-400">Unsaved changes</span>}
          </div>
        </div>

        {loading ? (
          <div className="h-96 rounded-xl bg-[var(--bg-surface-hover)] animate-pulse" />
        ) : (
          <>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full h-[500px] px-5 py-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border)] text-sm text-[var(--text-secondary)] font-mono leading-relaxed resize-none focus:outline-none focus:border-[var(--accent)] transition-colors"
              spellCheck={false}
            />
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-[var(--text-muted)]">
                {systemPrompt.length} characters · Sent with every AI interaction
              </p>
              <div className="flex gap-3">
                {hasChanges && (
                  <button onClick={() => setSystemPrompt(originalPrompt)}
                    className="px-4 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                    Discard
                  </button>
                )}
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={savePrompt} disabled={!hasChanges || saving}
                  className="px-6 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {saving ? 'Saving...' : 'Save Changes'}
                </motion.button>
              </div>
            </div>
          </>
        )}
      </motion.div>

      {/* Waking Hours */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.15 }} className="glass-card p-6">
        <h2 className="text-lg font-semibold tracking-[-0.02em] mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          Waking Hours
          <span className="text-xs text-[var(--text-muted)] font-normal ml-2">Controls Tier 2 reminder frequency</span>
        </h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">From</label>
            <input type="number" min="0" max="23" value={wakingStart}
              onChange={e => setWakingStart(e.target.value)}
              className="w-20 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white text-center focus:outline-none focus:border-[var(--accent)] transition-colors" />
            <span className="text-xs text-[var(--text-muted)]">:00</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">To</label>
            <input type="number" min="0" max="23" value={wakingEnd}
              onChange={e => setWakingEnd(e.target.value)}
              className="w-20 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white text-center focus:outline-none focus:border-[var(--accent)] transition-colors" />
            <span className="text-xs text-[var(--text-muted)]">:00</span>
          </div>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={saveWakingHours} disabled={savingWaking}
            className="px-5 py-2 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/20 text-sm font-medium hover:bg-blue-500/25 transition-colors disabled:opacity-40">
            {savingWaking ? 'Saving...' : wakingSaved ? '✓ Saved' : 'Update'}
          </motion.button>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-3">
          Current: {wakingStart}:00 — {wakingEnd}:00 IST. Tier 2 reminders only fire during this window.
        </p>
      </motion.div>

      {/* Audit History */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.2 }} className="glass-card p-6">
        <h2 className="text-lg font-semibold tracking-[-0.02em] mb-5 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          Self-Audit History
          <span className="text-xs text-[var(--text-muted)] font-normal ml-2">How the agent has evolved</span>
        </h2>

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg bg-[var(--bg-surface-hover)] animate-pulse" />)}</div>
        ) : auditLogs.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm py-6 text-center">
            No audit history yet. SEOS will propose changes every Sunday at 9pm IST.
          </p>
        ) : (
          <div className="space-y-3">
            {auditLogs.map((log, i) => (
              <motion.div key={log.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring, delay: i * 0.04 }}
                className="flex items-start gap-4 px-4 py-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <span className={`mt-0.5 shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                  log.approved
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : 'bg-red-500/15 text-red-400 border border-red-500/20'
                }`}>
                  {log.approved ? 'Applied' : 'Rejected'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                    {log.proposed_change}
                  </p>
                  {log.reason && (
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">{log.reason}</p>
                  )}
                </div>
                <span className="text-[10px] text-[var(--text-muted)] shrink-0 tabular-nums">
                  {new Date(log.applied_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric'
                  })}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Info Cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { title: 'Model', value: 'llama-3.3-70b-versatile', desc: 'Via Groq API' },
          { title: 'Proactive Jobs', value: '6 active', desc: 'Morning brief, evening check-in, reminders, accountability, weekly review, self-audit' },
          { title: 'Self-Audit', value: 'Weekly', desc: 'Every Sunday at 9pm IST. Proposals logged here.' },
        ].map((card, i) => (
          <motion.div key={card.title}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.3 + i * 0.05 }}
            className="glass-card p-5">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">{card.title}</p>
            <p className="text-sm font-medium mb-1">{card.value}</p>
            <p className="text-xs text-[var(--text-muted)]">{card.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
