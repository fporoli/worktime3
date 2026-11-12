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
import { formatDurationMinutes, formatLocaleDate, formatSignedMinutes } from './localeFormat';
import { holidayName, type Holiday } from '@worktime3/shared/worktime';
import { formatDays, monthName, type MonthBalance } from './BalancesPanel';
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

interface DayRow {
  date: string;
  scheduled: number;
  holiday: number;
  absence: number;
  absenceType?: string;
  target: number;
  attended: number;
  holidayInfo: Holiday | null;
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
  const [days, setDays] = useState<DayRow[]>([]);
  const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10));
  const [monthBalance, setMonthBalance] = useState<MonthBalance | null>(null);
  const [balanceStart, setBalanceStart] = useState<string | null>(null);
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
      const lastDay = new Date(Date.UTC(Number(targetPeriod.slice(0, 4)), Number(targetPeriod.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const [ptRes, dayRes, balRes] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/project-time?userId=${userId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers }),
        fetch(`${API}/organizations/${orgId}/day-targets?from=${targetPeriod}&to=${lastDay}`, { headers }),
        fetch(`${API}/organizations/${orgId}/balances/year?year=${targetPeriod.slice(0, 4)}`, { headers }),
      ]);
      const ptData = await ptRes.json();
      const dayData = await dayRes.json();
      const balData = await balRes.json();
      setMonthEntries(Array.isArray(ptData?.entries) ? ptData.entries : []);
      setDays(Array.isArray(dayData?.days) ? dayData.days : []);
      if (dayData?.today) setToday(dayData.today);
      setBalanceStart(typeof balData?.start === 'string' ? balData.start : null);
      setMonthBalance(Array.isArray(balData?.months) ? (balData.months as MonthBalance[]).find((m) => m.month === targetPeriod) ?? null : null);
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
      await Promise.all([reload(), reloadMonthSummary(period)]);
    } catch {
      setError(t('timesheet.submitFailedOffline'));
    }
  }

  const totalProjectMinutes = useMemo(
    () => monthEntries.reduce((sum, e) => sum + minutes(e), 0),
    [monthEntries],
  );
  const pastDays = days.filter((d) => d.date < today);
  const targetMinutes = days.reduce((sum, d) => sum + d.target, 0);
  const workedMinutes = days.reduce((sum, d) => sum + d.attended, 0);
  // Difference only for days already over, so the current month doesn't look short.
  const differenceMinutes = pastDays.reduce((sum, d) => sum + d.attended - d.target, 0);
  const monthOver = shiftMonth(period, 1) <= `${today.slice(0, 7)}-01`;
  const absenceLabel = (type: string | undefined) => {
    if (!type) return '';
    const label = t(`absences.type.${type}`);
    return label === `absences.type.${type}` ? type : label;
  };

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

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5, mb: 2 }}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{t('timesheet.target')}</Typography>
            <Typography variant="h6">{formatDurationMinutes(targetMinutes)}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{t('timesheet.workHours')}</Typography>
            <Typography variant="h6">{formatDurationMinutes(workedMinutes)}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{monthOver ? t('timesheet.difference') : t('timesheet.differenceToDate')}</Typography>
            <Typography variant="h6" color={differenceMinutes < 0 ? 'error.main' : 'success.main'}>{formatSignedMinutes(differenceMinutes)}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{t('timesheet.balanceEnd')}</Typography>
            <Typography variant="h6" color={monthBalance && monthBalance.overtimeBalance < 0 ? 'error.main' : undefined}>
              {monthBalance && monthBalance.status !== 'before-start' ? formatSignedMinutes(monthBalance.overtimeBalance) : '—'}
            </Typography>
          </Paper>
        </Box>

        {monthBalance && monthBalance.status !== 'before-start' && (
          <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              <Typography variant="subtitle2">{t('timesheet.carry.title')}</Typography>
              {balanceStart && (
                <Typography variant="body2" color="text.secondary">{t('timesheet.carry.start', { date: formatLocaleDate(balanceStart, locale) })}</Typography>
              )}
            </Box>
            <Table size="small" sx={{ maxWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell align="right">{t('timesheet.carry.overtime')}</TableCell>
                  <TableCell align="right">{t('timesheet.carry.vacation')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>{t('timesheet.carry.opening', { month: monthName(shiftMonth(period, -1), locale) })}</TableCell>
                  <TableCell align="right">{formatSignedMinutes(monthBalance.overtimeOpening)}</TableCell>
                  <TableCell align="right">{formatDays(monthBalance.vacationOpening, locale)}</TableCell>
                </TableRow>
                {monthBalance.vacationCredited !== 0 && (
                  <TableRow>
                    <TableCell>{t('timesheet.carry.entitlement', { year: period.slice(0, 4) })}</TableCell>
                    <TableCell align="right">—</TableCell>
                    <TableCell align="right">+{formatDays(monthBalance.vacationCredited, locale)}</TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell>{t('timesheet.carry.month')}</TableCell>
                  <TableCell align="right" sx={{ color: monthBalance.delta < 0 ? 'error.main' : undefined }}>{formatSignedMinutes(monthBalance.delta)}</TableCell>
                  <TableCell align="right">
                    {monthBalance.vacationDays + monthBalance.plannedVacationDays
                      ? `−${formatDays(monthBalance.vacationDays + monthBalance.plannedVacationDays, locale)}`
                      : '—'}
                  </TableCell>
                </TableRow>
                {(monthBalance.adjustmentMinutes !== 0 || monthBalance.vacationAdjustmentDays !== 0) && (
                  <TableRow>
                    <TableCell>{t('timesheet.carry.adjustments')}</TableCell>
                    <TableCell align="right">{monthBalance.adjustmentMinutes ? formatSignedMinutes(monthBalance.adjustmentMinutes) : '—'}</TableCell>
                    <TableCell align="right">
                      {monthBalance.vacationAdjustmentDays
                        ? `${monthBalance.vacationAdjustmentDays > 0 ? '+' : ''}${formatDays(monthBalance.vacationAdjustmentDays, locale)}`
                        : '—'}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow sx={{ '& td': { fontWeight: 600, borderBottom: 'none' } }}>
                  <TableCell>{t('timesheet.carry.closing', { month: monthName(period, locale) })}</TableCell>
                  <TableCell align="right" sx={{ color: monthBalance.overtimeBalance < 0 ? 'error.main' : undefined }}>
                    {formatSignedMinutes(monthBalance.overtimeBalance)}
                  </TableCell>
                  <TableCell align="right" sx={{ color: monthBalance.vacationBalance < 0 ? 'error.main' : undefined }}>
                    {formatDays(monthBalance.vacationBalance, locale)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {!monthOver && (
              <Typography variant="caption" color="text.secondary">{t('timesheet.carry.note')}</Typography>
            )}
          </Paper>
        )}

        <TableContainer sx={{ mb: 2, maxHeight: 520 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t('timesheet.day')}</TableCell>
                <TableCell align="right">{t('timesheet.target')}</TableCell>
                <TableCell align="right">{t('timesheet.workHours')}</TableCell>
                <TableCell align="right">{t('timesheet.difference')}</TableCell>
                <TableCell>{t('timesheet.dayNote')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {days.map((d) => {
                const past = d.date < today;
                const free = d.scheduled === 0;
                const diff = d.attended - d.target;
                const notes = [
                  d.holidayInfo ? holidayName(d.holidayInfo, locale) : '',
                  d.absence > 0 ? `${absenceLabel(d.absenceType)}${d.absence < d.scheduled - d.holiday ? ` (${t('workTimeSettings.halfDay')})` : ''}` : '',
                ].filter(Boolean);
                const [y, m, dd] = d.date.split('-').map(Number);
                return (
                  <TableRow key={d.date} sx={{ opacity: free && d.attended === 0 ? 0.5 : 1, bgcolor: d.date === today ? 'action.selected' : undefined }}>
                    <TableCell>{new Date(y, m - 1, dd).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</TableCell>
                    <TableCell align="right">{d.target ? formatDurationMinutes(d.target) : '—'}</TableCell>
                    <TableCell align="right">{d.attended ? formatDurationMinutes(d.attended) : past && d.target ? formatDurationMinutes(0) : '—'}</TableCell>
                    <TableCell align="right" sx={{ color: past && diff < 0 ? 'error.main' : undefined }}>
                      {past && (d.target || d.attended) ? formatSignedMinutes(diff) : ''}
                    </TableCell>
                    <TableCell>{notes.join(' · ')}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('timesheet.projectInfo', { value: formatDurationMinutes(totalProjectMinutes), count: String(monthEntries.length) })}
          {monthBalance && monthBalance.vacationDays > 0 && ` · ${t('timesheet.vacationTaken', { value: formatDays(monthBalance.vacationDays, locale) })}`}
        </Typography>

        {(status === 'open' || status === 'rejected') && (
          <Alert severity={monthOver ? 'info' : 'warning'} sx={{ mb: 1.5, maxWidth: 900 }}>
            {monthOver ? t('timesheet.submitExplain') : t('timesheet.submitEarly')}
          </Alert>
        )}

        {(status === 'open' || status === 'rejected') && (
          <TextField
            size="small"
            label={t('timesheet.submitNote')}
            placeholder={t('timesheet.submitNotePlaceholder')}
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
            multiline
            fullWidth
            minRows={4}
            sx={{
              display: 'flex',
              mb: 1.5,
              maxWidth: 900,
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
