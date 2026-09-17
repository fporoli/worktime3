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
import { getSourceTitle } from './Timesheet';
import { getExpenseReportTitle } from './ExpenseReports';
import type { ExpenseRow } from './Expenses';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface PeriodRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  period_start: string;
}

interface ExpenseReportRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  status: string;
  date_submitted: string | null;
}

/** A workflow row assigned to the caller — generic across every workflow_definitions type. */
interface ActionItem {
  id: string;
  source_table: string;
  step_status: 'pending' | 'approved' | 'rejected';
  workflow_data: { reason?: string; note?: string; decisionNote?: string | null };
  started: string | null;
  definition_name: string;
  /** Human label for the kind of record this workflow concerns, e.g. "Timesheet Period" — from the step's `source`. */
  source: string | null;
  /** Which formatter in `SOURCE_TITLE_FNS` renders this record's title — from the step's `source_name`. */
  source_name: string | null;
  timesheet_period: PeriodRow | null;
  expense_report: ExpenseReportRow | null;
}

/** Friendly label for a workflow_definitions name — unrecognized ones just show as-is, so new workflow types need no frontend change to appear. */
function actionItemLabel(definitionName: string): string {
  if (definitionName === 'approve timesheet') return 'Timesheet approval';
  if (definitionName === 'reopen approved timesheet') return 'Reopen request';
  if (definitionName === 'approve expense report') return 'Expense report approval';
  return definitionName;
}

function actionItemDetail(item: ActionItem): string {
  return item.workflow_data.reason || item.workflow_data.note || '—';
}

/**
 * Registry of `source_name` -> title formatter, keyed by the name a workflow_definitions step
 * configures. Lets a new source type show a "Corresponding object" title with no change here —
 * only a new entry in this map once its formatter exists.
 */
const SOURCE_TITLE_FNS: Record<string, (item: ActionItem) => string | null> = {
  getSourceTitle: (item) => (item.timesheet_period ? getSourceTitle(item.timesheet_period.period_start) : null),
  getExpenseReportTitle: (item) => (item.expense_report ? getExpenseReportTitle(item.expense_report) : null),
};

/** "<source> <formatted title>", e.g. "Timesheet Period 01.09.2026-01.10.2026" — or just the source, or '—' if neither is configured. */
function correspondingObject(item: ActionItem): string {
  if (!item.source) return '—';
  const fn = item.source_name ? SOURCE_TITLE_FNS[item.source_name] : undefined;
  const title = fn?.(item);
  return title ? `${item.source} ${title}` : item.source;
}

