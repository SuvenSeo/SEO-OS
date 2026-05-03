const API_URL = '';
const TOKEN = process.env.NEXT_PUBLIC_CRON_SECRET || '';

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
};
