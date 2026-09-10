import { useState } from 'react';
import { Alert, Box, Button, Chip, Paper, TextField, Typography } from '@mui/material';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AssistantProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Assistant({ orgId, authHeaders }: AssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    try {
      const res = await fetch(`${API}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ orgId, messages: nextMessages }),
      });
      const data = await res.json();
      if (!data.ok) {
        const message =
          data.error === 'assistant-not-configured'
            ? 'The assistant is not configured yet (no GEMINI_API_KEY/OPENAI_API_KEY set on the server).'
            : data.error === 'forbidden'
              ? 'You do not have access to this organization.'
              : `Assistant request failed${data.detail ? `: ${data.detail}` : ''}.`;
        setError(message);
        return;
      }
      const actionsNote = Array.isArray(data.actions) && data.actions.length > 0 ? `\n\n(${data.actions.join(' ')})` : '';
      setMessages([...nextMessages, { role: 'assistant', content: (data.reply || '(no reply)') + actionsNote }]);
    } catch {
      setError('Failed to reach the assistant. Is the API running?');
    } finally {
      setSending(false);
    }
  }

  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '70vh' }}>
      <Typography variant="h6">Assistant</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Ask to log hours ("log 9-5 on Website Relaunch yesterday"), or ask for a report — managers and
        admins can additionally ask for team-hours or project-cost reports.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary">No messages yet — say hello.</Typography>
        )}
        {messages.map((m, i) => (
          <Box
            key={i}
            sx={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '75%',
              bgcolor: m.role === 'user' ? 'primary.main' : 'action.hover',
              color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
              px: 1.5,
              py: 1,
              borderRadius: 2,
              whiteSpace: 'pre-wrap',
            }}
          >
            <Typography variant="body2">{m.content}</Typography>
          </Box>
        ))}
        {sending && <Chip label="Thinking…" size="small" sx={{ alignSelf: 'flex-start' }} />}
      </Box>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={sending}
        />
        <Button variant="contained" onClick={send} disabled={sending || !input.trim()}>Send</Button>
      </Box>
    </Paper>
  );
}
