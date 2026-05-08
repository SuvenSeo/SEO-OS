'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { motion } from 'framer-motion';

export default function AnalyticsPage() {
  const [data, setData] = useState({
    tasks: { open: 0, done: 0, snoozed: 0 },
    reminders: { pending: 0, fired: 0 },
    moods: [],
    patterns: [],
    expenses: { total: 0, byCategory: {} },
    goals: [],
    habits: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [tasksRes, remindersRes, moodRes, patternsRes, expensesRes, goalsRes, habitsRes] = await Promise.allSettled([
          api.tasks.list(),
          api.reminders.list(),
          api.mood.list({ limit: '100' }),
          api.patterns.list({ limit: '20' }),
          api.expenses.list({ limit: '100' }),
          api.goals.list(),
          api.habits.list(),
        ]);

        const tasks = tasksRes.status === 'fulfilled' ? (tasksRes.value.tasks || tasksRes.value || []) : [];
        const reminders = remindersRes.status === 'fulfilled' ? (remindersRes.value.reminders || remindersRes.value || []) : [];
        const moods = moodRes.status === 'fulfilled' ? (moodRes.value.moods || []) : [];
        const patterns = patternsRes.status === 'fulfilled' ? (patternsRes.value.patterns || patternsRes.value || []) : [];
        const expenses = expensesRes.status === 'fulfilled' ? (expensesRes.value.expenses || []) : [];
        const goals = goalsRes.status === 'fulfilled' ? (goalsRes.value.goals || goalsRes.value || []) : [];
        const habits = habitsRes.status === 'fulfilled' ? (habitsRes.value.habits || habitsRes.value || []) : [];

        const expenseTotal = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
        const byCategory = {};
        expenses.forEach(e => {
          byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0);
        });

        setData({
          tasks: {
            open: tasks.filter(t => t.status === 'open').length,
            done: tasks.filter(t => t.status === 'done').length,
            snoozed: tasks.filter(t => t.status === 'snoozed').length,
          },
          reminders: {
            pending: reminders.filter(r => !r.fired).length,
            fired: reminders.filter(r => r.fired).length,
          },
          moods,
          patterns,
          expenses: { total: expenseTotal, byCategory },
          goals,
          habits,
        });
      } catch (err) {
        console.error('Analytics load error:', err);
      }
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="text-center py-12 text-[var(--text-secondary)]">Loading analytics...</div>;

  const moodCounts = {};
  data.moods.forEach(m => { moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1; });
  const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Open Tasks', value: data.tasks.open, color: 'text-orange-400' },
          { label: 'Tasks Done', value: data.tasks.done, color: 'text-green-400' },
          { label: 'Snoozed', value: data.tasks.snoozed, color: 'text-yellow-400' },
          { label: 'Pending Reminders', value: data.reminders.pending, color: 'text-blue-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
          >
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Mood + Expenses Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Mood Summary */}
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <h3 className="font-medium mb-3">Mood Distribution</h3>
          {Object.keys(moodCounts).length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No mood data yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).map(([mood, count]) => (
                <div key={mood} className="flex items-center gap-3">
                  <span className="text-sm w-24 capitalize">{mood}</span>
                  <div className="flex-1 h-2 bg-[var(--border)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${(count / data.moods.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] w-8 text-right">{count}</span>
                </div>
              ))}
              {topMood && (
                <p className="text-xs text-[var(--text-secondary)] mt-2">
                  Dominant mood: <strong className="text-[var(--text-primary)] capitalize">{topMood[0]}</strong>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Expenses */}
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <h3 className="font-medium mb-3">Expenses</h3>
          <p className="text-2xl font-bold text-[var(--accent)] mb-3">Rs. {data.expenses.total.toLocaleString()}</p>
          {Object.keys(data.expenses.byCategory).length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No expenses logged yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(data.expenses.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{cat}</span>
                  <span className="text-[var(--text-secondary)]">Rs. {amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Goals Progress */}
      {data.goals.length > 0 && (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <h3 className="font-medium mb-3">Goal Progress</h3>
          <div className="space-y-3">
            {data.goals.filter(g => g.status === 'active').map(g => (
              <div key={g.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{g.title}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{g.progress || 0}%</span>
                </div>
                <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${g.progress || 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Habit Streaks */}
      {data.habits.length > 0 && (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <h3 className="font-medium mb-3">Habit Streaks</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {data.habits.filter(h => h.status === 'active').map(h => (
              <div key={h.id} className="text-center p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                <p className="text-xl font-bold text-orange-400">{h.current_streak || 0}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">{h.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Patterns */}
      {data.patterns.length > 0 && (
        <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <h3 className="font-medium mb-3">Recent Patterns</h3>
          <div className="space-y-2">
            {data.patterns.slice(0, 10).map((p, i) => (
              <div key={p.id || i} className="text-sm text-[var(--text-secondary)]">
                <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] mr-2">
                  {p.confidence || 'medium'}
                </span>
                {p.observation}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
