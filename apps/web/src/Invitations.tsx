import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface RoleOption {
  id: string;
  name: string;
  description?: string | null;
}

interface InvitationItem {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  role_name: string;
  invited_by: string;
}

interface InvitationsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

const STATUS_COLOR: Record<InvitationItem['status'], 'default' | 'success' | 'error' | 'warning'> = {
  pending: 'warning',
  accepted: 'success',
  revoked: 'default',
  expired: 'error',
};

export default function Invitations({ orgId, authHeaders }: InvitationsProps) {
  const { t, locale } = useI18n();
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);

  async function reloadRoles() {
    try {
      const res = await fetch(`${API}/roles`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) {
        setRoles(data.filter((r) => r.name !== 'owner'));
        if (!roleId && data.length > 0) {
          const defaultRole = data.find((r) => r.name === 'member') ?? data[0];
          setRoleId(defaultRole.id);
        }
      }
    } catch { /* offline fallback */ }
  }

  async function reloadInvitations() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/invitations`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setInvitations(data);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadRoles();
    reloadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function handleSendInvite() {
    const trimmed = email.trim();
    if (!trimmed || !roleId) return;
    setError(null);
    setSuccess(null);
    setLastInviteLink(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ email: trimmed, roleId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(
          data.error === 'forbidden'
            ? t('invitations.forbidden')
            : t('invitations.sendFailed', { error: data.error ?? t('common.unknownError') }),
        );
        return;
      }
      setEmail('');
      setSuccess(t('invitations.sent', { email: trimmed }));
      if (data.token) {
        setLastInviteLink(`${window.location.origin}${window.location.pathname}?invite=${data.token}`);
      }
      await reloadInvitations();
    } catch {
      setError(t('invitations.unreachable'));
    }
  }

  async function handleRevoke(invitationId: string) {
    setError(null);
    try {
      await fetch(`${API}/organizations/invitations/${invitationId}`, { method: 'DELETE', headers: await authHeaders() });
      setSuccess(t('invitations.revoked'));
      await reloadInvitations();
    } catch {
      setError(t('invitations.revokeFailed'));
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('invitations.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('invitations.subtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {lastInviteLink && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setLastInviteLink(null)}>
          {t('invitations.shareLink')} <code>{lastInviteLink}</code>
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
        <TextField
          label={t('common.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          size="small"
          sx={{ minWidth: 240 }}
          placeholder={t('invitations.emailPlaceholder')}
        />
        <TextField
          select
          label={t('common.role')}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          size="small"
          sx={{ minWidth: 160 }}
        >
          {roles.map((r) => (
            <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
          ))}
        </TextField>
        <Button variant="contained" onClick={handleSendInvite} disabled={!email.trim() || !roleId}>
          {t('invitations.send')}
        </Button>
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('invitations.sentList', { count: invitations.length })}</Typography>
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('common.email')}</TableCell>
            <TableCell>{t('common.role')}</TableCell>
            <TableCell>{t('common.status')}</TableCell>
            <TableCell>{t('invitations.invitedBy')}</TableCell>
            <TableCell>{t('invitations.expires')}</TableCell>
            <TableCell align="right">{t('common.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {invitations.map((inv) => (
            <TableRow key={inv.id} hover>
              <TableCell>{inv.email}</TableCell>
              <TableCell>{inv.role_name}</TableCell>
              <TableCell>
                <Chip label={t(`invitations.status.${inv.status}`)} size="small" color={STATUS_COLOR[inv.status]} />
              </TableCell>
              <TableCell>{inv.invited_by}</TableCell>
              <TableCell>{new Date(inv.expires_at).toLocaleDateString(locale)}</TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  color="error"
                  disabled={inv.status !== 'pending'}
                  onClick={() => setRevokeTargetId(inv.id)}
                >
                  {t('invitations.revoke')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {invitations.length === 0 && (
            <TableRow><TableCell colSpan={6}>{t('invitations.empty')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={!!revokeTargetId} onClose={() => setRevokeTargetId(null)}>
        <DialogTitle>{t('invitations.revokeTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('invitations.revokeConfirm')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTargetId(null)}>{t('common.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              const id = revokeTargetId;
              setRevokeTargetId(null);
              if (id) await handleRevoke(id);
            }}
          >
            {t('invitations.revoke')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
