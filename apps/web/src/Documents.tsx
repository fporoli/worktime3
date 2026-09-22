import { useEffect, useState } from 'react';
import { Alert, Button, Chip, FormControl, InputLabel, LinearProgress, MenuItem, Paper, Select, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface DocumentRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  kind: 'expense-receipt' | 'absence-certificate' | 'document';
  expense_date: string | null;
  expense_category: string | null;
  absence_start: string | null;
  absence_end: string | null;
  absence_type: string | null;
}

interface Props {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

type DocumentKind = 'all' | 'expense-receipt' | 'absence-certificate';
type DateRange = 'all' | 'today' | 'current-week' | 'current-month' | 'last-month' | 'current-year';

function dateRange(range: DateRange): { from?: string; to?: string } {
  if (range === 'all') return {};
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'current-week') {
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  } else if (range === 'current-month') {
    start.setDate(1);
  } else if (range === 'last-month') {
    start.setMonth(start.getMonth() - 1, 1);
  } else if (range === 'current-year') {
    start.setMonth(0, 1);
  }
  const end = new Date(start);
  if (range === 'today') end.setDate(end.getDate() + 1);
  else if (range === 'current-week') end.setDate(end.getDate() + 7);
  else if (range === 'current-month') end.setMonth(end.getMonth() + 1, 1);
  else if (range === 'last-month') end.setMonth(end.getMonth() + 1, 1);
  else if (range === 'current-year') end.setFullYear(end.getFullYear() + 1, 0, 1);
  const localDate = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  return { from: localDate(start), to: localDate(end) };
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents({ orgId, authHeaders }: Props) {
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>('all');
  const [range, setRange] = useState<DateRange>('all');

  async function reload() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (kind !== 'all') params.set('kind', kind);
      const dates = dateRange(range);
      if (dates.from) params.set('from', dates.from);
      if (dates.to) params.set('to', dates.to);
      const query = params.toString();
      const response = await fetch(`${API}/organizations/${orgId}/documents${query ? `?${query}` : ''}`, { headers: await authHeaders() });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error('request-failed');
      setRows(data);
    } catch {
      setError('Could not load documents.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, kind, range]);

  async function download(row: DocumentRow) {
    try {
      const response = await fetch(`${API}/documents/${row.id}`, { headers: await authHeaders() });
      if (!response.ok) throw new Error('request-failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = row.file_name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download document.');
    }
  }

  function source(row: DocumentRow): string {
    if (row.kind === 'expense-receipt') return `Expense · ${row.expense_category ?? '—'} · ${row.expense_date?.slice(0, 10) ?? '—'}`;
    if (row.kind === 'absence-certificate') return `Absence · ${row.absence_type ?? '—'} · ${row.absence_start?.slice(0, 10) ?? '—'}${row.absence_end && row.absence_end !== row.absence_start ? ` – ${row.absence_end.slice(0, 10)}` : ''}`;
    return 'Document';
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Documents</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        User-uploaded and user-relevant documents, including absence certificates and expense receipts.
      </Typography>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <FormControl size="small" sx={{ minWidth: 210 }}>
          <InputLabel>Document type</InputLabel>
          <Select value={kind} label="Document type" onChange={(event) => setKind(event.target.value as DocumentKind)}>
            <MenuItem value="all">All documents</MenuItem>
            <MenuItem value="expense-receipt">Receipts</MenuItem>
            <MenuItem value="absence-certificate">Absence justifications</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 190 }}>
          <InputLabel>Date range</InputLabel>
          <Select value={range} label="Date range" onChange={(event) => setRange(event.target.value as DateRange)}>
            <MenuItem value="all">All time</MenuItem>
            <MenuItem value="today">Today</MenuItem>
            <MenuItem value="current-week">Current week</MenuItem>
            <MenuItem value="current-month">Current month</MenuItem>
            <MenuItem value="last-month">Last month</MenuItem>
            <MenuItem value="current-year">Current year</MenuItem>
          </Select>
        </FormControl>
      </div>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      <Table size="small">
        <TableHead><TableRow><TableCell>Document</TableCell><TableCell>Type</TableCell><TableCell>Source</TableCell><TableCell>Uploaded</TableCell><TableCell align="right">Size</TableCell><TableCell align="right" /></TableRow></TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell sx={{ fontWeight: 600 }}>{row.file_name}</TableCell>
              <TableCell><Chip size="small" label={row.kind === 'expense-receipt' ? 'Expense receipt' : row.kind === 'absence-certificate' ? 'Absence certificate' : 'Document'} /></TableCell>
              <TableCell>{source(row)}</TableCell>
              <TableCell>{formatDate(row.created_at)}</TableCell>
              <TableCell align="right">{formatSize(row.size_bytes)}</TableCell>
              <TableCell align="right"><Button size="small" onClick={() => void download(row)}>Download</Button></TableCell>
            </TableRow>
          ))}
          {!loading && rows.length === 0 && <TableRow><TableCell colSpan={6}>No documents yet.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Paper>
  );
}
