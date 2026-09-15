import { useEffect, useState } from 'react';
import { Alert, Button, Chip, LinearProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

// The forward-only finance pipeline once a report is approved — mirrors ExpenseReportsController's PIPELINE.
const PIPELINE = ['approved', 'submitted_processing', 'processing_finished', 'request_payment', 'finished'] as const;
type PipelineStatus = (typeof PIPELINE)[number];

const STAGE_LABEL: Record<PipelineStatus, string> = {
  approved: 'Approved',
  submitted_processing: 'Processing',
  processing_finished: 'Processing finished',
  request_payment: 'Payment requested',
  finished: 'Finished',
};

function nextStage(status: string): PipelineStatus | null {
  const idx = PIPELINE.indexOf(status as PipelineStatus);
  if (idx === -1 || idx === PIPELINE.length - 1) return null;
  return PIPELINE[idx + 1];
}

interface ReportRow {
  id: string;
  status: PipelineStatus;
  date_submitted: string | null;
  user_display_name: string;
  user_email: string;
}

interface ExpenseProcessingProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

// The queue statuses shown here — every stage except the terminal "finished" one, which has
// nothing left to advance and so belongs in history, not an action queue.
const QUEUE_STATUSES: PipelineStatus[] = ['approved', 'submitted_processing', 'processing_finished', 'request_payment'];

export default function ExpenseProcessing({ orgId, authHeaders }: ExpenseProcessingProps) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function reload() {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const results = await Promise.all(
        QUEUE_STATUSES.map((status) =>
          fetch(`${API}/organizations/${orgId}/expense-reports?status=${status}`, { headers }).then((r) => r.json()),
        ),
      );
      const merged = results.flatMap((r) => (Array.isArray(r) ? r : []));
      merged.sort((a, b) => (a.date_submitted ?? '') < (b.date_submitted ?? '') ? 1 : -1);
      setRows(merged);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function advance(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/expense-reports/${id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ note: notes[id] || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? 'Only a billing admin or org admin may advance a report.' : `Failed to advance (${data.error ?? 'unknown error'}).`);
        return;
      }
      setSuccess(`Advanced to "${STAGE_LABEL[data.status as PipelineStatus] ?? data.status}".`);
      setNotes((prev) => ({ ...prev, [id]: '' }));
      await reload();
    } catch {
      setError('Failed to advance.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Expense Processing</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Approved expense reports moving through the finance pipeline — advance each one stage at a time.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Member</TableCell>
            <TableCell>Stage</TableCell>
            <TableCell>Submitted</TableCell>
            <TableCell>Note (optional)</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const next = nextStage(row.status);
            return (
              <TableRow key={row.id} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.user_display_name}</Typography>
                  <Typography variant="caption" color="text.secondary">{row.user_email}</Typography>
                </TableCell>
                <TableCell><Chip label={STAGE_LABEL[row.status]} size="small" /></TableCell>
                <TableCell>{row.date_submitted ? row.date_submitted.slice(0, 10) : '—'}</TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    value={notes[row.id] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    fullWidth
                  />
                </TableCell>
                <TableCell align="right">
                  {next && (
                    <Button size="small" variant="contained" onClick={() => advance(row.id)}>
                      Advance to "{STAGE_LABEL[next]}"
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={5}>Nothing to process.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
