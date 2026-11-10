import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { useT } from './i18n';
import { AutoAwesomeIcon, CloseIcon, RestartAltIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AssistantProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  onClose?: () => void;
}

export default function Assistant({ orgId, authHeaders, onClose }: AssistantProps) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    if (!overrideText) setInput('');
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
            ? t('assistant.notConfigured')
            : data.error === 'forbidden'
              ? t('assistant.forbidden')
              : t('assistant.failed', { detail: data.detail ? `: ${data.detail}` : '' });
        setError(message);
        return;
      }
      const actionsNote = Array.isArray(data.actions) && data.actions.length > 0 ? `\n\n(${data.actions.join(' ')})` : '';
      setMessages([...nextMessages, { role: 'assistant', content: (data.reply || t('assistant.noReply')) + actionsNote }]);
    } catch {
      setError(t('assistant.unreachable'));
    } finally {
      setSending(false);
    }
  }

  const starterPrompts = [t('assistant.prompt1'), t('assistant.prompt2'), t('assistant.prompt3')];

  return (
    <Paper square elevation={0} sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%', borderLeft: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <AutoAwesomeIcon fontSize="small" color="primary" />
        <Typography variant="h6" sx={{ flex: 1 }}>{t('assistant.title')}</Typography>
        {messages.length > 0 && (
          <Tooltip title={t('assistant.clear')}>
            <IconButton size="small" aria-label={t('assistant.clear')} onClick={() => { setMessages([]); setError(null); }}>
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onClose && (
          <Tooltip title={t('assistant.close')}>
            <IconButton size="small" aria-label={t('assistant.close')} onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('assistant.subtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
        {messages.length === 0 && (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">{t('assistant.empty')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75, mt: 0.5 }}>
              {starterPrompts.map((prompt) => (
                <Chip
                  key={prompt}
                  label={prompt}
                  size="small"
                  variant="outlined"
                  onClick={() => void send(prompt)}
                  sx={{ cursor: 'pointer', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
                />
              ))}
            </Box>
          </Box>
        )}
        {messages.map((m, i) => (
          <Box
            key={i}
            sx={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '82%',
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
        {sending && <Chip label={t('assistant.thinking')} size="small" sx={{ alignSelf: 'flex-start' }} />}
        <div ref={bottomRef} />
      </Box>

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        sx={{ display: 'flex', gap: 1 }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder={t('assistant.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
        />
        <Button type="submit" variant="contained" disabled={sending || !input.trim()}>{t('assistant.send')}</Button>
      </Box>
    </Paper>
  );
}
