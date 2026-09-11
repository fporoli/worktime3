import { useEffect, useState } from 'react';
import {
  Alert,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface AuditLogItem {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_display_name: string | null;
  actor_email: string | null;
}

interface AuditLogProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

function formatMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) return '—';
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}

export default function AuditLog({ orgId, authHeaders }: AuditLogProps) {
  const [entries, setEntries] = useState<AuditLogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reloadEntries() {
    setError(null);
    try {
      const res = await fetch(`${API}/audit-logs?orgId=${orgId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setEntries(data);
    } catch {
      setError('Failed to load audit log. Is the API running?');
    }
  }

  useEffect(() => {
    setLoading(true);
    reloadEntries().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Audit log</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        A record of administrative and approval actions taken in this organization.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>When</TableCell>
            <TableCell>Actor</TableCell>
            <TableCell>Action</TableCell>
            <TableCell>Target</TableCell>
            <TableCell>Details</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id} hover>
              <TableCell>{new Date(entry.created_at).toLocaleString()}</TableCell>
              <TableCell>{entry.actor_display_name ?? entry.actor_email ?? 'Unknown'}</TableCell>
              <TableCell>{entry.action}</TableCell>
              <TableCell>{entry.target_type}{entry.target_id ? ` (${entry.target_id.slice(0, 8)}…)` : ''}</TableCell>
              <TableCell>{formatMetadata(entry.metadata)}</TableCell>
            </TableRow>
          ))}
          {entries.length === 0 && !loading && (
            <TableRow><TableCell colSpan={5}>No audit entries yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
