// Empty string is correct — Next.js API routes are same-origin, so relative paths work.
const API_URL = '';
// Server-side uses CRON_SECRET, client-side uses NEXT_PUBLIC_CRON_SECRET.
const TOKEN = typeof window === 'undefined'
  ? (process.env.CRON_SECRET || process.env.NEXT_PUBLIC_CRON_SECRET || '')
  : (process.env.NEXT_PUBLIC_CRON_SECRET || '');

async function request(path, options = {}) {
  const { method = 'GET', body, params } = options;

  let url = `${API_URL}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  if (body) config.body = JSON.stringify(body);

  const res = await fetch(url, config);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Tasks
export const api = {
  tasks: {
    list: (params) => request('/api/tasks', { params }),
    create: (body) => request('/api/tasks', { method: 'POST', body }),
    update: (id, body) => request(`/api/tasks/${id}`, { method: 'PATCH', body }),
    delete: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  },
  memory: {
    core: () => request('/api/memory/core'),
    updateCore: (key, value) => request(`/api/memory/core/${key}`, { method: 'PUT', body: { value } }),
    deleteCore: (key) => request(`/api/memory/core/${key}`, { method: 'DELETE' }),
    working: () => request('/api/memory/working'),
    deleteWorking: (id) => request(`/api/memory/working/${id}`, { method: 'DELETE' }),
  },
  reminders: {
    list: (params) => request('/api/reminders', { params }),
    create: (body) => request('/api/reminders', { method: 'POST', body }),
    delete: (id) => request(`/api/reminders/${id}`, { method: 'DELETE' }),
  },
  ideas: {
    list: (params) => request('/api/ideas', { params }),
    create: (body) => request('/api/ideas', { method: 'POST', body }),
    update: (id, body) => request(`/api/ideas/${id}`, { method: 'PATCH', body }),
    delete: (id) => request(`/api/ideas/${id}`, { method: 'DELETE' }),
  },
  patterns: {
    list: (params) => request('/api/patterns', { params }),
  },
  goals: {
    list: (params) => request('/api/goals', { params }),
    create: (body) => request('/api/goals', { method: 'POST', body }),
    update: (id, body) => request(`/api/goals/${id}`, { method: 'PATCH', body }),
    delete: (id) => request(`/api/goals/${id}`, { method: 'DELETE' }),
  },
  projects: {
    list: (params) => request('/api/projects', { params }),
    create: (body) => request('/api/projects', { method: 'POST', body }),
    update: (id, body) => request(`/api/projects/${id}`, { method: 'PATCH', body }),
    delete: (id) => request(`/api/projects/${id}`, { method: 'DELETE' }),
  },
  habits: {
    list: (params) => request('/api/habits', { params }),
    create: (body) => request('/api/habits', { method: 'POST', body }),
    update: (id, body) => request(`/api/habits/${id}`, { method: 'PATCH', body }),
    delete: (id) => request(`/api/habits/${id}`, { method: 'DELETE' }),
  },
  config: {
    list: () => request('/api/config'),
    get: (key) => request(`/api/config/${key}`),
    update: (key, value) => request(`/api/config/${key}`, { method: 'PUT', body: { value } }),
  },
  chat: {
    history: (params) => request('/api/chat/history', { params }),
    send: (message) => request('/api/chat/send', { method: 'POST', body: { message } }),
  },
  auditLog: {
    list: () => request('/api/audit-log'),
    create: (body) => request('/api/audit-log', { method: 'POST', body }),
  },
  knowledge: {
    list: (params) => request('/api/knowledge', { params }),
    create: (body) => request('/api/knowledge', { method: 'POST', body }),
    delete: (id) => request(`/api/knowledge?id=${id}`, { method: 'DELETE' }),
  },
  entities: {
    list: (params) => request('/api/entities', { params }),
  },
  notifications: {
    list: (params) => request('/api/notifications', { params }),
    markRead: (ids) => request('/api/notifications', { method: 'PUT', body: { ids } }),
  },
  journal: {
    list: (params) => request('/api/journal', { params }),
    create: (body) => request('/api/journal', { method: 'POST', body }),
  },
  mood: {
    list: (params) => request('/api/mood', { params }),
    create: (body) => request('/api/mood', { method: 'POST', body }),
  },
  clients: {
    list: (params) => request('/api/clients', { params }),
    get: (id) => request(`/api/clients/${id}`),
    create: (body) => request('/api/clients', { method: 'POST', body }),
    update: (id, body) => request(`/api/clients/${id}`, { method: 'PUT', body }),
    delete: (id) => request(`/api/clients/${id}`, { method: 'DELETE' }),
  },
  expenses: {
    list: (params) => request('/api/expenses', { params }),
    create: (body) => request('/api/expenses', { method: 'POST', body }),
  },
  modules: {
    list: (params) => request('/api/modules', { params }),
    create: (body) => request('/api/modules', { method: 'POST', body }),
  },
};
