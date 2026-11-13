import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Switch,
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
import { useT } from './i18n';
import { ConfirmDialog, TableEmptyRow } from './components';
import { AddIcon, BusinessIcon, CheckIcon, CloseIcon, DeleteIcon, EditIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Department {
  id: string;
  name: string;
  leader_user_id: string | null;
  leader_name: string | null;
  is_active: boolean;
  sort_order: number;
  members: number;
}

interface Member {
  user_id: string;
  display_name: string;
}

/**
 * Organization settings → Departments: the organization's own list (Administration, HR, Sales, …),
 * each with a default leader. The leader is offered as manager when someone is assigned to the
 * department; a person's manager is set on their employment, not here.
 */
export default function DepartmentSettings({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const t = useT();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLeader, setNewLeader] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; leader: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Department | null>(null);

  async function reload() {
    try {
      const headers = await authHeaders();
      const [deps, mems] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/departments`, { headers }).then((r) => r.json()),
        fetch(`${API}/organizations/${orgId}/members`, { headers }).then((r) => r.json()),
      ]);
      setDepartments(Array.isArray(deps?.departments) ? deps.departments : []);
      setCanEdit(!!deps?.canEdit);
      setMembers(Array.isArray(mems) ? [...mems].sort((a: Member, b: Member) => a.display_name.localeCompare(b.display_name)) : []);
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function errorMessage(code: string | undefined): string {
    const key = `departments.error.${code}`;
    const text = t(key);
    return text === key ? t('departments.error.failed', { error: code ?? t('common.unknownError') }) : text;
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

  async function add() {
    const sortOrder = departments.reduce((max, d) => Math.max(max, d.sort_order), 0) + 1;
    if (await send(`/organizations/${orgId}/departments`, 'POST', { name: newName, leaderUserId: newLeader || null, sortOrder })) {
      setNewName('');
      setNewLeader('');
    }
  }

  async function saveEdit() {
    if (!editing) return;
    if (await send(`/organizations/${orgId}/departments/${editing.id}`, 'PATCH', { name: editing.name, leaderUserId: editing.leader || null })) setEditing(null);
  }

  const leaderSelect = (value: string, onChange: (v: string) => void, label?: string) => (
    <TextField select size="small" label={label} value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 200 }}>
      <MenuItem value=""><em>{t('departments.noLeader')}</em></MenuItem>
      {members.map((m) => (
        <MenuItem key={m.user_id} value={m.user_id}>{m.display_name}</MenuItem>
      ))}
    </TextField>
  );

  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 1.5 }}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('departments.title')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('departments.subtitle')}</Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('departments.name')}</TableCell>
              <TableCell>{t('departments.leader')}</TableCell>
              <TableCell align="right">{t('departments.members')}</TableCell>
              <TableCell>{t('departments.active')}</TableCell>
              {canEdit && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {departments.length === 0 && (
              <TableEmptyRow colSpan={canEdit ? 5 : 4} icon={<BusinessIcon fontSize="inherit" />} title={t('departments.empty')} />
            )}
            {departments.map((d) => {
              const isEditing = editing?.id === d.id;
              return (
                <TableRow key={d.id} sx={{ opacity: d.is_active ? 1 : 0.6 }}>
                  <TableCell sx={{ fontWeight: 500 }}>
                    {isEditing ? (
                      <TextField size="small" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} slotProps={{ htmlInput: { maxLength: 120 } }} />
                    ) : (
                      d.name
                    )}
                  </TableCell>
                  <TableCell>{isEditing ? leaderSelect(editing.leader, (v) => setEditing({ ...editing, leader: v })) : d.leader_name ?? '—'}</TableCell>
                  <TableCell align="right">{d.members}</TableCell>
                  <TableCell>
                    {canEdit ? (
                      <Switch
                        size="small"
                        checked={d.is_active}
                        disabled={busy}
                        onChange={(e) => void send(`/organizations/${orgId}/departments/${d.id}`, 'PATCH', { isActive: e.target.checked })}
                        slotProps={{ input: { 'aria-label': t('departments.active') } }}
                      />
                    ) : (
                      <Chip size="small" label={d.is_active ? t('departments.activeYes') : t('departments.activeNo')} />
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', width: 100 }}>
                      {isEditing ? (
                        <>
                          <Tooltip title={t('common.save')}>
                            <IconButton size="small" aria-label={t('common.save')} disabled={busy || !editing.name.trim()} onClick={() => void saveEdit()}>
                              <CheckIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('common.cancel')}>
                            <IconButton size="small" aria-label={t('common.cancel')} onClick={() => setEditing(null)}>
                              <CloseIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      ) : (
                        <>
                          <Tooltip title={t('common.edit')}>
                            <IconButton size="small" aria-label={t('common.edit')} disabled={busy} onClick={() => setEditing({ id: d.id, name: d.name, leader: d.leader_user_id ?? '' })}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('common.delete')}>
                            <IconButton size="small" aria-label={t('common.delete')} disabled={busy} onClick={() => setConfirmDelete(d)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {canEdit && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField size="small" label={t('departments.name')} value={newName} onChange={(e) => setNewName(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} />
          {leaderSelect(newLeader, setNewLeader, t('departments.leader'))}
          <Button startIcon={<AddIcon fontSize="small" />} disabled={busy || !newName.trim()} onClick={() => void add()}>
            {t('departments.add')}
          </Button>
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">{t('departments.hint')}</Typography>

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('departments.deleteTitle')}
        message={confirmDelete ? t('departments.deleteMessage', { name: confirmDelete.name }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const d = confirmDelete;
          setConfirmDelete(null);
          if (d) await send(`/organizations/${orgId}/departments/${d.id}`, 'DELETE');
        }}
      />
    </Paper>
  );
}
