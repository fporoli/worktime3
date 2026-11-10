import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useI18n } from './i18n';
import { formatSignedMinutes } from './localeFormat';
import { TableEmptyRow } from './components';
import { AccountBalanceWalletIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export interface BalanceSummary {
  overtimeMinutes: number;
  vacationMinutes: number;
}

export interface BalanceLedgerEntry {
  id: string;
  balance_type: 'overtime' | 'vacation';
  source_table: string | null;
  delta_minutes: number | string;
  note: string | null;
  created_at: string;
}

function sourceKey(sourceTable: string | null): string {
  if (sourceTable === 'timesheet_periods') return 'balances.source.work_time';
  if (sourceTable === 'absences') return 'balances.source.absence';
  return 'balances.source.manual';
}

export function BalanceLedger({
  orgId,
  userId,
  isAdmin,
  authHeaders,
  refreshKey = 0,
  onAdjusted,
}: {
  orgId: string;
  userId: string;
  isAdmin: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  refreshKey?: number;
  onAdjusted?: () => void;
}) {
  const { t, locale } = useI18n();
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [entries, setEntries] = useState<BalanceLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [balanceType, setBalanceType] = useState<'vacation' | 'overtime'>('vacation');
  const [deltaMinutes, setDeltaMinutes] = useState('480');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const [bRes, eRes] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/balances?userId=${encodeURIComponent(userId)}`, { headers }),
        fetch(`${API}/organizations/${orgId}/balances/entries?userId=${encodeURIComponent(userId)}`, { headers }),
      ]);
      const bData = await bRes.json();
      const eData = await eRes.json();
      if (bData && typeof bData.overtimeMinutes === 'number') setBalance(bData);
      if (Array.isArray(eData)) setEntries(eData);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId, refreshKey]);

  async function submitAdjustment() {
    const delta = Number(deltaMinutes);
    if (!Number.isFinite(delta) || delta === 0) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/balances/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ userId, balanceType, deltaMinutes: delta, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(t('balances.adjustFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setAdjustOpen(false);
      setNote('');
      setSuccess(t('balances.adjusted'));
      await reload();
      onAdjusted?.();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {balance && (
            <>
              <Chip
                label={t('workTime.overtimeBalance', { value: formatSignedMinutes(balance.overtimeMinutes) })}
                color={balance.overtimeMinutes < 0 ? 'error' : 'success'}
                variant="outlined"
              />
              <Chip
                label={t('workTime.vacationBalance', { value: formatSignedMinutes(balance.vacationMinutes) })}
                variant="outlined"
              />
            </>
          )}
        </Box>
        {isAdmin && (
          <Button size="small" variant="outlined" onClick={() => setAdjustOpen(true)}>
            {t('balances.adjust')}
          </Button>
        )}
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('audit.col.when')}</TableCell>
              <TableCell>{t('balances.type')}</TableCell>
              <TableCell align="right">{t('balances.delta')}</TableCell>
              <TableCell>{t('balances.source')}</TableCell>
              <TableCell>{t('timesheet.note')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((e) => {
              const delta = Number(e.delta_minutes);
              return (
                <TableRow key={e.id} hover>
                  <TableCell>{new Date(e.created_at).toLocaleString(locale)}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={t(`balances.type.${e.balance_type}`)} />
                  </TableCell>
                  <TableCell align="right" sx={{ color: delta < 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>
                    {formatSignedMinutes(delta)}
                  </TableCell>
                  <TableCell>{t(sourceKey(e.source_table))}</TableCell>
                  <TableCell>{e.note ?? '—'}</TableCell>
                </TableRow>
              );
            })}
            {entries.length === 0 && !loading && (
              <TableEmptyRow colSpan={5} icon={<AccountBalanceWalletIcon fontSize="inherit" />} title={t('balances.empty')} />
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={adjustOpen} onClose={() => !saving && setAdjustOpen(false)} fullWidth maxWidth="xs">
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitAdjustment();
          }}
        >
          <DialogTitle>{t('balances.adjust')}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField
              select
              label={t('balances.type')}
              value={balanceType}
              onChange={(e) => setBalanceType(e.target.value as 'vacation' | 'overtime')}
              size="small"
              sx={{ mt: 1 }}
            >
              <MenuItem value="vacation">{t('balances.type.vacation')}</MenuItem>
              <MenuItem value="overtime">{t('balances.type.overtime')}</MenuItem>
            </TextField>
            <TextField
              label={t('balances.deltaMinutes')}
              type="number"
              value={deltaMinutes}
              onChange={(e) => setDeltaMinutes(e.target.value)}
              size="small"
              slotProps={{ htmlInput: { step: 30 } }}
            />
            <TextField
              label={t('balances.note')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              size="small"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAdjustOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={saving || !Number.isFinite(Number(deltaMinutes)) || Number(deltaMinutes) === 0}>
              {t('common.save')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
