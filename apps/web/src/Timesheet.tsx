import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { minutes, periodLabel, periodRange, type Entry } from './aggregate';
import { useI18n } from './i18n';
import { formatDurationMinutes } from './localeFormat';
import { PageHeader } from './components';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Status = 'open' | 'submitted' | 'approved' | 'rejected';

interface PeriodRow {
  id: string;
  period_start: string;
  status: Status;
  submitted_at: string | null;
  review_note: string | null;
}

const STATUS_COLOR: Record<Status, 'default' | 'warning' | 'success' | 'error'> = {
  open: 'default',
  submitted: 'warning',
  approved: 'success',
  rejected: 'error',
};

interface ReopenRequest {
  id: string;
  step_status: 'pending' | 'approved' | 'rejected';
  workflow_data: { reason?: string; decisionNote?: string | null };
  started: string | null;
  finished: string | null;
}

interface WorkSessionRow {
  id: string;
  check_in: string;
  check_out: string | null;
}

const REOPEN_ERROR_MESSAGES: Record<string, (t: (key: string) => string) => string> = {
  'reason-required': (t) => t('timesheet.reopenReasonRequired'),
  'no-manager-to-ask': (t) => t('timesheet.reopenNoManager'),
  'already-requested': (t) => t('timesheet.reopenAlreadyRequested'),
  'not-approved': (t) => t('timesheet.reopenNotApproved'),
};

function currentPeriodStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function toMonthInput(periodStart: string): string {
  return periodStart.slice(0, 7);
}

function fromMonthInput(month: string): string {
  return `${month}-01`;
}

