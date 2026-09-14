import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useT } from './i18n';

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

const REOPEN_ERROR_MESSAGES: Record<string, (t: (key: string) => string) => string> = {
  'reason-required': (t) => t('timesheet.reopenReasonRequired'),
  'no-manager-to-ask': (t) => t('timesheet.reopenNoManager'),
  'already-requested': (t) => t('timesheet.reopenAlreadyRequested'),
  'not-approved': (t) => t('timesheet.reopenNotApproved'),
};

/** First day of the current month, e.g. '2026-09-01'. */
function currentPeriodStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** 'YYYY-MM-01' <-> the 'YYYY-MM' shape a month input wants. */
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

/** 'YYYY-MM-DD' -> 'DD.MM.YYYY'. */
function toDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/**
 * A generic, human title for a timesheet period, e.g. '01.09.2026-01.10.2026' for September 2026 —
 * its start date through the (exclusive) start of the next month. Referenced by name
 * ("getSourceTitle") from `workflow_definitions.steps[].source_name`, so a workflow row whose source
 * is a timesheet period can show a "Corresponding object" title without Workflow/Approvals code
 * needing to know anything about timesheets.
 */
export function getSourceTitle(periodStart: string): string {
  return `${toDisplayDate(periodStart)}-${toDisplayDate(nextMonthStart(periodStart))}`;
}

/** First day of the month after `periodStart` (a 'YYYY-MM-DD' string). */
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
  const t = useT();
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
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

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

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
      reloadReopenRequest(current.id);
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

  const history = [...periods]
    .filter((p) => p.period_start !== period)
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1));

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">{t('timesheet.title')}</Typography>
        <Chip label={status} color={STATUS_COLOR[status]} size="small" />
      </Box>

      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 1 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {status === 'rejected' && current?.review_note && (
        <Alert severity="warning" sx={{ mt: 1 }}>{t('timesheet.rejected', { note: current.review_note })}</Alert>
      )}
      {loading && <LinearProgress sx={{ mt: 1 }} />}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 2, mb: 1, flexWrap: 'wrap' }}>
        <Button size="small" onClick={() => setPeriod((p) => shiftMonth(p, -1))}>{t('timesheet.prev')}</Button>
        <TextField
          type="month"
          size="small"
          value={toMonthInput(period)}
          onChange={(e) => e.target.value && setPeriod(fromMonthInput(e.target.value))}
        />
        <Button size="small" onClick={() => setPeriod((p) => shiftMonth(p, 1))}>{t('timesheet.next')}</Button>
        {period !== currentPeriodStart() && (
          <Button size="small" onClick={() => setPeriod(currentPeriodStart())}>{t('timesheet.thisMonth')}</Button>
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
        {t('timesheet.viewing', { period: period.slice(0, 7) })}
      </Typography>

      {(status === 'open' || status === 'rejected') && (
        <TextField
          size="small"
          label={t('timesheet.submitNote')}
          placeholder={t('timesheet.submitNotePlaceholder')}
          value={submitNote}
          onChange={(e) => setSubmitNote(e.target.value)}
          multiline
          rows={1}        
          sx={{
            display: 'block',
            mb: 1.5,
            width: '500px',
            minWidth: '500px',
            maxWidth: '1000px',
            '& textarea': {
              resize: 'both',
              minHeight: 40,
              minWidth: 500,
            },
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

      {history.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{t('timesheet.history')}</Typography>
          <Table size="small">
            <TableHead><TableRow><TableCell>{t('time.period')}</TableCell><TableCell>{t('timesheet.status')}</TableCell><TableCell>{t('timesheet.note')}</TableCell></TableRow></TableHead>
            <TableBody>
              {history.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.period_start.slice(0, 7)}</TableCell>
                  <TableCell><Chip label={p.status} size="small" color={STATUS_COLOR[p.status]} /></TableCell>
                  <TableCell>{p.review_note ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </Paper>
  );
}
