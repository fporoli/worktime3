import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useT } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Session {
  id: string;
  check_in: string;
  check_out: string | null;
  comment: string | null;
}

interface Balance {
  overtimeMinutes: number;
  vacationMinutes: number;
}

function formatSignedMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.round(Math.abs(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

/** ISO instant -> the 'YYYY-MM-DDTHH:mm' shape a `datetime-local` input wants, in local time. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

interface WorkTimeProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function WorkTime({ orgId, userId, authHeaders }: WorkTimeProps) {
  const t = useT();
  const [status, setStatus] = useState<Session | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [entries, setEntries] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<Session | null>(null);

  async function reloadStatus() {
    try {
      const res = await fetch(`${API}/work-time/status`, { headers: await authHeaders() });
      setStatus(await res.json());
    } catch { /* offline fallback */ }
  }

  async function reloadBalance() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/balances`, { headers: await authHeaders() });
      const data = await res.json();
      setBalance(data ? { overtimeMinutes: data.overtimeMinutes, vacationMinutes: data.vacationMinutes } : null);
    } catch { /* offline fallback */ }
  }

  async function reloadEntries() {
    const from = new Date(Date.now() - 13 * 86400000).toISOString();
    const to = new Date(Date.now() + 86400000).toISOString();
    try {
      const res = await fetch(
        `${API}/organizations/${orgId}/work-time?userId=${userId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: await authHeaders() },
      );
      const data = await res.json();
      if (Array.isArray(data.entries)) setEntries([...data.entries].reverse());
    } catch { /* offline fallback */ }
  }

  async function reloadAll() {
    setLoading(true);
    await Promise.all([reloadStatus(), reloadBalance(), reloadEntries()]);
    setLoading(false);
  }

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  // Ticking elapsed-time display while checked in.
  useEffect(() => {
    if (!status?.check_in || status.check_out) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  async function checkIn() {
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/work-time/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(t('workTime.checkInFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reloadAll();
    } catch {
      setError(t('workTime.checkInFailed', { error: 'offline' }));
    }
  }

  async function checkOut() {
    setError(null);
    try {
      const res = await fetch(`${API}/work-time/check-out`, { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(t('workTime.checkOutFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reloadAll();
    } catch {
      setError(t('workTime.checkOutFailed', { error: 'offline' }));
    }
  }

  async function removeEntry(id: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/work-time/${id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(t('workTime.deleteFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reloadAll();
    } catch {
      setError(t('workTime.deleteFailed', { error: 'offline' }));
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setError(null);
    try {
      const res = await fetch(`${API}/work-time/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ checkIn: draft.check_in, checkOut: draft.check_out, comment: draft.comment ?? undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(t('workTime.saveFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      setDraft(null);
      await reloadAll();
    } catch {
      setError(t('workTime.saveFailed', { error: 'offline' }));
    }
  }

  const checkedIn = !!status && !status.check_out;
  const elapsed = checkedIn ? Math.max(0, Math.round((now - new Date(status!.check_in).getTime()) / 60000)) : 0;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('workTime.title')}</Typography>

      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mt: 1 }} />}

      <Box sx={{ display: 'flex', gap: 1, my: 2, flexWrap: 'wrap' }}>
        {balance && (
          <>
            <Chip
              label={t('workTime.overtimeBalance', { value: formatSignedMinutes(balance.overtimeMinutes) })}
              color={balance.overtimeMinutes < 0 ? 'error' : 'success'}
              variant="outlined"
            />
            <Chip
              label={t('workTime.vacationBalance', { value: formatSignedMinutes(balance.vacationMinutes) })}
              color="default"
              variant="outlined"
            />
          </>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Button variant="contained" color={checkedIn ? 'warning' : 'success'} onClick={checkedIn ? checkOut : checkIn}>
          {checkedIn ? t('workTime.checkOut') : t('workTime.checkIn')}
        </Button>
        {checkedIn && (
          <Typography variant="body2" color="text.secondary">
            {t('workTime.checkedInSince', { time: formatDateTime(status!.check_in), elapsed: `${Math.floor(elapsed / 60)}h ${String(elapsed % 60).padStart(2, '0')}m` })}
          </Typography>
        )}
      </Box>

      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>{t('workTime.recentSessions')}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('workTime.checkIn')}</TableCell>
            <TableCell>{t('workTime.checkOut')}</TableCell>
            <TableCell>{t('workTime.duration')}</TableCell>
            <TableCell>{t('time.comment')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{formatDateTime(e.check_in)}</TableCell>
              <TableCell>{formatDateTime(e.check_out)}</TableCell>
              <TableCell>{formatDuration(e.check_in, e.check_out)}</TableCell>
              <TableCell>{e.comment ?? ''}</TableCell>
              <TableCell align="right">
                <Button size="small" onClick={() => setDraft(e)}>{t('time.edit')}</Button>
                <Button size="small" color="error" onClick={() => removeEntry(e.id)}>{t('time.remove')}</Button>
              </TableCell>
            </TableRow>
          ))}
          {entries.length === 0 && (
            <TableRow><TableCell colSpan={5}>{t('time.noEntries')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('workTime.editSession')}</DialogTitle>
        {draft && (
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField
              label={t('workTime.checkIn')}
              type="datetime-local"
              size="small"
              value={toLocalInput(draft.check_in)}
              onChange={(e) => e.target.value && setDraft({ ...draft, check_in: fromLocalInput(e.target.value) })}
            />
            <TextField
              label={t('workTime.checkOut')}
              type="datetime-local"
              size="small"
              value={draft.check_out ? toLocalInput(draft.check_out) : ''}
              onChange={(e) => setDraft({ ...draft, check_out: e.target.value ? fromLocalInput(e.target.value) : null })}
            />
            <TextField
              label={t('time.comment')}
              size="small"
              value={draft.comment ?? ''}
              onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
            />
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('usermenu.cancel')}</Button>
          <Button variant="contained" onClick={saveDraft}>{t('usermenu.save')}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
