import { useEffect, useRef, useState } from 'react';
import { alpha } from '@mui/material/styles';
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { LOCALES, useT, type Locale } from './i18n';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { AddIcon, BusinessIcon, ContentCopyIcon, DeleteIcon, EditIcon, PublicIcon, SearchIcon, TuneIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const MAX_PREVIEW_VALUES = 15;

type StaticDataScope = 'org' | 'global';

interface StaticDataRow {
  id: string;
  organization_id: string | null;
  entity: string;
  entity_uuid: string | null;
  enum_name: string;
  values: Record<string, string>;
  translation: Record<string, Record<string, string>>;
}

interface KV {
  rowId: number;
  key: string;
  label: string;
}

function kvListToValues(list: KV[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, label } of list) {
    if (key.trim()) out[key.trim()] = label;
  }
  return out;
}

function rowKey(entity: string, enumName: string): string {
  return `${entity}\0${enumName}`;
}

interface AdminSettingsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function AdminSettings({ orgId, authHeaders }: AdminSettingsProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canEditGlobal, setCanEditGlobal] = useState(false);
  const nextRowId = useRef(1);

  const [enums, setEnums] = useState<StaticDataRow[]>([]);
  const [enumDialogOpen, setEnumDialogOpen] = useState(false);
  const [editingEnum, setEditingEnum] = useState<StaticDataRow | null>(null);
  const [dialogScope, setDialogScope] = useState<StaticDataScope>('org');
  const [enumEntity, setEnumEntity] = useState('');
  const [enumName, setEnumName] = useState('');
  const [deletingEnum, setDeletingEnum] = useState<StaticDataRow | null>(null);
  const [enumKvList, setEnumKvList] = useState<KV[]>([{ rowId: 0, key: '', label: '' }]);
  const [enumTranslations, setEnumTranslations] = useState<Record<string, Record<string, string>>>({});
  const [translationLocale, setTranslationLocale] = useState<Locale>('de');
  const [kvFilter, setKvFilter] = useState('');

  function makeKv(key = '', label = ''): KV {
    nextRowId.current += 1;
    return { rowId: nextRowId.current, key, label };
  }

  async function reloadEnums() {
    try {
      const headers = await authHeaders();
      const [rowsRes, accessRes] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/static-data`, { headers }),
        fetch(`${API}/organizations/${orgId}/static-data/global-access`, { headers }),
      ]);
      const data = await rowsRes.json();
      if (Array.isArray(data)) setEnums(data);
      const accessData = await accessRes.json();
      if (accessData && typeof accessData.canEditGlobal === 'boolean') {
        setCanEditGlobal(accessData.canEditGlobal);
      }
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    setLoading(true);
    void reloadEnums().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function openCreateEnum(scope: StaticDataScope = 'org') {
    setEditingEnum(null);
    setDialogScope(scope);
    setEnumEntity('');
    setEnumName('');
    setEnumKvList([makeKv()]);
    setEnumTranslations({});
    setKvFilter('');
    setDialogError(null);
    setEnumDialogOpen(true);
  }

  function openEditEnum(row: StaticDataRow) {
    setEditingEnum(row);
    setDialogScope(row.organization_id === null ? 'global' : 'org');
    setEnumEntity(row.entity);
    setEnumName(row.enum_name);
    const list = Object.entries(row.values).map(([k, v]) => makeKv(k, v));
    setEnumKvList(list.length > 0 ? list : [makeKv()]);
    setEnumTranslations(row.translation ?? {});
    setKvFilter('');
    setDialogError(null);
    setEnumDialogOpen(true);
  }

  function openOverrideEnum(row: StaticDataRow) {
    setEditingEnum(null);
    setDialogScope('org');
    setEnumEntity(row.entity);
    setEnumName(row.enum_name);
    const list = Object.entries(row.values).map(([k, v]) => makeKv(k, v));
    setEnumKvList(list.length > 0 ? list : [makeKv()]);
    setEnumTranslations(row.translation ?? {});
    setKvFilter('');
    setDialogError(null);
    setEnumDialogOpen(true);
  }

  function updateKv(rowId: number, field: 'key' | 'label', value: string) {
    setEnumKvList((prev) => prev.map((kv) => (kv.rowId === rowId ? { ...kv, [field]: value } : kv)));
  }

  function addKvRow() {
    setKvFilter('');
    setEnumKvList((prev) => [...prev, makeKv()]);
  }

  function removeKvRow(rowId: number) {
    setEnumKvList((prev) => prev.filter((kv) => kv.rowId !== rowId));
  }

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

  function apiErrorText(errCode: string | undefined, fallbackKey: string): string {
    if (errCode === 'forbidden') return t('staticdata.forbidden');
    if (errCode === 'duplicate-enum') return t('staticdata.duplicateEnum');
    return t(fallbackKey);
  }

  async function handleSaveEnum() {
    if (!enumEntity.trim() || !enumName.trim()) return;
    setError(null);
    setSuccess(null);
    setDialogError(null);
    const values = kvListToValues(enumKvList);
    try {
      if (editingEnum) {
        const res = await fetch(`${API}/organizations/${orgId}/static-data/${editingEnum.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ enumName: enumName.trim(), values, translation: enumTranslations }),
        });
        const data = await res.json();
        if (data.ok === false) {
          setDialogError(apiErrorText(data.error, 'staticdata.saveFailed'));
          return;
        }
        setSuccess(t('staticdata.updated', { name: enumName }));
      } else {
        const res = await fetch(`${API}/organizations/${orgId}/static-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            scope: dialogScope,
            entity: enumEntity.trim(),
            enumName: enumName.trim(),
            values,
            translation: enumTranslations,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          setDialogError(apiErrorText(data.error, 'staticdata.createFailed'));
          return;
        }
        setSuccess(t('staticdata.created', { name: enumName }));
      }
      setEnumDialogOpen(false);
      await reloadEnums();
    } catch {
      setDialogError(t('staticdata.saveFailed'));
    }
  }

  async function handleDeleteEnum(row: StaticDataRow) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data/${row.id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (data.ok === false) {
        setError(apiErrorText(data.error, 'staticdata.deleteFailed'));
        return;
      }
      setEnums((prev) => prev.filter((e) => e.id !== row.id));
      setSuccess(t('staticdata.deleted'));
    } catch {
      setError(t('staticdata.deleteFailed'));
    }
  }

  const globalKeys = new Set(enums.filter((r) => r.organization_id === null).map((r) => rowKey(r.entity, r.enum_name)));
  const orgKeys = new Set(enums.filter((r) => r.organization_id !== null).map((r) => rowKey(r.entity, r.enum_name)));

  const normalizedKvFilter = kvFilter.trim().toLowerCase();
  const visibleKvList = normalizedKvFilter
    ? enumKvList.filter(
        (kv) =>
          kv.key.toLowerCase().includes(normalizedKvFilter) ||
          kv.label.toLowerCase().includes(normalizedKvFilter) ||
          (enumTranslations[translationLocale]?.[kv.key] ?? '').toLowerCase().includes(normalizedKvFilter),
      )
    : enumKvList;
  const visibleTranslationKvList = visibleKvList.filter((kv) => kv.key.trim());

  const isGlobalDialog = dialogScope === 'global';
  const isOverridingGlobal = !isGlobalDialog && globalKeys.has(rowKey(enumEntity.trim(), enumName.trim()));

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('staticdata.title')}
        subtitle={t('staticdata.description', { count: enums.length })}
        end={
          <>
            <Chip label={t('staticdata.adminAccess')} color="secondary" size="small" variant="outlined" />
            <Button variant="contained" size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => openCreateEnum('org')}>
              {t('staticdata.newEnum').replace('+ ', '')}
            </Button>
          </>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('staticdata.entity')}</TableCell>
                <TableCell>{t('staticdata.enumName')}</TableCell>
                <TableCell>{t('staticdata.scope')}</TableCell>
                <TableCell>{t('staticdata.values')}</TableCell>
                <TableCell align="right">{t('staticdata.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {enums.map((row) => {
                const isGlobal = row.organization_id === null;
                const key = rowKey(row.entity, row.enum_name);
                const hasOrgOverride = isGlobal && orgKeys.has(key);
                const overridesGlobal = !isGlobal && globalKeys.has(key);
                const canMutateRow = !isGlobal || canEditGlobal;
                const translatedLocales = LOCALES.filter((l) => Object.keys(row.translation?.[l.code] ?? {}).length > 0);
                const entries = Object.entries(row.values);
                const visibleEntries = entries.slice(0, MAX_PREVIEW_VALUES);
                const hiddenCount = entries.length - visibleEntries.length;
                return (
                  <TableRow
                    key={row.id}
                    hover
                    sx={
                      isGlobal
                        ? { bgcolor: (theme) => alpha(theme.palette.secondary.main, theme.palette.mode === 'dark' ? 0.12 : 0.05) }
                        : undefined
                    }
                  >
                    <TableCell
                      sx={
                        isGlobal
                          ? { fontWeight: 600, borderLeft: 3, borderColor: 'secondary.main' }
                          : { fontWeight: 600 }
                      }
                    >
                      {row.entity}
                    </TableCell>
                    <TableCell>{row.enum_name}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip
                        size="small"
                        icon={isGlobal ? <PublicIcon fontSize="small" /> : <BusinessIcon fontSize="small" />}
                        label={t(isGlobal ? 'staticdata.scope.global' : 'staticdata.scope.org')}
                        color={isGlobal ? 'secondary' : 'primary'}
                        variant={isGlobal ? 'filled' : 'outlined'}
                      />
                      {hasOrgOverride && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {t('staticdata.overriddenByOrg')}
                        </Typography>
                      )}
                      {overridesGlobal && (
                        <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 0.5 }}>
                          {t('staticdata.overridesGlobal')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {visibleEntries.map(([k, v]) => (
                          <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" />
                        ))}
                        {hiddenCount > 0 && (
                          <Chip
                            label={t('staticdata.moreValues', { count: hiddenCount })}
                            size="small"
                            onClick={canMutateRow ? () => openEditEnum(row) : undefined}
                          />
                        )}
                        {entries.length === 0 && (
                          <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>
                        )}
                      </Box>
                      {translatedLocales.length > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {t('staticdata.translatedInto', { locales: translatedLocales.map((l) => l.code.toUpperCase()).join(', ') })}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {isGlobal && !hasOrgOverride && (
                        <Tooltip title={t('staticdata.overrideForOrg')}>
                          <IconButton size="small" color="primary" aria-label={t('staticdata.overrideForOrg')} onClick={() => openOverrideEnum(row)}>
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title={canMutateRow ? t('staticdata.edit') : t('staticdata.globalReadOnly')}>
                        <span>
                          <IconButton size="small" aria-label={t('staticdata.edit')} disabled={!canMutateRow} onClick={() => openEditEnum(row)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={canMutateRow ? t('staticdata.delete') : t('staticdata.globalReadOnly')}>
                        <span>
                          <IconButton size="small" color="error" aria-label={t('staticdata.delete')} disabled={!canMutateRow} onClick={() => setDeletingEnum(row)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
              {enums.length === 0 && (
                <TableEmptyRow colSpan={5} icon={<TuneIcon fontSize="inherit" />} title={t('staticdata.noneYet')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog
        open={enumDialogOpen}
        onClose={() => setEnumDialogOpen(false)}
        fullWidth
        maxWidth="sm"
        slotProps={
          isGlobalDialog
            ? { paper: { sx: { borderTop: 4, borderColor: 'secondary.main' } } }
            : undefined
        }
      >
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveEnum();
          }}
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <span>{editingEnum ? t('staticdata.editEnum') : t('staticdata.newEnumTitle')}</span>
            <Chip
              size="small"
              icon={isGlobalDialog ? <PublicIcon fontSize="small" /> : <BusinessIcon fontSize="small" />}
              label={t(isGlobalDialog ? 'staticdata.scope.global' : 'staticdata.scope.org')}
              color={isGlobalDialog ? 'secondary' : 'primary'}
              variant={isGlobalDialog ? 'filled' : 'outlined'}
            />
          </DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            {!editingEnum && canEditGlobal && (
              <Box>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={dialogScope}
                  onChange={(_e, next: StaticDataScope | null) => {
                    if (next) setDialogScope(next);
                  }}
                >
                  <ToggleButton value="org" sx={{ gap: 0.75 }}>
                    <BusinessIcon fontSize="small" />
                    {t('staticdata.scope.org')}
                  </ToggleButton>
                  <ToggleButton value="global" color="secondary" sx={{ gap: 0.75 }}>
                    <PublicIcon fontSize="small" />
                    {t('staticdata.scope.global')}
                  </ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {t('staticdata.scopeHelp')}
                </Typography>
              </Box>
            )}
            {isGlobalDialog && (
              <Alert severity="warning" icon={<PublicIcon fontSize="small" />} variant="outlined">
                {t('staticdata.globalWarning')}
              </Alert>
            )}
            {isOverridingGlobal && (
              <Alert severity="info" variant="outlined">
                {t('staticdata.orgOverrideInfo')}
              </Alert>
            )}
            {dialogError && <Alert severity="error">{dialogError}</Alert>}
            <TextField
              label={t('staticdata.entity')}
              value={enumEntity}
              onChange={(e) => setEnumEntity(e.target.value)}
              size="small"
              required
              autoFocus
              disabled={!!editingEnum}
              placeholder={t('staticdata.entityPlaceholder')}
              helperText={t('staticdata.entityHelper')}
              sx={{ mt: 0.5 }}
            />
            <TextField
              label={t('staticdata.enumName')}
              value={enumName}
              onChange={(e) => setEnumName(e.target.value)}
              size="small"
              required
              placeholder={t('staticdata.enumNamePlaceholder')}
            />
            <Typography variant="subtitle2">{t('staticdata.values')}</Typography>
            {enumKvList.length > 15 && (
              <TextField
                size="small"
                placeholder={t('staticdata.filterPlaceholder')}
                value={kvFilter}
                onChange={(e) => setKvFilter(e.target.value)}
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
            )}
            {visibleKvList.map((kv) => (
              <Box key={kv.rowId} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField label={t('staticdata.key')} value={kv.key} onChange={(e) => updateKv(kv.rowId, 'key', e.target.value)} size="small" sx={{ flex: 1 }} />
                <TextField label={t('staticdata.label')} value={kv.label} onChange={(e) => updateKv(kv.rowId, 'label', e.target.value)} size="small" sx={{ flex: 1 }} />
                <IconButton size="small" color="error" onClick={() => removeKvRow(kv.rowId)} disabled={enumKvList.length === 1} aria-label={t('staticdata.removeValue')}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            {visibleKvList.length === 0 && (
              <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>
            )}
            <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={addKvRow} sx={{ justifySelf: 'start' }}>
              {t('staticdata.addValue').replace('+ ', '')}
            </Button>

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
                {visibleTranslationKvList.map((kv) => (
                  <Box key={kv.rowId} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
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
                {visibleTranslationKvList.length === 0 && (
                  <Typography variant="caption" color="text.secondary">{t('staticdata.empty')}</Typography>
                )}
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEnumDialogOpen(false)}>{t('staticdata.cancel')}</Button>
            <Button
              type="submit"
              variant="contained"
              color={isGlobalDialog ? 'secondary' : 'primary'}
              disabled={!enumEntity.trim() || !enumName.trim()}
            >
              {isGlobalDialog ? t('staticdata.saveGlobal') : t('staticdata.save')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={!!deletingEnum}
        title={t('staticdata.deleteTitle')}
        message={
          deletingEnum
            ? t(deletingEnum.organization_id === null ? 'staticdata.deleteGlobalConfirm' : 'staticdata.deleteConfirm', {
                name: deletingEnum.enum_name,
                entity: deletingEnum.entity,
              })
            : ''
        }
        confirmLabel={t('staticdata.delete')}
        cancelLabel={t('staticdata.cancel')}
        onClose={() => setDeletingEnum(null)}
        onConfirm={() => {
          if (deletingEnum) return handleDeleteEnum(deletingEnum);
        }}
      />
    </Box>
  );
}
