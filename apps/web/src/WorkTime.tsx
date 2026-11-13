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
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import BalanceOverview from './BalanceOverview';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatSignedMinutes } from './localeFormat';
import { ConfirmDialog, PageHeader, PersonPicker, TableEmptyRow } from './components';
import { BalancesPanel, formatDays } from './BalancesPanel';
import { AddIcon, DeleteIcon, EditIcon, PlayArrowIcon, StopIcon, TimerIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Session {
  id: string;
  check_in: string;
  check_out: string | null;
  comment: string | null;
}

interface Balance {
  /** Booked at timesheet approval. */
  overtimeMinutes: number;
  /** Running actual − target of the days no approved timesheet covers yet. */
  pendingOvertimeMinutes: number;
  /** Vacation days left this year, after approved future vacation. */
  vacationDays: number;
}

type RangeKey = '14d' | 'thisMonth' | 'lastMonth' | '90d';

function rangeBounds(range: RangeKey): { from: string; to: string } {
  const now = new Date();
  if (range === 'thisMonth') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (range === 'lastMonth') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  const days = range === '90d' ? 90 : 13;
  return {
    from: new Date(Date.now() - days * 86400000).toISOString(),
    to: new Date(Date.now() + 86400000).toISOString(),
  };
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  return formatDurationMinutes(mins);
}

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

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
  onWorkTimeChanged?: () => void;
  /** Opens the page on this person (from the team overview). */
  initialPersonId?: string;
}

