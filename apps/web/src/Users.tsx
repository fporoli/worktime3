import { useEffect, useMemo, useState } from 'react';
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
  InputAdornment,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { BasicDataPanel } from './BasicDataPanel';
import WorkSchedulePanel from './WorkSchedulePanel';
import { BalancesPanel } from './BalancesPanel';
import { useI18n } from './i18n';
import { assignableRoles, roleLabel, type OrgRole } from './roleLabel';
import { PageHeader, TableEmptyRow } from './components';
import { AccountBalanceWalletIcon, CloseIcon, PeopleIcon, PersonIcon, ScheduleIcon, SearchIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type RoleOption = OrgRole;

interface Member {
  id: string;
  user_id: string;
  status: string;
  email: string;
  display_name: string;
  manager_user_id: string | null;
  manager_display_name: string | null;
  role_ids: string[];
  role_names: string[];
}

interface UsersProps {
  orgId: string;
  isAdmin: boolean;
  isHr: boolean;
  /** May open other members' personal details (section permissions beyond `own`). */
  canAccessBasicData: boolean;
  /** The caller may see other people's work schedules (section.workTime.schedule beyond own). */
  canSeeWorkSchedules?: boolean;
  canManage: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  active: 'success',
  invited: 'warning',
  suspended: 'error',
};

export default function Users({ orgId, isAdmin, canAccessBasicData, canSeeWorkSchedules = false, canManage, authHeaders }: UsersProps) {
  const { t, locale } = useI18n();
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [addRoleFor, setAddRoleFor] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [basicDataFor, setBasicDataFor] = useState<Member | null>(null);
  const [balancesFor, setBalancesFor] = useState<Member | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Member | null>(null);

  const canViewBalances = isAdmin || canManage;

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
    if (!isAdmin) {
      setRoles([]);
      return;
    }
    try {
      const res = await fetch(`${API}/organizations/${orgId}/roles`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data?.roles)) setRoles(assignableRoles(data.roles as OrgRole[]));
    } catch { /* offline demo */ }
  }

  useEffect(() => {
    void reloadMembers();
    void reloadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, isAdmin]);

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

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role_names.some((r) => r.toLowerCase().includes(q)),
    );
  }, [members, search]);

  function statusLabel(status: string): string {
    const key = `users.status.${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          <TextField
            size="small"
            placeholder={t('users.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 300 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.name')}</TableCell>
                <TableCell>{t('common.email')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell>{t('users.col.manager')}</TableCell>
                <TableCell>{t('users.col.roles')}</TableCell>
                {isAdmin && <TableCell>{t('users.col.addRole')}</TableCell>}
                {(canAccessBasicData || canViewBalances || canSeeWorkSchedules) && <TableCell align="right">{t('common.actions')}</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredMembers.map((m) => {
                const availableRoles = roles.filter((r) => !m.role_ids.includes(r.id));
                return (
                  <TableRow key={m.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{m.display_name}</TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>
                      <Chip label={statusLabel(m.status)} size="small" color={STATUS_COLOR[m.status] ?? 'default'} />
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <TextField
                          select
                          size="small"
                          value={m.manager_user_id ?? ''}
                          onChange={(e) => void setManager(m.id, e.target.value)}
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
                            onDelete={isAdmin && m.role_ids.length > 1 ? () => void revokeRole(m.id, rid) : undefined}
                          />
                        ))}
                      </Box>
                    </TableCell>
                    {isAdmin && (
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
                            {availableRoles.map((r) => (<MenuItem key={r.id} value={r.id}>{roleLabel(r, locale)}</MenuItem>))}
                          </TextField>
                          <Button size="small" onClick={() => void grantRole(m.id)} disabled={!addRoleFor[m.id]}>{t('common.add')}</Button>
                        </Box>
                      </TableCell>
                    )}
                    {(canAccessBasicData || canViewBalances || canSeeWorkSchedules) && (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {canSeeWorkSchedules && (
                          <Tooltip title={t('workSchedule.title')}>
                            <IconButton size="small" aria-label={t('workSchedule.title')} onClick={() => setScheduleFor(m)}>
                              <ScheduleIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {canViewBalances && (
                          <Tooltip title={t('users.balances')}>
                            <IconButton size="small" aria-label={t('users.balances')} onClick={() => setBalancesFor(m)}>
                              <AccountBalanceWalletIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {canAccessBasicData && (
                          <Button size="small" startIcon={<PersonIcon fontSize="small" />} onClick={() => setBasicDataFor(m)}>
                            {t('users.basicData')}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {filteredMembers.length === 0 && !loading && (
                <TableEmptyRow colSpan={isAdmin ? 7 : 6} icon={<PeopleIcon fontSize="inherit" />} title={t('users.empty')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!basicDataFor} onClose={() => setBasicDataFor(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">{basicDataFor?.display_name}</Typography>
          <IconButton size="small" aria-label={t('common.close')} onClick={() => setBasicDataFor(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ pb: 3 }}>
          {basicDataFor && (
            <BasicDataPanel orgId={orgId} userId={basicDataFor.user_id} isSelf={false} embedded authHeaders={authHeaders} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!scheduleFor} onClose={() => setScheduleFor(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">{scheduleFor?.display_name}</Typography>
          <IconButton size="small" aria-label={t('common.close')} onClick={() => setScheduleFor(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {scheduleFor && <WorkSchedulePanel orgId={orgId} userId={scheduleFor.user_id} authHeaders={authHeaders} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!balancesFor} onClose={() => setBalancesFor(null)} fullWidth maxWidth="lg">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">
            {balancesFor ? t('balances.forUser', { name: balancesFor.display_name }) : t('balances.title')}
          </Typography>
          <IconButton size="small" aria-label={t('common.close')} onClick={() => setBalancesFor(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {balancesFor && (
            <BalancesPanel orgId={orgId} userId={balancesFor.user_id} authHeaders={authHeaders} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBalancesFor(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
