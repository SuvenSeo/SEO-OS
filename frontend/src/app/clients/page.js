'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

const STATUS_COLORS = {
  lead: 'bg-blue-500/10 text-blue-400',
  active: 'bg-green-500/10 text-green-400',
  completed: 'bg-gray-500/10 text-gray-400',
  paused: 'bg-yellow-500/10 text-yellow-400',
};

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', status: 'lead', notes: '' });

  const loadClients = async () => {
    setLoading(true);
    try {
      const res = await api.clients.list();
      setClients(res.clients || []);
    } catch (err) {
      console.error('Failed to load clients:', err);
    }
    setLoading(false);
  };

  useEffect(() => { loadClients(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const res = await api.clients.create(form);
      setClients([res.client, ...clients]);
      setForm({ name: '', company: '', email: '', phone: '', status: 'lead', notes: '' });
      setShowForm(false);
    } catch (err) {
      console.error('Failed to create client:', err);
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await api.clients.update(id, { status: newStatus });
      setClients(clients.map(c => c.id === id ? { ...c, status: newStatus } : c));
    } catch (err) {
      console.error('Failed to update client:', err);
    }
  };

  const stats = {
    lead: clients.filter(c => c.status === 'lead').length,
    active: clients.filter(c => c.status === 'active').length,
    completed: clients.filter(c => c.status === 'completed').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ardeno Clients</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {showForm ? 'Cancel' : '+ New Client'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[['Leads', stats.lead, 'text-blue-400'], ['Active', stats.active, 'text-green-400'], ['Completed', stats.completed, 'text-gray-400']].map(([label, count, color]) => (
          <div key={label} className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-center">
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{label}</p>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCreate}
            className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] space-y-3 overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-3">
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Client name *" required className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm" />
              <input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Company" className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm" />
              <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm" />
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm" />
            </div>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes..." rows={2} className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm resize-none" />
            <button type="submit" className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium">Add Client</button>
          </motion.form>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">Loading...</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">No clients yet. Add your first one above.</div>
      ) : (
        <div className="space-y-3">
          {clients.map((client) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">{client.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[client.status] || ''}`}>
                      {client.status}
                    </span>
                  </div>
                  {client.company && <p className="text-sm text-[var(--text-secondary)]">{client.company}</p>}
                  {client.email && <p className="text-xs text-[var(--text-secondary)] mt-1">{client.email}</p>}
                  {client.notes && <p className="text-sm mt-2 text-[var(--text-secondary)]">{client.notes}</p>}
                </div>
                <select
                  value={client.status}
                  onChange={(e) => handleStatusChange(client.id, e.target.value)}
                  className="text-xs px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]"
                >
                  <option value="lead">Lead</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
