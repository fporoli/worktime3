import { useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  status: string;
  role_names: string[];
}

interface FoundUser {
  id: string;
  email: string;
  display_name: string;
  status: string;
}

interface UserLookupProps {
  authHeaders: () => Promise<Record<string, string>>;
}

/** Find a user by email and see which of the caller's own organizations they belong to. */
export default function UserLookup({ authHeaders }: UserLookupProps) {
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<FoundUser | null>(null);
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch(`${API}/users/lookup?email=${encodeURIComponent(normalized)}`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? 'Only organization admins can look up users.' : `Lookup failed (${data.error ?? 'unknown error'}).`);
        setUser(null);
        setMemberships([]);
        return;
      }
      setUser(data.user ?? null);
      setMemberships(Array.isArray(data.memberships) ? data.memberships : []);
    } catch {
      setError('Could not reach the API.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Find a user by email</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Shows which of your organizations that person belongs to, with their status and roles there.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <TextField
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          size="small"
          sx={{ minWidth: 260 }}
        />
        <Button variant="outlined" size="small" onClick={search} disabled={!email.trim() || loading}>Search</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {searched && !error && !user && (
        <Typography variant="body2" color="text.secondary">No user found with that email.</Typography>
      )}

      {user && (
        <>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {user.display_name} ({user.email}) — account {user.status}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Organization</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Roles</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {memberships.map((m) => (
                <TableRow key={m.organization_id}>
                  <TableCell>{m.organization_name}</TableCell>
                  <TableCell>{m.status}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {m.role_names.map((r) => (<Chip key={r} label={r} size="small" />))}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {memberships.length === 0 && (
                <TableRow><TableCell colSpan={3}>Not a member of any organization you administer.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </>
      )}
    </Paper>
  );
}
