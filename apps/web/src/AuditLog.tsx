import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useI18n } from './i18n';
import { PageHeader, TableEmptyRow } from './components';
import { HistoryIcon, RefreshIcon, SearchIcon } from './icons';

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
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<AuditLogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function reloadEntries() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/audit-logs?orgId=${orgId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setEntries(data);
    } catch {
      setError(t('audit.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) =>
      [entry.actor_display_name, entry.actor_email, entry.action, entry.target_type, entry.target_id, formatMetadata(entry.metadata)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [entries, search]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        end={
          <Button size="small" variant="outlined" startIcon={<RefreshIcon fontSize="small" />} onClick={() => void reloadEntries()}>
            {t('audit.refresh')}
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ mb: 2 }}>
          <TextField
            size="small"
            placeholder={t('audit.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 320 } }}
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

        {loading && <LinearProgress sx={{ mb: 1.5 }} />}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('audit.col.when')}</TableCell>
                <TableCell>{t('audit.col.actor')}</TableCell>
                <TableCell>{t('audit.col.action')}</TableCell>
                <TableCell>{t('audit.col.target')}</TableCell>
                <TableCell>{t('audit.col.details')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell>{new Date(entry.created_at).toLocaleString(locale)}</TableCell>
                  <TableCell>{entry.actor_display_name ?? entry.actor_email ?? t('common.unknown')}</TableCell>
                  <TableCell>{entry.action}</TableCell>
                  <TableCell>{entry.target_type}{entry.target_id ? ` (${entry.target_id.slice(0, 8)}…)` : ''}</TableCell>
                  <TableCell>{formatMetadata(entry.metadata)}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableEmptyRow colSpan={5} icon={<HistoryIcon fontSize="inherit" />} title={t('audit.empty')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
