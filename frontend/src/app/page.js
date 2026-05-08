'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import supabase from '@/lib/config/supabase';
import { formatRelative } from '@/lib/utils';
import SpotlightCard from '@/components/ui/SpotlightCard';
import { 
  LayoutDashboard, 
  CheckCircle2, 
  Clock, 
  Lightbulb, 
  Target, 
  Flame, 
  BrainCircuit, 
  Search, 
  Mail, 
  SendHorizontal,
  ChevronRight,
  TrendingUp,
  Zap
} from 'lucide-react';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [ideas, setIdeas] = useState([]);
  const [goals, setGoals] = useState([]);
  const [habits, setHabits] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    loadDashboard();

    // Subscribe to realtime changes for all critical tables
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ideas' }, () => loadDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patterns' }, () => loadDashboard())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadDashboard() {
    try {
      const [tasksRes, remindersRes, ideasRes, goalsRes, habitsRes, patternsRes] = await Promise.all([
        api.tasks.list({ status: 'open' }),
        api.reminders.list({ fired: 'false' }),
        api.ideas.list({ status: 'raw' }),
        api.goals.list({ status: 'active' }),
        api.habits.list({ status: 'active' }),
        api.patterns.list(),
      ]);
      setTasks(tasksRes.tasks || []);
      setReminders(remindersRes.reminders || []);
      setIdeas(ideasRes.ideas || []);
      setGoals(goalsRes.goals || []);
      setHabits(habitsRes.habits || []);
      setPatterns(patternsRes.patterns || []);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleChat(e) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setChatLoading(true);
    setChatResponse('');
    try {
      const res = await api.chat.send(chatInput);
      setChatResponse(res.response);
      setChatInput('');
      loadDashboard();
    } catch (e) {
      setChatResponse('Error: ' + e.message);
    } finally {
      setChatLoading(false);
    }
  }

  async function markDone(id) {
    try {
      await api.tasks.update(id, { status: 'done' });
      setTasks(tasks.filter(t => t.id !== id));
    } catch (e) {
      console.error('Mark done error:', e);
    }
  }

  const stats = [
    { label: 'Tasks', value: tasks.length, icon: CheckCircle2, color: 'var(--accent)' },
    { label: 'Ideas', value: ideas.length, icon: Lightbulb, color: '#a855f7' },
    { label: 'Goals', value: goals.length, icon: Target, color: '#22c55e' },
    { label: 'Streaks', value: habits.reduce((acc, h) => acc + (h.current_streak || 0), 0), icon: Flame, color: '#f97316' },
  ];

  return (
    <div className="max-w-[1400px] mx-auto space-y-10 pb-20">
      {/* Header Section */}
      <div className="flex justify-between items-end">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={spring}
        >
          <p className="text-[var(--text-muted)] font-medium mb-2 uppercase tracking-widest text-[10px]">Command Center</p>
          <h1 className="text-5xl font-bold tracking-tighter">Welcome back, Suven.</h1>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={spring}
          className="text-right"
        >
          <p className="text-2xl font-bold tracking-tight">
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </p>
          <p className="text-[var(--text-muted)] text-sm font-medium">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
        </motion.div>
      </div>

      {/* Bento Grid */}
      <div className="bento-grid">
        
        {/* 1. Insights & Patterns (Large Area) */}
        <SpotlightCard className="bento-item-large p-8" delay={0.1}>
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-bold flex items-center gap-3">
              <BrainCircuit className="w-6 h-6 text-[var(--accent)]" />
              Second Brain Insights
            </h2>
            <TrendingUp className="w-5 h-5 text-[var(--text-muted)]" />
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="h-20 rounded-2xl bg-white/5 animate-pulse" />
              <div className="h-20 rounded-2xl bg-white/5 animate-pulse" />
            </div>
          ) : patterns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center opacity-40 py-10">
              <Zap className="w-10 h-10 mb-4" />
              <p className="text-sm">Collecting patterns. Continue your work.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {patterns.slice(0, 3).map((pattern, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  className="p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-[var(--accent-muted)] transition-all group"
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-1 p-2 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-relaxed">{pattern.observation}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Confidence: {pattern.confidence}</span>
                        <ChevronRight className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </SpotlightCard>

        {/* 2. Top Tasks (Tall/Wide Area) */}
        <SpotlightCard className="bento-item-tall p-8 col-span-2" delay={0.2}>
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-bold flex items-center gap-3">
              <LayoutDashboard className="w-6 h-6 text-blue-400" />
              Priority Stack
            </h2>
            <button className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-white transition-colors">View All</button>
          </div>

          <div className="space-y-3">
            <AnimatePresence>
              {loading ? (
                [1, 2, 3, 4].map(i => <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />)
              ) : tasks.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-10 text-center">No open tasks. You're clear.</p>
              ) : (
                tasks.slice(0, 6).map((task, i) => (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: 0.3 + i * 0.05 }}
                    className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-transparent hover:border-white/10 hover:bg-white/[0.07] transition-all group"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`w-1 h-8 rounded-full priority-bg-${task.priority}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wide">
                          {task.deadline ? formatRelative(task.deadline) : `Tier ${task.tier}`}
                        </p>
                      </div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => markDone(task.id)}
                      className="opacity-0 group-hover:opacity-100 p-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </motion.button>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </SpotlightCard>

        {/* 3. Communication / Gmail (Tall Area) */}
        <SpotlightCard className="bento-item-tall p-8" delay={0.3}>
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-bold flex items-center gap-3">
              <Mail className="w-6 h-6 text-orange-400" />
              Briefing
            </h2>
          </div>
          
          <div className="space-y-6">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">Recent Reminders</p>
              {reminders.slice(0, 3).map((r, i) => (
                <div key={i} className="mb-4 last:mb-0">
                  <p className="text-sm font-medium leading-tight">{r.message}</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(r.trigger_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
              {reminders.length === 0 && <p className="text-xs text-[var(--text-muted)]">No alerts pending.</p>}
            </div>

            <div className="p-4 rounded-2xl bg-[var(--accent-muted)] border border-[var(--accent)]/10">
              <p className="text-xs font-bold text-[var(--accent)] mb-2 flex items-center gap-2">
                <BrainCircuit className="w-3 h-3" />
                Next Step
              </p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic">
                &quot;University coursework (CM1603) is your primary friction point today. Finish the ERD before the walk at 7.&quot;
              </p>
            </div>
          </div>
        </SpotlightCard>

        {/* 4. Stats Mini-Grid */}
        {stats.map((stat, i) => (
          <SpotlightCard key={i} className="bento-item p-6 flex flex-col justify-between" delay={0.4 + i * 0.05}>
            <div className="flex justify-between items-start">
              <div className="p-2.5 rounded-xl bg-white/5 text-[var(--text-muted)] group-hover:text-white transition-colors">
                <stat.icon className="w-5 h-5" />
              </div>
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div>
              <p className="text-3xl font-bold tracking-tighter" style={{ color: stat.color }}>{loading ? '—' : stat.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mt-1">{stat.label}</p>
            </div>
          </SpotlightCard>
        ))}

        {/* 5. Quick Brain (Bottom Wide) */}
        <SpotlightCard className="bento-item-wide col-span-4 h-auto min-h-[140px] p-8" delay={0.6}>
          <div className="flex gap-6 items-center">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 shrink-0">
              <BrainCircuit className="w-8 h-8 text-[var(--accent)]" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold mb-1">Quick Brain Access</h2>
              <p className="text-sm text-[var(--text-muted)]">Ask for Gmail, search the web, or check memories.</p>
            </div>
            <form onSubmit={handleChat} className="flex-1 relative">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Talk to SEOS..."
                className="w-full px-6 py-4 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-all pr-12"
                disabled={chatLoading}
              />
              <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-[var(--accent)] text-white hover:scale-105 transition-transform disabled:opacity-50"
                disabled={chatLoading}
              >
                {chatLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <SendHorizontal className="w-4 h-4" />
                )}
              </button>
            </form>
          </div>
          
          <AnimatePresence>
            {chatResponse && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 pt-6 border-t border-white/5"
              >
                <div className="p-5 rounded-2xl bg-white/[0.03] text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                  <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-[var(--accent)] uppercase tracking-widest">
                    <Zap className="w-3 h-3" />
                    SEOS Response
                  </div>
                  {chatResponse}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </SpotlightCard>

      </div>
    </div>
  );
}
