'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

export default function HabitsPage() {
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');

  useEffect(() => { loadHabits(); }, []);

  async function loadHabits() {
    try {
      const res = await api.habits.list({ status: 'active' });
      setHabits(res.habits || []);
    } catch (error) {
      console.error('Habits load error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function createHabit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.habits.create({
      name: name.trim(),
      cadence: 'daily',
      target_per_week: 5,
      current_streak: 0,
      status: 'active',
    });
    setName('');
    loadHabits();
  }

  async function logHabit(habit) {
    const now = new Date().toISOString();
    await api.habits.update(habit.id, {
      current_streak: (habit.current_streak || 0) + 1,
      last_logged_at: now,
    });
    loadHabits();
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Habits</h1>
        <p className="text-[var(--text-muted)] mt-1">Track recurring routines and streaks.</p>
      </motion.div>

      <form onSubmit={createHabit} className="glass-card p-4 flex gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a habit (e.g. Study session)"
          className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm"
        />
        <button type="submit" className="px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium">
          Add Habit
        </button>
      </form>

      {loading ? (
        <div className="h-24 rounded-xl bg-[var(--bg-surface)] animate-pulse" />
      ) : habits.length === 0 ? (
        <div className="glass-card p-8 text-center text-[var(--text-muted)]">No active habits yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {habits.map((habit) => (
            <div key={habit.id} className="glass-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{habit.name}</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {habit.cadence} · target {habit.target_per_week}/week
                  </p>
                </div>
                <button
                  onClick={() => logHabit(habit)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs"
                >
                  Log
                </button>
              </div>
              <p className="text-sm mt-3">🔥 Streak: {habit.current_streak || 0}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