interface ApprovalsProps {
  orgId: string;
  role: 'admin' | 'manager' | 'user';
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Approvals({ orgId, role, authHeaders }: ApprovalsProps) {
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [approved, setApproved] = useState<PeriodRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [inspectingPeriod, setInspectingPeriod] = useState<PeriodRow | null>(null);
  const [inspectingActionItemId, setInspectingActionItemId] = useState<string | null>(null);
  const [inspectingEntries, setInspectingEntries] = useState<Entry[]>([]);
  const [inspectingLoading, setInspectingLoading] = useState(false);
  const [inspectingError, setInspectingError] = useState<string | null>(null);

  const [inspectingReport, setInspectingReport] = useState<ExpenseReportRow | null>(null);
  const [inspectingReportActionItemId, setInspectingReportActionItemId] = useState<string | null>(null);
  const [inspectingExpenses, setInspectingExpenses] = useState<ExpenseRow[]>([]);
  const [inspectingReportLoading, setInspectingReportLoading] = useState(false);
  const [inspectingReportError, setInspectingReportError] = useState<string | null>(null);

  async function inspect(period: PeriodRow, actionItemId: string | null) {
    setInspectingPeriod(period);
    setInspectingActionItemId(actionItemId);
    setInspectingEntries([]);
    setInspectingLoading(true);
    setInspectingError(null);
    try {
      const { from, to } = periodRange('month', period.period_start.slice(0, 10));
      const url = new URL(`${API}/organizations/${orgId}/project-time`);
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

  async function inspectReport(report: ExpenseReportRow, actionItemId: string | null) {
    setInspectingReport(report);
    setInspectingReportActionItemId(actionItemId);
    setInspectingExpenses([]);
    setInspectingReportLoading(true);
    setInspectingReportError(null);
    try {
      const res = await fetch(`${API}/expense-reports/${report.id}/items`, { headers: await authHeaders() });
      const data = await res.json();
      setInspectingExpenses(Array.isArray(data) ? data : []);
    } catch {
      setInspectingReportError('Failed to load expense report items.');
    } finally {
      setInspectingReportLoading(false);
    }
  }

  async function reload() {
    setLoading(true);
    try {
      const [iRes, aRes] = await Promise.all([
        fetch(`${API}/workflows/assigned-to-me`, { headers: await authHeaders() }),
        fetch(`${API}/organizations/${orgId}/timesheet-periods?status=approved`, { headers: await authHeaders() }),
      ]);
      const i = await iRes.json();
      const a = await aRes.json();
      if (Array.isArray(i)) setActionItems(i);
      if (Array.isArray(a)) setApproved(a);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function approveItem(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/workflows/${id}/approve`, { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) { setError(`Failed to approve (${data.error ?? 'unknown error'}).`); return; }
      setSuccess('Approved.');
      await reload();
    } catch {
      setError('Failed to approve.');
    }
  }

  async function rejectItem(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/workflows/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!data.ok) { setError(`Failed to decline (${data.error ?? 'unknown error'}).`); return; }
      setSuccess('Declined.');
      setRejectingId(null);
      setNote('');
      await reload();
    } catch {
      setError('Failed to decline.');
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

  const filteredActionItems = actionItems.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      item.timesheet_period?.user_display_name,
      item.timesheet_period?.user_email,
      item.expense_report?.user_display_name,
      item.expense_report?.user_email,
      actionItemLabel(item.definition_name),
      correspondingObject(item),
      actionItemDetail(item),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Workflow</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Open workflows assigned to you, directly or through a team — timesheet submissions and reopen requests.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <TextField
        size="small"
        placeholder="Search by member, type, or corresponding object…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2, maxWidth: 320, display: 'block' }}
      />

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Action items ({filteredActionItems.length}{search.trim() ? ` of ${actionItems.length}` : ''})
      </Typography>
      <Table size="small" sx={{ mb: 3 }}>
        <TableHead>
          <TableRow>
            <TableCell>Member</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Corresponding object</TableCell>
            <TableCell>Details</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredActionItems.map((item) => (
            <Fragment key={item.id}>
              <TableRow hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.timesheet_period?.user_display_name ?? item.expense_report?.user_display_name ?? '—'}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.timesheet_period?.user_email ?? item.expense_report?.user_email ?? ''}</Typography>
                </TableCell>
                <TableCell><Chip label={actionItemLabel(item.definition_name)} size="small" variant="outlined" /></TableCell>
                <TableCell>{correspondingObject(item)}</TableCell>
                <TableCell>{actionItemDetail(item)}</TableCell>
                <TableCell align="right">
                  {item.timesheet_period && (
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => inspect(item.timesheet_period!, item.id)}>Inspect</Button>
                  )}
                  {item.expense_report && (
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => inspectReport(item.expense_report!, item.id)}>Inspect</Button>
                  )}
                  <Button size="small" variant="contained" sx={{ mr: 1 }} onClick={() => approveItem(item.id)}>Approve</Button>
                  <Button size="small" color="error" onClick={() => setRejectingId(rejectingId === item.id ? null : item.id)}>Reject</Button>
                </TableCell>
              </TableRow>
              {rejectingId === item.id && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ bgcolor: 'action.hover' }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField size="small" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
                      <Button size="small" color="error" variant="contained" onClick={() => rejectItem(item.id)}>Confirm reject</Button>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
          {filteredActionItems.length === 0 && (
            <TableRow><TableCell colSpan={5}>{actionItems.length === 0 ? 'Nothing pending.' : 'No action items match your search.'}</TableCell></TableRow>
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
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => inspect(p, null)}>Inspect</Button>
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
          {inspectingActionItemId && (
            <>
              <Button
                color="error"
                onClick={() => {
                  const id = inspectingActionItemId;
                  setInspectingPeriod(null);
                  setRejectingId(id);
                }}
              >
                Reject...
              </Button>
              <Button
                variant="contained"
                onClick={async () => {
                  const id = inspectingActionItemId;
                  setInspectingPeriod(null);
                  await approveItem(id);
                }}
              >
                Approve
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!inspectingReport} onClose={() => setInspectingReport(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {inspectingReport ? `Review Expense Report: ${inspectingReport.user_display_name}` : 'Review Expense Report'}
        </DialogTitle>
        <DialogContent dividers>
          {inspectingReportError && <Alert severity="error" sx={{ mb: 2 }}>{inspectingReportError}</Alert>}
          {inspectingReportLoading && <LinearProgress sx={{ mb: 2 }} />}
          {inspectingReport && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{inspectingReport.user_email}</Typography>
          )}
          {inspectingExpenses.length === 0 && !inspectingReportLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No expenses in this report.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Value</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell>Subproject</TableCell>
                  <TableCell>Comment</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {inspectingExpenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.expense_date.slice(0, 10)}</TableCell>
                    <TableCell>{e.category}{e.sub_category ? ` / ${e.sub_category}` : ''}</TableCell>
                    <TableCell align="right">{e.value} {e.currency}</TableCell>
                    <TableCell>{e.project_name ?? '—'}</TableCell>
                    <TableCell>{e.subproject_name ?? '—'}</TableCell>
                    <TableCell>{e.comment ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingReport(null)}>Close</Button>
          {inspectingReportActionItemId && (
            <>
              <Button
                color="error"
                onClick={() => {
                  const id = inspectingReportActionItemId;
                  setInspectingReport(null);
                  setRejectingId(id);
                }}
              >
                Reject...
              </Button>
              <Button
                variant="contained"
                onClick={async () => {
                  const id = inspectingReportActionItemId;
                  setInspectingReport(null);
                  await approveItem(id);
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