function shiftMonth(periodStart: string, delta: number): string {
  const [y, m] = periodStart.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function toDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function getSourceTitle(periodStart: string): string {
  return `${toDisplayDate(periodStart)}-${toDisplayDate(nextMonthStart(periodStart))}`;
}

function nextMonthStart(periodStart: string): string {
  const [y, m] = periodStart.slice(0, 10).split('-').map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

interface TimesheetProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Timesheet({ orgId, userId, authHeaders }: TimesheetProps) {
  const { t, locale } = useI18n();
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [monthEntries, setMonthEntries] = useState<Entry[]>([]);
  const [monthWorkSessions, setMonthWorkSessions] = useState<WorkSessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(currentPeriodStart());
  const [reopenRequest, setReopenRequest] = useState<ReopenRequest | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [requestingReopen, setRequestingReopen] = useState(false);
  const [submitNote, setSubmitNote] = useState('');

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/timesheet-periods?userId=${userId}`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (Array.isArray(data)) setPeriods(data);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  async function reloadMonthSummary(targetPeriod: string) {
    const { from, to } = periodRange('month', targetPeriod);
    try {
      const headers = await authHeaders();
      const [ptRes, wtRes] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/project-time?userId=${userId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers }),
        fetch(`${API}/organizations/${orgId}/work-time?userId=${userId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers }),
      ]);
      const ptData = await ptRes.json();
      const wtData = await wtRes.json();
      setMonthEntries(Array.isArray(ptData?.entries) ? ptData.entries : []);
      setMonthWorkSessions(Array.isArray(wtData?.entries) ? wtData.entries : []);
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  useEffect(() => {
    void reloadMonthSummary(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId, period]);

  const current = periods.find((p) => p.period_start === period);
  const status = current?.status ?? 'open';

  async function reloadReopenRequest(periodId: string) {
    try {
      const res = await fetch(`${API}/timesheet-periods/${periodId}/reopen-request`, { headers: await authHeaders() });
      const data = await res.json();
      setReopenRequest(data ?? null);
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    setReopenReason('');
    if (current?.id && status === 'approved') {
      void reloadReopenRequest(current.id);
    } else {
      setReopenRequest(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, status]);

  async function requestReopen() {
    if (!current) return;
    setError(null);
    setSuccess(null);
    setRequestingReopen(true);
    try {
      const res = await fetch(`${API}/timesheet-periods/${current.id}/request-reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ reason: reopenReason }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(REOPEN_ERROR_MESSAGES[data.error]?.(t) ?? t('timesheet.reopenRequestFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      setSuccess(t('timesheet.reopenRequestSent'));
      await reloadReopenRequest(current.id);
    } catch {
      setError(t('timesheet.reopenRequestFailed', { error: 'offline' }));
    } finally {
      setRequestingReopen(false);
    }
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/timesheet-periods/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ periodStart: period, note: submitNote }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'already-submitted' ? t('timesheet.alreadySubmitted') : t('timesheet.submitFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      setSuccess(data.autoApproved ? t('timesheet.autoApproved') : t('timesheet.submitted'));
      setSubmitNote('');
      await reload();
    } catch {
      setError(t('timesheet.submitFailedOffline'));
    }
  }

  const totalProjectMinutes = useMemo(
    () => monthEntries.reduce((sum, e) => sum + minutes(e), 0),
    [monthEntries],
  );
  const totalWorkMinutes = useMemo(
    () =>
      monthWorkSessions.reduce((sum, s) => {
        if (!s.check_out) return sum;
        return sum + Math.max(0, (new Date(s.check_out).getTime() - new Date(s.check_in).getTime()) / 60000);
      }, 0),
    [monthWorkSessions],
  );
  const projectBreakdown = useMemo(() => {
    const map = new Map<string, { label: string; minutes: number; count: number }>();
    for (const e of monthEntries) {
      const label = e.project_name
        ? e.subproject_name
          ? `${e.project_name} / ${e.subproject_name}`
          : e.project_name
        : t('timesheet.unassignedProject');
      const existing = map.get(label) ?? { label, minutes: 0, count: 0 };
      existing.minutes += minutes(e);
      existing.count += 1;
      map.set(label, existing);
    }
    return [...map.values()].sort((a, b) => b.minutes - a.minutes);
  }, [monthEntries, t]);

  const history = [...periods]
    .filter((p) => p.period_start !== period)
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1));

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('timesheet.title')}
        subtitle={periodLabel('month', period, locale)}
        end={<Chip label={t(`timesheet.status.${status}`)} color={STATUS_COLOR[status]} size="small" />}
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {status === 'rejected' && current?.review_note && (
        <Alert severity="warning">{t('timesheet.rejected', { note: current.review_note })}</Alert>
      )}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
          <Button size="small" startIcon={<ChevronLeftIcon fontSize="small" />} onClick={() => setPeriod((p) => shiftMonth(p, -1))}>
            {t('timesheet.prev').replace('‹ ', '')}
          </Button>
          <TextField
            type="month"
            size="small"
            value={toMonthInput(period)}
            onChange={(e) => e.target.value && setPeriod(fromMonthInput(e.target.value))}
          />
          <Button size="small" endIcon={<ChevronRightIcon fontSize="small" />} onClick={() => setPeriod((p) => shiftMonth(p, 1))}>
            {t('timesheet.next').replace(' ›', '')}
          </Button>
          {period !== currentPeriodStart() && (
            <Button size="small" onClick={() => setPeriod(currentPeriodStart())}>{t('timesheet.thisMonth')}</Button>
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('timesheet.viewing', { period: period.slice(0, 7) })}
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
            gap: 1.5,
            mb: 2,
          }}
        >
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{t('timesheet.projectHours')}</Typography>
            <Typography variant="h6">{formatDurationMinutes(totalProjectMinutes)}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{t('timesheet.workHours')}</Typography>
            <Typography variant="h6">{formatDurationMinutes(totalWorkMinutes)}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{t('timesheet.entriesCount')}</Typography>
            <Typography variant="h6">{monthEntries.length}</Typography>
          </Paper>
        </Box>

        {projectBreakdown.length > 0 && (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('timesheet.byProject')}</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common.project')}</TableCell>
                    <TableCell align="right">{t('time.entries')}</TableCell>
                    <TableCell align="right">{t('approvals.duration')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projectBreakdown.map((b) => (
                    <TableRow key={b.label}>
                      <TableCell>{b.label}</TableCell>
                      <TableCell align="right">{b.count}</TableCell>
                      <TableCell align="right">{formatDurationMinutes(b.minutes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {(status === 'open' || status === 'rejected') && (
          <TextField
            size="small"
            label={t('timesheet.submitNote')}
            placeholder={t('timesheet.submitNotePlaceholder')}
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
            multiline
            minRows={2}
            sx={{
              display: 'block',
              mb: 1.5,
              width: '100%',
              maxWidth: 720,
              '& textarea': { resize: 'vertical' },
            }}
          />
        )}
        <Button variant="contained" size="small" onClick={submit} disabled={status === 'submitted' || status === 'approved'}>
          {status === 'approved' ? t('timesheet.approved') : status === 'submitted' ? t('timesheet.pending') : status === 'rejected' ? t('timesheet.resubmit') : t('timesheet.submit')}
        </Button>

        {status === 'approved' && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            {reopenRequest?.step_status === 'pending' ? (
              <Typography variant="body2">{t('timesheet.reopenPending')}</Typography>
            ) : (
              <>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('timesheet.requestReopen')}</Typography>
                {reopenRequest?.step_status === 'rejected' && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('timesheet.reopenRejected', { note: reopenRequest.workflow_data.decisionNote || '—' })}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <TextField
                    size="small"
                    label={t('timesheet.reopenReason')}
                    placeholder={t('timesheet.reopenReasonPlaceholder')}
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    multiline
                    minRows={2}
                    sx={{ minWidth: 260, flex: 1 }}
                  />
                  <Button variant="outlined" size="small" onClick={requestReopen} disabled={requestingReopen || !reopenReason.trim()}>
                    {t('timesheet.requestReopen')}
                  </Button>
                </Box>
              </>
            )}
          </Box>
        )}
      </Paper>

      {history.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('timesheet.history')}</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('time.period')}</TableCell>
                  <TableCell>{t('timesheet.status')}</TableCell>
                  <TableCell>{t('timesheet.note')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>{p.period_start.slice(0, 7)}</TableCell>
                    <TableCell><Chip label={t(`timesheet.status.${p.status}`)} size="small" color={STATUS_COLOR[p.status]} /></TableCell>
                    <TableCell>{p.review_note ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
