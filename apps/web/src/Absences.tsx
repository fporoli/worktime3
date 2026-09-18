import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useT } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Status = 'pending' | 'approved' | 'rejected';

/** Built-in absence types — mirrors apps/api/src/absence-types.ts's DEFAULT_ABSENCE_TYPES, the
 * fallback used when an org hasn't customized its static_data (entity="absences",
 * enum_name="absence_type") row. */
const DEFAULT_ABSENCE_TYPES = ['vacation', 'military_service', 'accident', 'compensation', 'school', 'sickness', 'other'];

interface AbsenceRow {
  id: string;
  date_start: string;
  date_end: string;
  status: Status;
  absence_type: string;
  half_day: boolean;
  document_id: string | null;
  note: string | null;
  review_note: string | null;
}

interface DocumentMeta {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

const STATUS_COLOR: Record<Status, 'default' | 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

/** 'YYYY-MM-DD' -> 'DD.MM.YYYY'. */
function toDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/**
 * A generic, human title for a vacation request. Referenced by name
 * ("getAbsenceTitle") from `workflow_definitions.steps[].source_name`, so a
 * workflow row whose source is an absence can show a title without
 * Workflow/Approvals code needing to know anything about absences.
 */
export function getAbsenceTitle(row: { date_start: string; date_end: string }): string {
  return row.date_start === row.date_end ? toDisplayDate(row.date_start) : `${toDisplayDate(row.date_start)}–${toDisplayDate(row.date_end)}`;
}

interface AbsencesProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Absences({ orgId, userId, authHeaders }: AbsencesProps) {
  const t = useT();
  const [requests, setRequests] = useState<AbsenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [note, setNote] = useState('');
  const [absenceType, setAbsenceType] = useState('vacation');
  const [halfDay, setHalfDay] = useState(false);
  const [absenceTypes, setAbsenceTypes] = useState<string[]>(DEFAULT_ABSENCE_TYPES);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [viewingDocumentFor, setViewingDocumentFor] = useState<string | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentMeta | null>(null);

