import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, LinearProgress, MenuItem, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { BasicDataPanel } from './Home';
import { useT } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface RoleOption {
  id: string;
  name: string;
  description?: string | null;
}

interface Member {
  id: string; // membership id
  user_id: string;
  status: string;
  email: string;
  display_name: string;
  /** Who this member's timesheet approvals route to; null means they don't need approval (e.g. an owner). */
  manager_user_id: string | null;
  manager_display_name: string | null;
  /** A membership can hold more than one role. */
  role_ids: string[];
  role_names: string[];
}

interface UsersProps {
  orgId: string;
  role: 'admin' | 'manager' | 'user';
  authHeaders: () => Promise<Record<string, string>>;
}

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  active: 'success',
  invited: 'warning',
  suspended: 'error',
};

export default function Users({ orgId, role, authHeaders }: UsersProps) {
  const t = useT();
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [addRoleFor, setAddRoleFor] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basicDataFor, setBasicDataFor] = useState<Member | null>(null);

  async function reloadMembers() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setMembers(data);
    } catch { /* offline demo */ } finally {
      setLoading(false);
    }
  }

  async function reloadRoles() {
    try {
      const res = await fetch(`${API}/roles`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setRoles(data);
    } catch { /* offline demo */ }
  }

  useEffect(() => {
    reloadMembers();
    reloadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function grantRole(membershipId: string) {
    const roleId = addRoleFor[membershipId];
    if (!roleId) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members/${membershipId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ roleId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(t('users.addRoleFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setAddRoleFor((p) => ({ ...p, [membershipId]: '' }));
      await reloadMembers();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  async function setManager(membershipId: string, managerUserId: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members/${membershipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ managerUserId: managerUserId || null }),
      });
      const data = await res.json();
      if (!data.ok) {
        const message =
          data.error === 'cannot-be-own-manager'
            ? t('users.cannotBeOwnManager')
            : t('users.setManagerFailed', { error: data.error ?? t('common.unknownError') });
        setError(message);
        return;
      }
      await reloadMembers();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  async function revokeRole(membershipId: string, roleId: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members/${membershipId}/roles/${roleId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'last-role' ? t('users.lastRole') : t('users.removeRoleFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      await reloadMembers();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('users.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('users.subtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('common.name')}</TableCell>
            <TableCell>{t('common.email')}</TableCell>
            <TableCell>{t('common.status')}</TableCell>
            <TableCell>{t('users.col.manager')}</TableCell>
            <TableCell>{t('users.col.roles')}</TableCell>
            <TableCell>{t('users.col.addRole')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {members.map((m) => {
            const availableRoles = roles.filter((r) => !m.role_ids.includes(r.id));
            return (
              <TableRow key={m.id} hover>
                <TableCell>{m.display_name}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>
                  <Chip label={m.status} size="small" color={STATUS_COLOR[m.status] ?? 'default'} />
                </TableCell>
                <TableCell>
                  {role === 'admin' ? (
                    <TextField
                      select
                      size="small"
                      value={m.manager_user_id ?? ''}
                      onChange={(e) => setManager(m.id, e.target.value)}
                      sx={{ minWidth: 160 }}
                    >
                      <MenuItem value=""><em>{t('users.noManager')}</em></MenuItem>
                      {members.filter((o) => o.id !== m.id).map((o) => (
                        <MenuItem key={o.user_id} value={o.user_id}>{o.display_name}</MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    m.manager_display_name ?? '—'
                  )}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {m.role_ids.map((rid, i) => (
                      <Chip
                        key={rid}
                        label={m.role_names[i] ?? rid}
                        size="small"
                        onDelete={m.role_ids.length > 1 ? () => revokeRole(m.id, rid) : undefined}
                      />
                    ))}
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                      select
                      size="small"
                      value={addRoleFor[m.id] ?? ''}
                      onChange={(e) => setAddRoleFor((p) => ({ ...p, [m.id]: e.target.value }))}
                      sx={{ minWidth: 140 }}
                      disabled={availableRoles.length === 0}
                    >
                      <MenuItem value=""><em>{t('common.select')}</em></MenuItem>
                      {availableRoles.map((r) => (<MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>))}
                    </TextField>
                    <Button size="small" onClick={() => grantRole(m.id)} disabled={!addRoleFor[m.id]}>{t('common.add')}</Button>
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => setBasicDataFor(m)}>{t('users.basicData')}</Button>
                </TableCell>
              </TableRow>
            );
          })}
          {members.length === 0 && !loading && (
            <TableRow><TableCell colSpan={7}>{t('users.empty')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={!!basicDataFor} onClose={() => setBasicDataFor(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {basicDataFor?.display_name}
          <IconButton size="small" aria-label={t('common.close')} onClick={() => setBasicDataFor(null)}>✕</IconButton>
        </DialogTitle>
        <DialogContent sx={{ pb: 3 }}>
          {basicDataFor && (
            <BasicDataPanel orgId={orgId} userId={basicDataFor.user_id} isSelf={false} authHeaders={authHeaders} />
          )}
        </DialogContent>
      </Dialog>
    </Paper>
  );
}
