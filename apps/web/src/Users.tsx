import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, MenuItem, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';

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
  /** A membership can hold more than one role. */
  role_ids: string[];
  role_names: string[];
}

interface UsersProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  active: 'success',
  invited: 'warning',
  suspended: 'error',
};

export default function Users({ orgId, authHeaders }: UsersProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [addRoleFor, setAddRoleFor] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError(`Could not add the role (${data.error ?? 'unknown error'}).`);
        return;
      }
      setAddRoleFor((p) => ({ ...p, [membershipId]: '' }));
      await reloadMembers();
    } catch {
      setError('Could not reach the API.');
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
        setError(data.error === 'last-role' ? 'A member must keep at least one role.' : `Could not remove the role (${data.error ?? 'unknown error'}).`);
        return;
      }
      await reloadMembers();
    } catch {
      setError('Could not reach the API.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Users</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Everyone in this organization, with their status and roles. Add or remove roles inline — to invite
        someone new, use the Invitations page.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Email</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Roles</TableCell>
            <TableCell>Add role</TableCell>
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
                      <MenuItem value=""><em>Select…</em></MenuItem>
                      {availableRoles.map((r) => (<MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>))}
                    </TextField>
                    <Button size="small" onClick={() => grantRole(m.id)} disabled={!addRoleFor[m.id]}>Add</Button>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
          {members.length === 0 && !loading && (
            <TableRow><TableCell colSpan={5}>No members yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