  const isSingleDay = !!dateStart && dateStart === dateEnd;

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/absences?userId=${userId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setRequests(data);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  async function loadAbsenceTypes() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data/absences`, { headers: await authHeaders() });
      const data = await res.json();
      const row = Array.isArray(data) ? data.find((r) => r.enum_name === 'absence_type') : null;
      const keys = row?.values && typeof row.values === 'object' ? Object.keys(row.values) : null;
      if (keys && keys.length > 0) setAbsenceTypes(keys);
    } catch { /* offline fallback keeps the built-in defaults */ }
  }

  useEffect(() => {
    reload();
    loadAbsenceTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  useEffect(() => {
    if (!isSingleDay) setHalfDay(false);
  }, [isSingleDay]);

  /** Human label for an absence type — a known key gets its translation, an org-added custom key just shows as-is. */
  function typeLabel(type: string): string {
    const known = DEFAULT_ABSENCE_TYPES.includes(type);
    return known ? t(`absences.type.${type}`) : type;
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    if (!dateStart || !dateEnd) {
      setError(t('absences.datesRequired'));
      return;
    }
    try {
      const res = await fetch(`${API}/organizations/${orgId}/absences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ dateStart, dateEnd, note, absenceType, halfDay: isSingleDay && halfDay }),
      });
      const data = await res.json();
      if (!data.ok) {
        const messages: Record<string, string> = {
          'overlapping-request': t('absences.overlapping'),
          'half-day-requires-single-day': t('absences.halfDayRequiresSingleDay'),
          'invalid-absence-type': t('absences.invalidAbsenceType'),
        };
        setError(messages[data.error] ?? t('absences.submitFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      if (file) {
        const form = new FormData();
        form.append('file', file);
        try {
          const uploadRes = await fetch(`${API}/organizations/${orgId}/absences/${data.id}/document`, {
            method: 'POST',
            headers: await authHeaders(),
            body: form,
          });
          const uploadData = await uploadRes.json();
          if (!uploadData.ok) setError(t('absences.uploadFailed', { error: uploadData.error ?? 'unknown error' }));
        } catch {
          setError(t('absences.uploadFailed', { error: 'offline' }));
        }
      }
      setSuccess(data.autoApproved ? t('absences.autoApproved') : t('absences.submitted'));
      setDateStart('');
      setDateEnd('');
      setNote('');
      setAbsenceType('vacation');
      setHalfDay(false);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await reload();
    } catch {
      setError(t('absences.submitFailed', { error: 'offline' }));
    }
  }

  async function cancel(id: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/absences/${id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(t('absences.cancelFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reload();
    } catch {
      setError(t('absences.cancelFailed', { error: 'offline' }));
    }
  }

  async function viewDocument(id: string) {
    setViewingDocumentFor(id);
    setViewingDocument(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/absences/${id}/document`, { headers: await authHeaders() });
      const data = await res.json();
      if (data) setViewingDocument(data);
    } catch { /* offline fallback */ }
  }

  async function downloadDocument(absenceId: string, doc: DocumentMeta) {
    try {
      const res = await fetch(`${API}/absences/${absenceId}/document`, { headers: await authHeaders() });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* offline fallback */ }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('absences.title')}</Typography>

      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 1 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mt: 1 }} />}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap', mt: 2, mb: 2 }}>
        <TextField label={t('absences.dateFrom')} type="date" size="small" value={dateStart} onChange={(e) => setDateStart(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField label={t('absences.dateTo')} type="date" size="small" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} InputLabelProps={{ shrink: true }} />
        <Select size="small" value={absenceType} onChange={(e) => setAbsenceType(e.target.value)} sx={{ minWidth: 160 }}>
          {absenceTypes.map((type) => (
            <MenuItem key={type} value={type}>{typeLabel(type)}</MenuItem>
          ))}
        </Select>
        {isSingleDay && (
          <ToggleButtonGroup value={halfDay ? 'half' : 'full'} exclusive onChange={(_, v) => v && setHalfDay(v === 'half')} size="small">
            <ToggleButton value="full">{t('absences.dayType.full')}</ToggleButton>
            <ToggleButton value="half">{t('absences.dayType.half')}</ToggleButton>
          </ToggleButtonGroup>
        )}
        <TextField label={t('time.comment')} size="small" value={note} onChange={(e) => setNote(e.target.value)} sx={{ minWidth: 220, flex: 1 }} />
        <Button variant="outlined" size="small" component="label">
          {file ? file.name : t('absences.attachDocument')}
          <input ref={fileInputRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Button>
        <Button variant="contained" size="small" onClick={submit}>{t('absences.request')}</Button>
      </Box>

      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>{t('absences.myRequests')}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('absences.dateFrom')}</TableCell>
            <TableCell>{t('absences.dateTo')}</TableCell>
            <TableCell>{t('absences.type')}</TableCell>
            <TableCell>{t('timesheet.status')}</TableCell>
            <TableCell>{t('time.comment')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {requests.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{toDisplayDate(r.date_start)}</TableCell>
              <TableCell>{toDisplayDate(r.date_end)}</TableCell>
              <TableCell>
                <Chip label={typeLabel(r.absence_type)} size="small" variant="outlined" />
                {r.half_day && <Chip label={t('absences.dayType.half')} size="small" sx={{ ml: 0.5 }} />}
              </TableCell>
              <TableCell><Chip label={t(`absences.status.${r.status}`)} size="small" color={STATUS_COLOR[r.status]} /></TableCell>
              <TableCell>{r.status === 'rejected' && r.review_note ? r.review_note : (r.note ?? '')}</TableCell>
              <TableCell align="right">
                {r.document_id && (
                  <Button size="small" onClick={() => viewDocument(r.id)} sx={{ mr: 1 }}>{t('absences.documents')}</Button>
                )}
                {r.status === 'pending' && (
                  <Button size="small" color="error" onClick={() => cancel(r.id)}>{t('absences.cancel')}</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {requests.length === 0 && (
            <TableRow><TableCell colSpan={6}>{t('time.noEntries')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      {viewingDocumentFor && (
        <Box sx={{ mt: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2">{t('absences.documents')}</Typography>
            <Button size="small" onClick={() => setViewingDocumentFor(null)}>×</Button>
          </Box>
          {viewingDocument ? (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
              <Typography variant="body2">{viewingDocument.file_name}</Typography>
              <Button size="small" onClick={() => downloadDocument(viewingDocumentFor, viewingDocument)}>{t('absences.download')}</Button>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">{t('absences.noDocuments')}</Typography>
          )}
        </Box>
      )}
    </Paper>
  );
}
