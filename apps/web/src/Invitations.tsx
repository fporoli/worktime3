import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
import type { Session } from './Login';

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
  created_at: string;
  role_name: string;
  invited_by: string;
}

interface InvitationsProps {
  session: Session;
  authHeaders: () => Promise<Record<string, string>>;
}

const STATUS_COLOR: Record<InvitationItem['status'], 'default' | 'success' | 'error' | 'warning'> = {
  pending: 'warning',
  accepted: 'success',
  revoked: 'default',
  expired: 'error',
};

export default function Invitations({ session, authHeaders }: InvitationsProps) {
  const orgId = session.memberships[0]?.organizationId ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  async function reloadRoles() {
    try {
      const res = await fetch(`${API}/roles`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) {
        setRoles(data);
        setRoleId((prev) => prev || data.find((r: RoleOption) => r.name === 'member')?.id || data[0]?.id || '');
      }
    } catch { /* offline fallback */ }
  }

  async function reloadInvitations() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/invitations`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setInvitations(data);
    } catch { /* offline fallback */ }
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
          data.error === 'invalid-email'
            ? 'Please enter a valid email address.'
            : data.error === 'forbidden'
              ? 'You do not have permission to invite members.'
              : `Failed to send invitation (${data.error ?? 'unknown error'}).`,
        );
        return;
      }
      setEmail('');
      setSuccess(`Invitation sent to ${trimmed}.`);
      if (data.token) {
        setLastInviteLink(`${window.location.origin}${window.location.pathname}?invite=${data.token}`);
      }
      await reloadInvitations();
    } catch {
      setError('Failed to send invitation. Is the API running?');
    }
  }

  async function handleRevoke(invitationId: string) {
    setError(null);
    try {
      await fetch(`${API}/organizations/invitations/${invitationId}`, { method: 'DELETE', headers: await authHeaders() });
      setSuccess('Invitation revoked.');
      await reloadInvitations();
    } catch {
      setError('Failed to revoke invitation.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Invite people</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Send an email invitation to join this organization with a chosen role.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {lastInviteLink && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setLastInviteLink(null)}>
          No mail server configured? Share this link directly: <code>{lastInviteLink}</code>
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
        <TextField
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          size="small"
          sx={{ minWidth: 240 }}
          placeholder="person@example.com"
        />
        <TextField
          select
          label="Role"
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
          Send Invite
        </Button>
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>Sent invitations ({invitations.length})</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Email</TableCell>
            <TableCell>Role</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Invited by</TableCell>
            <TableCell>Expires</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {invitations.map((inv) => (
            <TableRow key={inv.id} hover>
              <TableCell>{inv.email}</TableCell>
              <TableCell>{inv.role_name}</TableCell>
              <TableCell>
                <Chip label={inv.status} size="small" color={STATUS_COLOR[inv.status]} />
              </TableCell>
              <TableCell>{inv.invited_by}</TableCell>
              <TableCell>{new Date(inv.expires_at).toLocaleDateString()}</TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  color="error"
                  disabled={inv.status !== 'pending'}
                  onClick={() => handleRevoke(inv.id)}
                >
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {invitations.length === 0 && (
            <TableRow><TableCell colSpan={6}>No invitations sent yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
