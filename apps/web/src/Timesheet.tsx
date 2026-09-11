import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';

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

interface TimesheetProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Timesheet({ orgId, userId, authHeaders }: TimesheetProps) {
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(currentPeriodStart());

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

  async function submit() {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/timesheet-periods/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ periodStart: period }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'already-submitted' ? 'This month was already submitted.' : `Failed to submit (${data.error ?? 'unknown error'}).`);
        return;
      }
      setSuccess('Submitted for approval.');
      await reload();
    } catch {
      setError('Failed to submit. Is the API running?');
    }
  }

  const history = [...periods]
    .filter((p) => p.period_start !== period)
    .sort((a, b) => (a.period_start < b.period_start ? 1 : -1));

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6">Monthly Timesheet</Typography>
        <Chip label={status} color={STATUS_COLOR[status]} size="small" />
      </Box>

      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 1 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {status === 'rejected' && current?.review_note && (
        <Alert severity="warning" sx={{ mt: 1 }}>Rejected: {current.review_note}</Alert>
      )}
      {loading && <LinearProgress sx={{ mt: 1 }} />}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 2, mb: 1, flexWrap: 'wrap' }}>
        <Button size="small" onClick={() => setPeriod((p) => shiftMonth(p, -1))}>‹ Prev</Button>
        <TextField
          type="month"
          size="small"
          value={toMonthInput(period)}
          onChange={(e) => e.target.value && setPeriod(fromMonthInput(e.target.value))}
        />
        <Button size="small" onClick={() => setPeriod((p) => shiftMonth(p, 1))}>Next ›</Button>
        {period !== currentPeriodStart() && (
          <Button size="small" onClick={() => setPeriod(currentPeriodStart())}>This month</Button>
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
        Viewing {period.slice(0, 7)}. Submit once your hours for the month are complete — a
        manager will need to approve it, and the month locks against further edits while submitted or approved.
      </Typography>

      <Button variant="contained" size="small" onClick={submit} disabled={status === 'submitted' || status === 'approved'}>
        {status === 'approved' ? 'Approved' : status === 'submitted' ? 'Pending approval' : status === 'rejected' ? 'Resubmit' : 'Submit for approval'}
      </Button>

      {history.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>History</Typography>
          <Table size="small">
            <TableHead><TableRow><TableCell>Period</TableCell><TableCell>Status</TableCell><TableCell>Note</TableCell></TableRow></TableHead>
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
