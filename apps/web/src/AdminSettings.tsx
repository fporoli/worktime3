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
  IconButton,
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
import UserLookup from './UserLookup';
import { LOCALES, useT, type Locale } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface StaticDataRow {
  id: string;
  entity: string;
  entity_uuid: string | null;
  enum_name: string;
  values: Record<string, string>;
  /** Per-language label overrides: locale -> (values key -> translated label). */
  translation: Record<string, Record<string, string>>;
}

/** A single editable key/label pair, while a static-data enum is open for editing. */
interface KV {
  key: string;
  label: string;
}

function valuesToKvList(values: Record<string, string>): KV[] {
  return Object.entries(values).map(([key, label]) => ({ key, label }));
}

function kvListToValues(list: KV[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, label } of list) {
    if (key.trim()) out[key.trim()] = label;
  }
  return out;
}

interface AdminSettingsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function AdminSettings({ orgId, authHeaders }: AdminSettingsProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // --- ENUMS STATE ---
  const [enums, setEnums] = useState<StaticDataRow[]>([]);
  const [enumDialogOpen, setEnumDialogOpen] = useState(false);
  const [editingEnum, setEditingEnum] = useState<StaticDataRow | null>(null);
  const [enumEntity, setEnumEntity] = useState('');
  const [enumName, setEnumName] = useState('');
  const [enumKvList, setEnumKvList] = useState<KV[]>([{ key: '', label: '' }]);
  /** Per-language label overrides being edited: locale -> (values key -> translated label). */
  const [enumTranslations, setEnumTranslations] = useState<Record<string, Record<string, string>>>({});
  const [translationLocale, setTranslationLocale] = useState<Locale>('de');

  // -------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------
  async function reloadEnums() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setEnums(data);
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    setLoading(true);
    reloadEnums().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // -------------------------------------------------------------
  // ENUM ACTIONS
  // -------------------------------------------------------------
  function openCreateEnum() {
    setEditingEnum(null);
    setEnumEntity('');
    setEnumName('');
    setEnumKvList([{ key: '', label: '' }]);
    setEnumTranslations({});
    setEnumDialogOpen(true);
  }

  function openEditEnum(row: StaticDataRow) {
    setEditingEnum(row);
    setEnumEntity(row.entity);
    setEnumName(row.enum_name);
    const list = valuesToKvList(row.values);
    setEnumKvList(list.length > 0 ? list : [{ key: '', label: '' }]);
    setEnumTranslations(row.translation ?? {});
    setEnumDialogOpen(true);
  }

  function updateKv(index: number, field: 'key' | 'label', value: string) {
    setEnumKvList((prev) => prev.map((kv, i) => (i === index ? { ...kv, [field]: value } : kv)));
  }

  function addKvRow() {
    setEnumKvList((prev) => [...prev, { key: '', label: '' }]);
  }

  function removeKvRow(index: number) {
    setEnumKvList((prev) => prev.filter((_, i) => i !== index));
  }

  /** Set (or clear, when blank) one key's translated label for one locale. */
  function updateTranslation(locale: Locale, key: string, label: string) {
    setEnumTranslations((prev) => {
      const forLocale = { ...(prev[locale] ?? {}) };
      if (label.trim()) forLocale[key] = label;
      else delete forLocale[key];
      const next = { ...prev, [locale]: forLocale };
      if (Object.keys(forLocale).length === 0) delete next[locale];
      return next;
    });
  }

  async function handleSaveEnum() {
    if (!enumEntity.trim() || !enumName.trim()) return;
    setError(null);
    const values = kvListToValues(enumKvList);
    try {
      if (editingEnum) {
        await fetch(`${API}/organizations/${orgId}/static-data/${editingEnum.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ enumName: enumName.trim(), values, translation: enumTranslations }),
        });
        setSuccess(`Enum "${enumName}" updated.`);
      } else {
        const res = await fetch(`${API}/organizations/${orgId}/static-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ entity: enumEntity.trim(), enumName: enumName.trim(), values, translation: enumTranslations }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error === 'forbidden' ? 'Only admins can manage static data.' : 'Failed to create enum.');
          return;
        }
        setSuccess(`Enum "${enumName}" created.`);
      }
      setEnumDialogOpen(false);
      await reloadEnums();
    } catch {
      setError('Failed to save enum.');
    }
  }

  async function handleDeleteEnum(row: StaticDataRow) {
    if (!confirm(`Delete enum "${row.enum_name}" (${row.entity})?`)) return;
    setError(null);
    try {
      await fetch(`${API}/organizations/${orgId}/static-data/${row.id}`, { method: 'DELETE', headers: await authHeaders() });
      setEnums((prev) => prev.filter((e) => e.id !== row.id));
      setSuccess('Enum deleted.');
    } catch {
      setError('Failed to delete enum.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">{t('staticdata.title')}</Typography>
        <Chip label="Admin Access" color="secondary" size="small" variant="outlined" />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('staticdata.description', { count: enums.length })}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" size="small" onClick={openCreateEnum}>{t('staticdata.newEnum')}</Button>
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('staticdata.entity')}</TableCell>
              <TableCell>{t('staticdata.enumName')}</TableCell>
              <TableCell>{t('staticdata.values')}</TableCell>
              <TableCell align="right">{t('staticdata.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {enums.map((row) => {
              const translatedLocales = LOCALES.filter((l) => Object.keys(row.translation?.[l.code] ?? {}).length > 0);
              return (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{row.entity}</TableCell>
                  <TableCell>{row.enum_name}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {Object.entries(row.values).map(([k, v]) => (
                        <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" />
                      ))}
                      {Object.keys(row.values).length === 0 && (
                        <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>
                      )}
                    </Box>
                    {translatedLocales.length > 0 && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        {t('staticdata.translatedInto', { locales: translatedLocales.map((l) => l.code.toUpperCase()).join(', ') })}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" sx={{ mr: 1 }} onClick={() => openEditEnum(row)}>{t('staticdata.edit')}</Button>
                    <Button size="small" color="error" onClick={() => handleDeleteEnum(row)}>{t('staticdata.delete')}</Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {enums.length === 0 && (
              <TableRow><TableCell colSpan={4}>{t('staticdata.noneYet')}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <UserLookup authHeaders={authHeaders} />

      {/* ========================================================================= */}
      {/* DIALOG: CREATE / EDIT ENUM                                                */}
      {/* ========================================================================= */}
      <Dialog open={enumDialogOpen} onClose={() => setEnumDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingEnum ? t('staticdata.editEnum') : t('staticdata.newEnumTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <TextField
            label={t('staticdata.entity')}
            value={enumEntity}
            onChange={(e) => setEnumEntity(e.target.value)}
            size="small"
            required
            autoFocus
            disabled={!!editingEnum}
            placeholder="e.g. projects"
            helperText={t('staticdata.entityHelper')}
            sx={{ mt: 1 }}
          />
          <TextField
            label={t('staticdata.enumName')}
            value={enumName}
            onChange={(e) => setEnumName(e.target.value)}
            size="small"
            required
            placeholder="e.g. project_type"
          />
          <Typography variant="subtitle2">{t('staticdata.values')}</Typography>
          {enumKvList.map((kv, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField label={t('staticdata.key')} value={kv.key} onChange={(e) => updateKv(i, 'key', e.target.value)} size="small" sx={{ flex: 1 }} />
              <TextField label={t('staticdata.label')} value={kv.label} onChange={(e) => updateKv(i, 'label', e.target.value)} size="small" sx={{ flex: 1 }} />
              <IconButton size="small" color="error" onClick={() => removeKvRow(i)} disabled={enumKvList.length === 1} aria-label="Remove value">
                ✕
              </IconButton>
            </Box>
          ))}
          <Button size="small" onClick={addKvRow} sx={{ justifySelf: 'start' }}>{t('staticdata.addValue')}</Button>

          <Box sx={{ mt: 1, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2">{t('staticdata.translations')}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              {t('staticdata.translationsHelper')}
            </Typography>
            <TextField
              select
              label={t('usermenu.language')}
              value={translationLocale}
              onChange={(e) => setTranslationLocale(e.target.value as Locale)}
              size="small"
              sx={{ minWidth: 160, mb: 1.5 }}
            >
              {LOCALES.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
            </TextField>
            <Box sx={{ display: 'grid', gap: 1 }}>
              {enumKvList.filter((kv) => kv.key.trim()).map((kv) => (
                <Box key={kv.key} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ minWidth: 100, fontFamily: 'monospace' }}>{kv.key}</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder={kv.label || kv.key}
                    value={enumTranslations[translationLocale]?.[kv.key] ?? ''}
                    onChange={(e) => updateTranslation(translationLocale, kv.key, e.target.value)}
                  />
                </Box>
              ))}
              {enumKvList.filter((kv) => kv.key.trim()).length === 0 && (
                <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnumDialogOpen(false)}>{t('staticdata.cancel')}</Button>
          <Button variant="contained" onClick={handleSaveEnum} disabled={!enumEntity.trim() || !enumName.trim()}>{t('staticdata.save')}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
