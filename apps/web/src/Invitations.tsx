import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { ContentCopyIcon, MailIcon } from './icons';

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
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);

  async function reloadRoles() {
    try {
      const res = await fetch(`${API}/roles`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) {
        const assignable = data.filter((r) => r.name !== 'owner');
        setRoles(assignable);
        if (!roleId && assignable.length > 0) {
          const defaultRole = assignable.find((r) => r.name === 'member') ?? assignable[0];
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
    void reloadRoles();
    void reloadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function handleSendInvite() {
    const trimmed = email.trim();
    if (!trimmed || !roleId) return;
    setError(null);
    setSuccess(null);
    setLastInviteLink(null);
    setCopied(false);
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
      const res = await fetch(`${API}/organizations/invitations/${invitationId}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (data.ok === false) {
        setError(data.error === 'forbidden' ? t('invitations.forbidden') : t('invitations.revokeFailed'));
        return;
      }
      setSuccess(t('invitations.revoked'));
      await reloadInvitations();
    } catch {
      setError(t('invitations.revokeFailed'));
    }
  }

  async function copyLink() {
    if (!lastInviteLink) return;
    try {
      await navigator.clipboard.writeText(lastInviteLink);
      setCopied(true);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('invitations.title')} subtitle={t('invitations.subtitle')} />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {lastInviteLink && (
        <Alert
          severity="info"
          onClose={() => setLastInviteLink(null)}
          action={
            <Button size="small" color="inherit" startIcon={<ContentCopyIcon fontSize="small" />} onClick={() => void copyLink()}>
              {copied ? t('invitations.copied') : t('invitations.copyLink')}
            </Button>
          }
        >
          {t('invitations.shareLink')} <code>{lastInviteLink}</code>
        </Alert>
      )}

      <Paper
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSendInvite();
        }}
        sx={{ p: 2 }}
      >
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
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
          <Button type="submit" variant="contained" disabled={!email.trim() || !roleId}>
            {t('invitations.send')}
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('invitations.sentList', { count: invitations.length })}</Typography>
        {loading && <LinearProgress sx={{ mb: 1 }} />}
        <TableContainer>
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
                <TableEmptyRow colSpan={6} icon={<MailIcon fontSize="inherit" />} title={t('invitations.empty')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <ConfirmDialog
        open={!!revokeTargetId}
        title={t('invitations.revokeTitle')}
        message={t('invitations.revokeConfirm')}
        confirmLabel={t('invitations.revoke')}
        cancelLabel={t('common.cancel')}
        onClose={() => setRevokeTargetId(null)}
        onConfirm={() => {
          if (revokeTargetId) return handleRevoke(revokeTargetId);
        }}
      />
    </Box>
  );
}
