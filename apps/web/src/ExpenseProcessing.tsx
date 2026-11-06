import { useEffect, useState } from 'react';
import { Alert, Button, Chip, LinearProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useI18n, type TFunction } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

// The forward-only finance pipeline once a report is approved — mirrors ExpenseReportsController's PIPELINE.
const PIPELINE = ['approved', 'submitted_processing', 'processing_finished', 'request_payment', 'finished'] as const;
type PipelineStatus = (typeof PIPELINE)[number];

/** Translated stage name; an unknown status is shown as-is. */
function stageLabel(status: string, t: TFunction): string {
  return (PIPELINE as readonly string[]).includes(status) ? t(`expenseProcessing.stage.${status}`) : status;
}

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
  const { t, locale } = useI18n();
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
        setError(data.error === 'forbidden' ? t('expenseProcessing.forbidden') : t('expenseProcessing.advanceFailedWith', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setSuccess(t('expenseProcessing.advanced', { stage: stageLabel(data.status, t) }));
      setNotes((prev) => ({ ...prev, [id]: '' }));
      await reload();
    } catch {
      setError(t('expenseProcessing.advanceFailed'));
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('expenseProcessing.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('expenseProcessing.subtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('teamHours.member')}</TableCell>
            <TableCell>{t('expenseProcessing.stage')}</TableCell>
            <TableCell>{t('expenseProcessing.submitted')}</TableCell>
            <TableCell>{t('approvals.note')}</TableCell>
            <TableCell align="right">{t('common.actions')}</TableCell>
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
                <TableCell><Chip label={stageLabel(row.status, t)} size="small" /></TableCell>
                <TableCell>{row.date_submitted ? new Date(`${row.date_submitted.slice(0, 10)}T00:00:00`).toLocaleDateString(locale) : '—'}</TableCell>
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
                      {t('expenseProcessing.advanceTo', { stage: stageLabel(next, t) })}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={5}>{t('expenseProcessing.empty')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
