export function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });
}

export function formatRelative(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

export function priorityLabel(p) {
  const labels = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Someday' };
  return labels[p] || `P${p}`;
}

export function statusColor(status) {
  const colors = {
    open: 'text-amber-400',
    done: 'text-emerald-400',
    cancelled: 'text-zinc-500',
    snoozed: 'text-blue-400',
  };
  return colors[status] || 'text-zinc-400';
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
