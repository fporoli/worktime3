import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { useI18n } from './i18n';
import { formatFileSize, formatLocaleDate } from './localeFormat';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { BeachAccessIcon, DeleteIcon, DownloadIcon, UploadIcon, VisibilityIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Status = 'pending' | 'approved' | 'rejected';

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

function toDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function getAbsenceTitle(row: { date_start: string; date_end: string }): string {
  return row.date_start === row.date_end ? toDisplayDate(row.date_start) : `${toDisplayDate(row.date_start)}–${toDisplayDate(row.date_end)}`;
}

interface AbsencesProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Absences({ orgId, userId, authHeaders }: AbsencesProps) {
  const { t, locale } = useI18n();
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

  const [viewingRow, setViewingRow] = useState<AbsenceRow | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | null>(null);

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
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    void reload();
    void loadAbsenceTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  useEffect(() => {
    if (!isSingleDay) setHalfDay(false);
  }, [isSingleDay]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function closeDocumentDialog() {
    setViewingRow(null);
    setViewingDocument(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }

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

  async function viewDocument(row: AbsenceRow) {
    setViewingRow(row);
    setViewingDocument(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/absences/${row.id}/document`, { headers });
      const data: DocumentMeta | null = await res.json();
      if (data) {
        setViewingDocument(data);
        if (data.mime_type.startsWith('image/') || data.mime_type === 'application/pdf') {
          const fileRes = await fetch(`${API}/absences/${row.id}/document`, { headers });
          const blob = await fileRes.blob();
          setPreviewUrl(URL.createObjectURL(blob));
        }
      }
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

  async function deleteDocument(absenceId: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/absences/${absenceId}/document`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(t('absences.deleteDocumentFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      closeDocumentDialog();
      setSuccess(t('absences.documentDeleted'));
      await reload();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('absences.title')} />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <Paper
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        sx={{ p: 2 }}
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <DatePicker
            label={t('absences.dateFrom')}
            value={dateStart ? dayjs(dateStart) : null}
            onChange={(d: Dayjs | null) => {
              const next = d && d.isValid() ? d.format('YYYY-MM-DD') : '';
              setDateStart(next);
              if (next && !dateEnd) setDateEnd(next);
            }}
            slotProps={{ textField: { size: 'small', sx: { minWidth: 160 } } }}
          />
          <DatePicker
            label={t('absences.dateTo')}
            value={dateEnd ? dayjs(dateEnd) : null}
            minDate={dateStart ? dayjs(dateStart) : undefined}
            onChange={(d: Dayjs | null) => setDateEnd(d && d.isValid() ? d.format('YYYY-MM-DD') : '')}
            slotProps={{ textField: { size: 'small', sx: { minWidth: 160 } } }}
          />
          <TextField
            select
            size="small"
            label={t('absences.type')}
            value={absenceType}
            onChange={(e) => setAbsenceType(e.target.value)}
            sx={{ minWidth: 170 }}
          >
            {absenceTypes.map((type) => (
              <MenuItem key={type} value={type}>{typeLabel(type)}</MenuItem>
            ))}
          </TextField>
          {isSingleDay && (
            <ToggleButtonGroup value={halfDay ? 'half' : 'full'} exclusive onChange={(_, v) => v && setHalfDay(v === 'half')} size="small">
              <ToggleButton value="full">{t('absences.dayType.full')}</ToggleButton>
              <ToggleButton value="half">{t('absences.dayType.half')}</ToggleButton>
            </ToggleButtonGroup>
          )}
          <TextField label={t('time.comment')} size="small" value={note} onChange={(e) => setNote(e.target.value)} sx={{ minWidth: 220, flex: 1 }} />
          <Button variant="outlined" size="small" component="label" startIcon={<UploadIcon fontSize="small" />} sx={{ height: 40 }}>
            {file ? file.name : t('absences.attachDocument')}
            <input ref={fileInputRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Button>
          <Button type="submit" variant="contained" sx={{ height: 40 }}>{t('absences.request')}</Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('absences.myRequests')}</Typography>
        {loading && <LinearProgress sx={{ mb: 1 }} />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('absences.dateFrom')}</TableCell>
                <TableCell>{t('absences.dateTo')}</TableCell>
                <TableCell>{t('absences.type')}</TableCell>
                <TableCell>{t('timesheet.status')}</TableCell>
                <TableCell>{t('time.comment')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>{formatLocaleDate(r.date_start, locale)}</TableCell>
                  <TableCell>{formatLocaleDate(r.date_end, locale)}</TableCell>
                  <TableCell>
                    <Chip label={typeLabel(r.absence_type)} size="small" variant="outlined" />
                    {r.half_day && <Chip label={t('absences.dayType.half')} size="small" sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell><Chip label={t(`absences.status.${r.status}`)} size="small" color={STATUS_COLOR[r.status]} /></TableCell>
                  <TableCell>{r.status === 'rejected' && r.review_note ? r.review_note : (r.note || '—')}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {r.document_id && (
                      <Tooltip title={t('absences.documents')}>
                        <IconButton size="small" aria-label={t('absences.documents')} onClick={() => void viewDocument(r)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {r.status === 'pending' && (
                      <Tooltip title={t('absences.cancel')}>
                        <IconButton size="small" color="error" aria-label={t('absences.cancel')} onClick={() => setConfirmCancelId(r.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {requests.length === 0 && (
                <TableEmptyRow colSpan={6} icon={<BeachAccessIcon fontSize="inherit" />} title={t('time.noEntries')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!viewingRow} onClose={closeDocumentDialog} fullWidth maxWidth="sm">
        <DialogTitle>{t('absences.documents')}</DialogTitle>
        <DialogContent dividers>
          {viewingDocument ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{viewingDocument.file_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('absences.fileSize', { size: formatFileSize(viewingDocument.size_bytes, locale) })} · {new Date(viewingDocument.created_at).toLocaleString(locale)}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon fontSize="small" />}
                  onClick={() => viewingRow && void downloadDocument(viewingRow.id, viewingDocument)}
                >
                  {t('absences.download')}
                </Button>
              </Box>
              {previewUrl && viewingDocument.mime_type.startsWith('image/') && (
                <Box component="img" src={previewUrl} alt={viewingDocument.file_name} sx={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 1 }} />
              )}
              {previewUrl && viewingDocument.mime_type === 'application/pdf' && (
                <Box component="iframe" src={previewUrl} title={viewingDocument.file_name} sx={{ width: '100%', height: 380, border: 1, borderColor: 'divider', borderRadius: 1 }} />
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">{t('absences.noDocuments')}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          {viewingRow?.status === 'pending' && viewingDocument && (
            <Button color="error" onClick={() => setConfirmDeleteDocId(viewingRow.id)}>
              {t('absences.deleteDocument')}
            </Button>
          )}
          <Button onClick={closeDocumentDialog}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmCancelId}
        title={t('absences.cancelTitle')}
        message={t('absences.cancelConfirm')}
        confirmLabel={t('absences.cancel')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmCancelId(null)}
        onConfirm={() => {
          if (confirmCancelId) return cancel(confirmCancelId);
        }}
      />

      <ConfirmDialog
        open={!!confirmDeleteDocId}
        title={t('absences.deleteDocument')}
        message={t('absences.deleteDocumentConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDeleteDocId(null)}
        onConfirm={() => {
          if (confirmDeleteDocId) return deleteDocument(confirmDeleteDocId);
        }}
      />
    </Box>
  );
}