export default function WorkTime({ orgId, userId, authHeaders, onWorkTimeChanged, initialPersonId }: WorkTimeProps) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'sessions' | 'balances'>('sessions');
  const [range, setRange] = useState<RangeKey>('14d');
  const [status, setStatus] = useState<Session | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [entries, setEntries] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<Session | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  // Whose sessions are shown: one's own, or (manager/HR) someone whose work time one may correct.
  const [personId, setPersonId] = useState(initialPersonId ?? userId);
  const isSelf = personId === userId;
  useEffect(() => setPersonId(userId), [orgId, userId]);

  /** API error code -> message; a locked month has to be reopened by the manager or HR. */
  function failure(key: string, code: string | undefined): string {
    if (code === 'period-locked') return t('workTime.periodLocked');
    if (code === 'invalid-range') return t('workTime.invalidRange');
    return t(key, { error: code ?? 'unknown error' });
  }

  function changed() {
    if (isSelf) onWorkTimeChanged?.();
  }

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
      setBalance(data ? { overtimeMinutes: data.overtimeMinutes, pendingOvertimeMinutes: data.pendingOvertimeMinutes ?? 0, vacationDays: data.vacationDays ?? 0 } : null);
    } catch { /* offline fallback */ }
  }

  async function reloadEntries(selectedRange = range) {
    const { from, to } = rangeBounds(selectedRange);
    try {
      const res = await fetch(
        `${API}/organizations/${orgId}/work-time?userId=${personId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: await authHeaders() },
      );
      const data = await res.json();
      if (Array.isArray(data.entries)) setEntries([...data.entries].reverse());
    } catch { /* offline fallback */ }
  }

  async function reloadAll() {
    setLoading(true);
    await Promise.all(isSelf ? [reloadStatus(), reloadBalance(), reloadEntries()] : [reloadEntries()]);
    setBalanceRefreshKey((k) => k + 1);
    setLoading(false);
  }

  useEffect(() => {
    void reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId, personId]);

  useEffect(() => {
    void reloadEntries(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

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
        setError(failure('workTime.checkInFailed', data.error));
        return;
      }
      await reloadAll();
      changed();
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
      changed();
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
        setError(failure('workTime.deleteFailed', data.error));
        return;
      }
      await reloadAll();
      changed();
    } catch {
      setError(t('workTime.deleteFailed', { error: 'offline' }));
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setError(null);
    try {
      // A new entry (no id) is added by hand for the person shown; an existing one is patched.
      const res = draft.id
        ? await fetch(`${API}/work-time/${draft.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify({ checkIn: draft.check_in, checkOut: draft.check_out, comment: draft.comment ?? undefined }),
          })
        : await fetch(`${API}/organizations/${orgId}/users/${personId}/work-time`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify({ checkIn: draft.check_in, checkOut: draft.check_out, comment: draft.comment ?? undefined }),
          });
      const data = await res.json();
      if (!data.ok) {
        setError(failure('workTime.saveFailed', data.error));
        return;
      }
      setDraft(null);
      await reloadAll();
      changed();
    } catch {
      setError(t('workTime.saveFailed', { error: 'offline' }));
    }
  }

  const checkedIn = !!status && !status.check_out;
  const elapsed = checkedIn ? Math.max(0, Math.round((now - new Date(status!.check_in).getTime()) / 60000)) : 0;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('workTime.title')}
        end={
          <>
            <PersonPicker orgId={orgId} kind="workTime" selfId={userId} value={personId} onChange={setPersonId} authHeaders={authHeaders} />
            {isSelf && balance && (
            <>
              <Tooltip
                title={t('workTime.overtimeBreakdown', {
                  booked: formatSignedMinutes(balance.overtimeMinutes),
                  pending: formatSignedMinutes(balance.pendingOvertimeMinutes),
                })}
              >
                <Chip
                  label={t('workTime.overtimeBalance', { value: formatSignedMinutes(balance.overtimeMinutes + balance.pendingOvertimeMinutes) })}
                  color={balance.overtimeMinutes + balance.pendingOvertimeMinutes < 0 ? 'error' : 'success'}
                  variant="outlined"
                  size="small"
                />
              </Tooltip>
              <Chip
                label={t('workTime.vacationBalance', { value: formatDays(balance.vacationDays, locale) })}
                color="default"
                variant="outlined"
                size="small"
              />
            </>
            )}
          </>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress />}

      {isSelf && (
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              color={checkedIn ? 'warning' : 'success'}
              startIcon={checkedIn ? <StopIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
              onClick={checkedIn ? checkOut : checkIn}
            >
              {checkedIn ? t('workTime.checkOut') : t('workTime.checkIn')}
            </Button>
            {checkedIn && (
              <Typography variant="body2" color="text.secondary">
                {t('workTime.checkedInSince', { time: formatDateTime(status!.check_in, locale), elapsed: formatDurationMinutes(elapsed) })}
              </Typography>
            )}
          </Box>
        </Box>
      </Paper>
      )}

      {isSelf && <BalanceOverview orgId={orgId} authHeaders={authHeaders} refreshKey={balanceRefreshKey} />}

      <Paper sx={{ p: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tab value="sessions" label={t('workTime.tab.sessions')} />
          {isSelf && <Tab value="balances" label={t('workTime.tab.balances')} />}
        </Tabs>

        {tab === 'sessions' || !isSelf ? (
          <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('workTime.recentSessions')}</Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => {
                  const start = new Date();
                  start.setHours(8, 0, 0, 0);
                  setDraft({ id: '', check_in: start.toISOString(), check_out: new Date(start.getTime() + 8 * 3600000).toISOString(), comment: null });
                }}
              >
                {t('workTime.addEntry')}
              </Button>
              <TextField
                select
                size="small"
                label={t('workTime.rangeLabel')}
                value={range}
                onChange={(e) => setRange(e.target.value as RangeKey)}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="14d">{t('workTime.range.14d')}</MenuItem>
                <MenuItem value="thisMonth">{t('workTime.range.thisMonth')}</MenuItem>
                <MenuItem value="lastMonth">{t('workTime.range.lastMonth')}</MenuItem>
                <MenuItem value="90d">{t('workTime.range.90d')}</MenuItem>
              </TextField>
              </Box>
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('workTime.checkIn')}</TableCell>
                    <TableCell>{t('workTime.checkOut')}</TableCell>
                    <TableCell>{t('workTime.duration')}</TableCell>
                    <TableCell>{t('time.comment')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell>{formatDateTime(e.check_in, locale)}</TableCell>
                      <TableCell>{formatDateTime(e.check_out, locale)}</TableCell>
                      <TableCell>{formatDuration(e.check_in, e.check_out)}</TableCell>
                      <TableCell>{e.comment || '—'}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title={t('time.edit')}>
                          <IconButton size="small" aria-label={t('time.edit')} onClick={() => setDraft(e)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('time.remove')}>
                          <IconButton size="small" color="error" aria-label={t('time.remove')} onClick={() => setConfirmDeleteId(e.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {entries.length === 0 && (
                    <TableEmptyRow colSpan={5} icon={<TimerIcon fontSize="inherit" />} title={t('time.noEntries')} />
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        ) : (
          <BalancesPanel
            orgId={orgId}
            userId={userId}
            authHeaders={authHeaders}
            refreshKey={balanceRefreshKey}
            onChanged={() => {
              void reloadBalance();
            }}
          />
        )}
      </Paper>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <DialogTitle>{draft?.id ? t('workTime.editSession') : t('workTime.addEntry')}</DialogTitle>
          {draft && (
            <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
              <TextField
                label={t('workTime.checkIn')}
                type="datetime-local"
                size="small"
                sx={{ mt: 1 }}
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
            <Button type="submit" variant="contained">{t('usermenu.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteId}
        title={t('time.removeEntry')}
        message={t('workTime.deleteConfirm')}
        confirmLabel={t('time.remove')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) return removeEntry(confirmDeleteId);
        }}
      />
    </Box>
  );
}
