'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

export default function GoalsPage() {
  const [goals, setGoals] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [goalTitle, setGoalTitle] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [goalsRes, projectsRes] = await Promise.all([
        api.goals.list(),
        api.projects.list(),
      ]);
      setGoals(goalsRes.goals || []);
      setProjects(projectsRes.projects || []);
    } catch (error) {
      console.error('Goals load error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function createGoal(e) {
    e.preventDefault();
    if (!goalTitle.trim()) return;
    await api.goals.create({ title: goalTitle.trim(), status: 'active', progress: 0 });
    setGoalTitle('');
    loadData();
  }

  async function setGoalProgress(goal, delta) {
    const next = Math.max(0, Math.min(100, (goal.progress || 0) + delta));
    await api.goals.update(goal.id, { progress: next });
    loadData();
  }

  const activeGoals = goals.filter(g => g.status !== 'done');

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Goals & Projects</h1>
        <p className="text-[var(--text-muted)] mt-1">Quarterly goals with project-level execution.</p>
      </motion.div>

      <form onSubmit={createGoal} className="glass-card p-4 flex gap-3">
        <input
          value={goalTitle}
          onChange={(e) => setGoalTitle(e.target.value)}
          placeholder="Add a new goal..."
          className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm"
        />
        <button type="submit" className="px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium">
          Add Goal
        </button>
      </form>

      {loading ? (
        <div className="h-24 rounded-xl bg-[var(--bg-surface)] animate-pulse" />
      ) : activeGoals.length === 0 ? (
        <div className="glass-card p-8 text-center text-[var(--text-muted)]">No goals yet.</div>
      ) : (
        <div className="space-y-3">
          {activeGoals.map((goal) => {
            const goalProjects = projects.filter(p => p.goal_id === goal.id);
            return (
              <div key={goal.id} className="glass-card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">{goal.title}</h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {goalProjects.length} project(s) · Status: {goal.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setGoalProgress(goal, -10)} className="px-2 py-1 rounded bg-[var(--bg-surface)]">-10%</button>
                    <span className="text-sm font-semibold">{goal.progress || 0}%</span>
                    <button onClick={() => setGoalProgress(goal, 10)} className="px-2 py-1 rounded bg-[var(--bg-surface)]">+10%</button>
                  </div>
                </div>
                {goalProjects.length > 0 && (
                  <div className="mt-3 text-sm text-[var(--text-secondary)]">
                    {goalProjects.slice(0, 5).map(p => (
                      <div key={p.id}>• {p.title} ({p.status})</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
