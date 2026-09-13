import { Fragment, useEffect, useState } from 'react';
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
import { minutes, periodLabel, periodRange, type Entry } from './aggregate';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface PeriodRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  period_start: string;
  submitted_at: string | null;
}

interface ApprovalsProps {
  orgId: string;
  role: 'admin' | 'manager' | 'user';
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Approvals({ orgId, role, authHeaders }: ApprovalsProps) {
  const [pending, setPending] = useState<PeriodRow[]>([]);
  const [approved, setApproved] = useState<PeriodRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);

  const [inspectingPeriod, setInspectingPeriod] = useState<PeriodRow | null>(null);
  const [inspectingEntries, setInspectingEntries] = useState<Entry[]>([]);
  const [inspectingLoading, setInspectingLoading] = useState(false);
  const [inspectingError, setInspectingError] = useState<string | null>(null);

  async function inspect(period: PeriodRow) {
    setInspectingPeriod(period);
    setInspectingEntries([]);
    setInspectingLoading(true);
    setInspectingError(null);
    try {
      const { from, to } = periodRange('month', period.period_start.slice(0, 10));
      const url = new URL(`${API}/organizations/${orgId}/work-time`);
      url.searchParams.set('userId', period.user_id);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      const res = await fetch(url.toString(), { headers: await authHeaders() });
      const data = await res.json();
      setInspectingEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setInspectingError('Failed to load timesheet entries.');
    } finally {
      setInspectingLoading(false);
    }
  }

  async function reload() {
    setLoading(true);
    try {
      const [pRes, aRes] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/timesheet-periods?status=submitted`, { headers: await authHeaders() }),
        fetch(`${API}/organizations/${orgId}/timesheet-periods?status=approved`, { headers: await authHeaders() }),
      ]);
      const p = await pRes.json();
      const a = await aRes.json();
      if (Array.isArray(p)) setPending(p);
      if (Array.isArray(a)) setApproved(a);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function approve(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/timesheet-periods/${id}/approve`, { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) { setError(`Failed to approve (${data.error ?? 'unknown error'}).`); return; }
      setSuccess('Approved.');
      await reload();
    } catch {
      setError('Failed to approve.');
    }
  }

  async function reject(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/timesheet-periods/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!data.ok) { setError(`Failed to reject (${data.error ?? 'unknown error'}).`); return; }
      setSuccess('Rejected — the employee can now edit and resubmit.');
      setRejectingId(null);
      setNote('');
      await reload();
    } catch {
      setError('Failed to reject.');
    }
  }

  async function reopen(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/timesheet-periods/${id}/reopen`, { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? 'Only admins can reopen an approved period.' : `Failed to reopen (${data.error ?? 'unknown error'}).`);
        return;
      }
      setSuccess('Reopened for corrections.');
      await reload();
    } catch {
      setError('Failed to reopen.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Timesheet Approvals</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {role === 'admin'
          ? "Review monthly timesheets submitted by your organization's members."
          : 'Review monthly timesheets submitted by your direct reports.'}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Typography variant="subtitle1" sx={{ mb: 1 }}>Pending ({pending.length})</Typography>
      <Table size="small" sx={{ mb: 3 }}>
        <TableHead>
          <TableRow>
            <TableCell>Member</TableCell>
            <TableCell>Period</TableCell>
            <TableCell>Submitted</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {pending.map((p) => (
            <Fragment key={p.id}>
              <TableRow hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.user_display_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{p.user_email}</Typography>
                </TableCell>
                <TableCell>{p.period_start.slice(0, 7)}</TableCell>
                <TableCell>{p.submitted_at ? new Date(p.submitted_at).toLocaleString() : '—'}</TableCell>
                <TableCell align="right">
                  <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => inspect(p)}>Inspect</Button>
                  <Button size="small" variant="contained" sx={{ mr: 1 }} onClick={() => approve(p.id)}>Approve</Button>
                  <Button size="small" color="error" onClick={() => setRejectingId(rejectingId === p.id ? null : p.id)}>Reject</Button>
                </TableCell>
              </TableRow>
              {rejectingId === p.id && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ bgcolor: 'action.hover' }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField size="small" label="Reason" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
                      <Button size="small" color="error" variant="contained" onClick={() => reject(p.id)}>Confirm reject</Button>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
          {pending.length === 0 && (
            <TableRow><TableCell colSpan={4}>Nothing pending.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      {role === 'admin' && (
        <>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>Approved ({approved.length})</Typography>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Member</TableCell><TableCell>Period</TableCell><TableCell align="right">Actions</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {approved.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>{p.user_display_name}</TableCell>
                  <TableCell>{p.period_start.slice(0, 7)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => inspect(p)}>Inspect</Button>
                    <Button size="small" onClick={() => reopen(p.id)}>Reopen</Button>
                  </TableCell>
                </TableRow>
              ))}
              {approved.length === 0 && (
                <TableRow><TableCell colSpan={3}>None yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </>
      )}

      <Dialog open={!!inspectingPeriod} onClose={() => setInspectingPeriod(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {inspectingPeriod ? `Review Timesheet: ${inspectingPeriod.user_display_name} (${periodLabel('month', inspectingPeriod.period_start.slice(0, 10))})` : 'Review Timesheet'}
        </DialogTitle>
        <DialogContent dividers>
          {inspectingError && <Alert severity="error" sx={{ mb: 2 }}>{inspectingError}</Alert>}
          {inspectingLoading && <LinearProgress sx={{ mb: 2 }} />}
          {inspectingPeriod && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {inspectingPeriod.user_email}
              </Typography>
              <Chip
                label={`Total: ${Math.floor(inspectingEntries.reduce((sum, e) => sum + minutes(e), 0) / 60)}h ${Math.round(inspectingEntries.reduce((sum, e) => sum + minutes(e), 0) % 60)}m`}
                color="primary"
                variant="outlined"
              />
            </Box>
          )}
          {inspectingEntries.length === 0 && !inspectingLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No entries logged for this period.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell align="right">Duration</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell>Subproject</TableCell>
                  <TableCell>Comment</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {inspectingEntries.map((e) => {
                  const m = Math.round(minutes(e));
                  const h = Math.floor(m / 60);
                  const rem = m % 60;
                  const startTime = new Date(e.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const endTime = new Date(e.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <TableRow key={e.id}>
                      <TableCell>{new Date(e.start_time).toLocaleDateString()}</TableCell>
                      <TableCell>{`${startTime} – ${endTime}`}</TableCell>
                      <TableCell align="right">{`${h}h ${rem}m`}</TableCell>
                      <TableCell>{e.project_name ?? '—'}</TableCell>
                      <TableCell>{e.subproject_name ?? '—'}</TableCell>
                      <TableCell>{e.comment ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingPeriod(null)}>Close</Button>
          {inspectingPeriod && pending.some((p) => p.id === inspectingPeriod.id) && (
            <>
              <Button
                color="error"
                onClick={() => {
                  const id = inspectingPeriod.id;
                  setInspectingPeriod(null);
                  setRejectingId(id);
                }}
              >
                Reject...
              </Button>
              <Button
                variant="contained"
                onClick={async () => {
                  const id = inspectingPeriod.id;
                  setInspectingPeriod(null);
                  await approve(id);
                }}
              >
                Approve
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
