import { useEffect, useState } from 'react';
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
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';
import { formatLocaleDate } from './localeFormat';
import { ConfirmDialog } from './components';
import { AddIcon, DeleteIcon, EditIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Assignment {
  id: string;
  valid_from: string;
  department_id: string | null;
  department_name: string | null;
  job_function: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
}

interface Employment {
  startDate: string | null;
  exitDate: string | null;
  currentId: string | null;
  assignments: Assignment[];
  canEdit: boolean;
}

interface Department {
  id: string;
  name: string;
  leader_user_id: string | null;
  is_active: boolean;
}

interface Member {
  user_id: string;
  display_name: string;
}

interface Draft {
  id: string | null;
  validFrom: string;
  departmentId: string;
  jobFunction: string;
  managerUserId: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A person's employment in the organization: start date and the dated assignments (department,
 * function, manager). The assignment in force today decides who their manager is; a change gets a
 * new row from its date on, so earlier months keep their manager. HR and admin edit it.
 */
export default function EmploymentPanel({
  orgId,
  userId,
  authHeaders,
}: {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Employment | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Assignment | null>(null);

  async function reload() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/users/${userId}/employment`, { headers: await authHeaders() });
      const body = await res.json();
      if (body.ok === false) {
        setForbidden(true);
        return;
      }
      setForbidden(false);
      setData({ startDate: body.startDate ?? null, exitDate: body.exitDate ?? null, currentId: body.currentId ?? null, assignments: body.assignments ?? [], canEdit: !!body.canEdit });
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  useEffect(() => {
    setData(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  // Choices for editing: only loaded for people who may edit.
  useEffect(() => {
    if (!data?.canEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [deps, mems] = await Promise.all([
          fetch(`${API}/organizations/${orgId}/departments`, { headers }).then((r) => r.json()),
          fetch(`${API}/organizations/${orgId}/members`, { headers }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setDepartments(Array.isArray(deps?.departments) ? deps.departments : []);
        setMembers(Array.isArray(mems) ? mems : []);
      } catch { /* the dialog then offers no choices */ }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, data?.canEdit]);

  function errorMessage(code: string | undefined): string {
    const key = `employment.error.${code}`;
    const text = t(key);
    return text === key ? t('employment.error.failed', { error: code ?? t('common.unknownError') }) : text;
  }

  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!result?.ok) {
        setError(errorMessage(result?.error));
        return false;
      }
      await reload();
      return true;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openNew() {
    const current = data?.assignments.find((a) => a.id === data.currentId);
    setDraft({
      id: null,
      validFrom: today(),
      departmentId: current?.department_id ?? '',
      jobFunction: current?.job_function ?? '',
      managerUserId: current?.manager_user_id ?? '',
    });
  }

  /** Picking a department offers its leader as the manager (never the person themselves). */
  function pickDepartment(departmentId: string) {
    setDraft((d) => {
      if (!d) return d;
      const leader = departments.find((dep) => dep.id === departmentId)?.leader_user_id ?? '';
      return { ...d, departmentId, managerUserId: leader && leader !== userId ? leader : d.managerUserId };
    });
  }

  async function saveDraft() {
    if (!draft) return;
    const body = {
      validFrom: draft.validFrom,
      departmentId: draft.departmentId || null,
      jobFunction: draft.jobFunction,
      managerUserId: draft.managerUserId || null,
    };
    const ok = draft.id
      ? await send(`/organizations/${orgId}/assignments/${draft.id}`, 'PATCH', body)
      : await send(`/organizations/${orgId}/users/${userId}/assignments`, 'POST', body);
    if (ok) setDraft(null);
  }

  if (forbidden || !data) return null;
  const current = data.assignments.find((a) => a.id === data.currentId) ?? null;
  const date = (iso: string | null) => (iso ? formatLocaleDate(iso, locale) : '—');

  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('employment.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {current
              ? t('employment.current', {
                  department: current.department_name ?? t('employment.noDepartment'),
                  function: current.job_function ?? '—',
                  manager: current.manager_name ?? t('employment.noManager'),
                })
              : t('employment.none')}
          </Typography>
        </Box>
        {data.canEdit && (
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={openNew} disabled={busy}>
            {t('employment.add')}
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box>
          <Typography variant="caption" color="text.secondary">{t('employment.startDate')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{date(data.startDate)}</Typography>
            {data.canEdit && (
              <Tooltip title={t('employment.editStartDate')}>
                <IconButton size="small" aria-label={t('employment.editStartDate')} onClick={() => setStartDraft(data.startDate ?? today())}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
        {data.exitDate && (
          <Box>
            <Typography variant="caption" color="text.secondary">{t('employment.exitDate')}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{date(data.exitDate)}</Typography>
          </Box>
        )}
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('employment.validFrom')}</TableCell>
              <TableCell>{t('employment.department')}</TableCell>
              <TableCell>{t('employment.function')}</TableCell>
              <TableCell>{t('employment.manager')}</TableCell>
              {data.canEdit && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.assignments.length === 0 && (
              <TableRow>
                <TableCell colSpan={data.canEdit ? 5 : 4}>
                  <Typography variant="body2" color="text.secondary">{t('employment.none')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {data.assignments.map((a) => {
              const future = a.valid_from > today();
              return (
                <TableRow key={a.id} selected={a.id === data.currentId}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {date(a.valid_from)}
                    {a.id === data.currentId && <Chip size="small" color="primary" label={t('employment.inForce')} sx={{ ml: 1 }} />}
                    {future && <Chip size="small" variant="outlined" label={t('employment.planned')} sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{a.department_name ?? '—'}</TableCell>
                  <TableCell>{a.job_function ?? '—'}</TableCell>
                  <TableCell>{a.manager_name ?? t('employment.noManager')}</TableCell>
                  {data.canEdit && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', width: 90 }}>
                      <Tooltip title={t('common.edit')}>
                        <IconButton
                          size="small"
                          aria-label={t('common.edit')}
                          disabled={busy}
                          onClick={() =>
                            setDraft({
                              id: a.id,
                              validFrom: a.valid_from,
                              departmentId: a.department_id ?? '',
                              jobFunction: a.job_function ?? '',
                              managerUserId: a.manager_user_id ?? '',
                            })
                          }
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete')}>
                        <IconButton size="small" aria-label={t('common.delete')} disabled={busy} onClick={() => setConfirmDelete(a)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">{t('employment.hint')}</Typography>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>{draft?.id ? t('employment.editTitle') : t('employment.addTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          {draft && (
            <>
              <TextField
                type="date"
                size="small"
                label={t('employment.validFrom')}
                value={draft.validFrom}
                onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField select size="small" label={t('employment.department')} value={draft.departmentId} onChange={(e) => pickDepartment(e.target.value)}>
                <MenuItem value=""><em>{t('employment.noDepartment')}</em></MenuItem>
                {departments
                  .filter((d) => d.is_active || d.id === draft.departmentId)
                  .map((d) => (
                    <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                  ))}
              </TextField>
              <TextField
                size="small"
                label={t('employment.function')}
                value={draft.jobFunction}
                onChange={(e) => setDraft({ ...draft, jobFunction: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
              <TextField
                select
                size="small"
                label={t('employment.manager')}
                value={draft.managerUserId}
                onChange={(e) => setDraft({ ...draft, managerUserId: e.target.value })}
                helperText={t('employment.managerHint')}
              >
                <MenuItem value=""><em>{t('employment.noManager')}</em></MenuItem>
                {members
                  .filter((m) => m.user_id !== userId)
                  .map((m) => (
                    <MenuItem key={m.user_id} value={m.user_id}>{m.display_name}</MenuItem>
                  ))}
              </TextField>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void saveDraft()} disabled={busy || !draft?.validFrom}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={startDraft !== null} onClose={() => setStartDraft(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('employment.startDate')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            type="date"
            size="small"
            fullWidth
            value={startDraft ?? ''}
            onChange={(e) => setStartDraft(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStartDraft(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy || !startDraft}
            onClick={async () => {
              if (await send(`/organizations/${orgId}/users/${userId}/start-date`, 'PUT', { startDate: startDraft })) setStartDraft(null);
            }}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('employment.deleteTitle')}
        message={confirmDelete ? t('employment.deleteMessage', { date: date(confirmDelete.valid_from) }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const row = confirmDelete;
          setConfirmDelete(null);
          if (row) await send(`/organizations/${orgId}/assignments/${row.id}`, 'DELETE');
        }}
      />
    </Paper>
  );
}
