'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/utils';

const spring = { type: 'spring', stiffness: 300, damping: 30 };

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadHistory() {
    try {
      const res = await api.chat.history({ limit: 100 });
      setMessages(res.messages || []);
    } catch (e) {
      console.error('Chat history error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const userMsg = { role: 'user', content: input, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await api.chat.send(input);
      const aiMsg = { role: 'assistant', content: res.response, created_at: new Date().toISOString() };
      setMessages(prev => [...prev, aiMsg]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + e.message, created_at: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="mb-4"
      >
        <h1 className="text-3xl font-bold tracking-[-0.04em]">Chat</h1>
        <p className="text-[var(--text-muted)] mt-1">Full conversation with SEOS</p>
      </motion.div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto glass-card p-6 space-y-4 mb-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className={`h-16 rounded-xl bg-[var(--bg-surface-hover)] animate-pulse ${i % 2 === 0 ? 'ml-auto w-2/3' : 'w-2/3'}`} />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[var(--text-muted)]">No messages yet. Start a conversation.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: Math.min(i * 0.02, 0.5) }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-[var(--accent)] text-white rounded-br-md'
                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border)] rounded-bl-md'
                }`}
              >
                <p>{msg.content}</p>
                <p className={`text-[10px] mt-2 ${
                  msg.role === 'user' ? 'text-white/50' : 'text-[var(--text-muted)]'
                }`}>
                  {formatRelative(msg.created_at)}
                </p>
              </div>
            </motion.div>
          ))
        )}

        {sending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-[var(--bg-surface)] border border-[var(--border)]">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message SEOS..."
          className="flex-1 px-5 py-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          disabled={sending}
        />
        <motion.button
          type="submit"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          disabled={sending}
          className="px-8 py-4 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
        >
          Send
        </motion.button>
      </form>
    </div>
  );
}
