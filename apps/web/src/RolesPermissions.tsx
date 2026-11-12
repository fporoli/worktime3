import { Fragment, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
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
import {
  ACTIONS,
  ADMIN_LOCKED_PERMISSIONS,
  ADMIN_SECTION_OBJECTS,
  NAV_OBJECTS,
  SCOPES,
  SECTION_OBJECTS,
  WORK_SECTION_OBJECTS,
  allPermissionIds,
  permissionId,
  type PermissionObject,
} from '@worktime3/shared/permissions';
import { LOCALES, useI18n } from './i18n';
import { ConfirmDialog, TableEmptyRow } from './components';
import { AddIcon, BusinessIcon, DeleteIcon, EditIcon, PublicIcon, RestartAltIcon } from './icons';
import { roleLabel, type OrgRole } from './roleLabel';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface AdminRole extends OrgRole {
  permissions: string[];
  defaultPermissions: string[] | null;
  adminUserIds: string[];
  memberCount: number;
}

interface MemberOption {
  user_id: string;
  display_name: string;
  email: string;
}

type ViewScope = 'org' | 'global';

/** API error codes with their own message (`roles.error.<code>`). */
const KNOWN_ERRORS = new Set([
  'forbidden',
  'name-required',
  'name-too-long',
  'name-taken',
  'admin-role-locked',
  'system-role-name-locked',
  'owner-role-locked',
  'role-in-use',
  'unknown-permission',
]);

/** Ids this page manages; older ids still in the database (`data:read`, ...) are left out. */
const CATALOGUE = new Set(allPermissionIds());

const OBJECT_GROUPS: { key: string; objects: readonly PermissionObject[] }[] = [
  { key: 'roles.group.nav', objects: NAV_OBJECTS },
  { key: 'roles.group.basicdata', objects: SECTION_OBJECTS },
  { key: 'roles.group.work', objects: WORK_SECTION_OBJECTS },
  { key: 'roles.group.admin', objects: ADMIN_SECTION_OBJECTS },
];

interface Draft {
  id: string | null;
  name: string;
  description: string;
  translations: Record<string, string>;
  permissions: Set<string>;
  adminUserIds: string[];
  /** System role: name fixed, cannot be deleted. */
  isSystem: boolean;
}

export default function RolesPermissions({
  orgId,
  authHeaders,
}: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<ViewScope>('org');
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [canEditGlobal, setCanEditGlobal] = useState(false);
  const [canAdminister, setCanAdminister] = useState(true);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'delete'; role: AdminRole } | null>(null);

  function errorText(code: string | undefined, fallbackKey: string): string {
    if (code && KNOWN_ERRORS.has(code)) return t(`roles.error.${code}`);
    return t(fallbackKey, { error: code ?? t('common.unknownError') });
  }

  async function reload(scope: ViewScope = view) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/roles${scope === 'global' ? '?scope=global' : ''}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data?.ok === false) {
        setError(errorText(data.error, 'roles.loadFailed'));
        return;
      }
      setCanAdminister(data?.canAdminister !== false);
      setCanEditGlobal(data?.canEditGlobal === true);
      setRoles(Array.isArray(data?.roles) ? data.roles : []);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setView('org');
    void reload('org');
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/members`, { headers: await authHeaders() });
        const data = await res.json();
        if (Array.isArray(data)) setMembers(data);
      } catch { /* the role-admin picker stays empty */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function switchView(next: ViewScope | null) {
    if (!next || next === view) return;
    setView(next);
    void reload(next);
  }

  function openEdit(role: AdminRole) {
    setDialogError(null);
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description ?? '',
      translations: { ...(role.translations ?? {}) },
      permissions: new Set(role.permissions.filter((id) => CATALOGUE.has(id))),
      adminUserIds: role.adminUserIds,
      isSystem: role.scope !== 'custom',
    });
  }

  function openCreate() {
    setDialogError(null);
    setDraft({ id: null, name: '', description: '', translations: {}, permissions: new Set(), adminUserIds: [], isSystem: false });
  }

  function togglePermission(id: string) {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.permissions);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...d, permissions: next };
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setDialogError(null);
    try {
      const body = {
        scope: view,
        name: draft.name,
        description: draft.description,
        translations: draft.translations,
        permissions: [...draft.permissions],
        ...(view === 'org' ? { adminUserIds: draft.adminUserIds } : {}),
      };
      const res = await fetch(`${API}/organizations/${orgId}/roles${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data?.ok) {
        setDialogError(errorText(data?.error, 'roles.saveFailed'));
        return;
      }
      setDraft(null);
      setSuccess(t('roles.saved'));
      await reload();
    } catch {
      setDialogError(t('common.cannotReachApi'));
    } finally {
      setSaving(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    const { kind, role } = confirm;
    setConfirm(null);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/roles/${role.id}${kind === 'reset' ? '/reset' : ''}`, {
        method: kind === 'reset' ? 'POST' : 'DELETE',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (!data?.ok) {
        setError(errorText(data?.error, kind === 'reset' ? 'roles.resetFailed' : 'roles.deleteFailed'));
        return;
      }
      setSuccess(t(kind === 'reset' ? 'roles.resetDone' : 'roles.deleted'));
      await reload();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  if (!canAdminister) return <Alert severity="info">{t('roles.noAccess')}</Alert>;

  const isOwner = (role: Pick<AdminRole, 'name'>) => role.name === 'owner';
  const lockedForDraft = draft?.name === 'admin' ? new Set(ADMIN_LOCKED_PERMISSIONS) : new Set<string>();

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 260px' }}>
          {t(view === 'global' ? 'roles.globalHint' : 'roles.subtitle')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {canEditGlobal && (
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => switchView(v)}>
              <ToggleButton value="org"><BusinessIcon fontSize="small" sx={{ mr: 0.5 }} />{t('roles.scope.org')}</ToggleButton>
              <ToggleButton value="global"><PublicIcon fontSize="small" sx={{ mr: 0.5 }} />{t('roles.scope.global')}</ToggleButton>
            </ToggleButtonGroup>
          )}
          {view === 'org' && (
            <Button variant="contained" size="small" startIcon={<AddIcon fontSize="small" />} onClick={openCreate}>
              {t('roles.newRole')}
            </Button>
          )}
        </Box>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.role')}</TableCell>
                <TableCell>{t('roles.col.type')}</TableCell>
                {view === 'org' && <TableCell align="right">{t('roles.col.members')}</TableCell>}
                <TableCell align="right">{t('roles.col.permissions')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {roles.length === 0 && !loading && <TableEmptyRow colSpan={5} title={t('roles.empty')} />}
              {roles.map((role) => (
                <TableRow key={role.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{roleLabel(role, locale)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {role.name}
                      {role.description ? ` · ${role.description}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={t(`roles.type.${role.scope}`)}
                      color={role.scope === 'global' ? 'default' : role.scope === 'override' ? 'warning' : 'primary'}
                      variant="outlined"
                    />
                  </TableCell>
                  {view === 'org' && <TableCell align="right">{role.memberCount}</TableCell>}
                  <TableCell align="right">{isOwner(role) ? t('roles.allPermissions') : role.permissions.filter((id) => CATALOGUE.has(id)).length}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {!isOwner(role) && (
                      <Tooltip title={t('common.edit')}>
                        <IconButton size="small" onClick={() => openEdit(role)}><EditIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                    {view === 'org' && role.scope === 'override' && (
                      <Tooltip title={t('roles.reset')}>
                        <IconButton size="small" onClick={() => setConfirm({ kind: 'reset', role })}><RestartAltIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    )}
                    {view === 'org' && role.scope === 'custom' && (
                      <Tooltip title={role.memberCount > 0 ? t('roles.error.role-in-use') : t('common.delete')}>
                        <span>
                          <IconButton size="small" disabled={role.memberCount > 0} onClick={() => setConfirm({ kind: 'delete', role })}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t('roles.ownerNote')}</Typography>
      </Paper>

      <Dialog open={!!draft} onClose={() => setDraft(null)} maxWidth="md" fullWidth>
        <DialogTitle>{draft?.id ? t('roles.dialog.edit', { name: draft ? roleLabel(draft, locale) : '' }) : t('roles.dialog.create')}</DialogTitle>
        {draft && (
          <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
            {dialogError && <Alert severity="error">{dialogError}</Alert>}
            {view === 'org' && draft.isSystem && roles.find((r) => r.id === draft.id)?.scope === 'global' && (
              <Alert severity="info">{t('roles.overrideHint')}</Alert>
            )}
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' } }}>
              <TextField
                size="small"
                label={t('common.name')}
                value={draft.name}
                disabled={draft.isSystem}
                helperText={draft.isSystem ? t('roles.nameLocked') : undefined}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <TextField
                size="small"
                label={t('roles.field.description')}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('roles.field.translations')}</Typography>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
                {LOCALES.map((l) => (
                  <TextField
                    key={l.code}
                    size="small"
                    label={l.label}
                    value={draft.translations[l.code] ?? ''}
                    onChange={(e) => setDraft({ ...draft, translations: { ...draft.translations, [l.code]: e.target.value } })}
                  />
                ))}
              </Box>
            </Box>
            {view === 'org' && (
              <Autocomplete
                multiple
                size="small"
                options={members}
                getOptionLabel={(m) => `${m.display_name} (${m.email})`}
                isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
                value={members.filter((m) => draft.adminUserIds.includes(m.user_id))}
                onChange={(_, value) => setDraft({ ...draft, adminUserIds: value.map((m) => m.user_id) })}
                renderInput={(params) => <TextField {...params} label={t('roles.field.admins')} helperText={t('roles.field.adminsHint')} />}
              />
            )}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('roles.col.permissions')}</Typography>
              <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" sx={{ '& td, & th': { px: 0.5 } }}>
                  <TableHead>
                    <TableRow>
                      <TableCell rowSpan={2} sx={{ pl: '12px !important' }}>{t('roles.perm.object')}</TableCell>
                      {ACTIONS.map((a) => (
                        <TableCell key={a} colSpan={SCOPES.length} align="center" sx={{ borderLeft: 1, borderColor: 'divider' }}>
                          {t(`roles.perm.${a}`)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      {ACTIONS.map((a) =>
                        SCOPES.map((s, i) => (
                          <TableCell key={`${a}-${s}`} align="center" sx={i === 0 ? { borderLeft: 1, borderColor: 'divider' } : undefined}>
                            <Typography variant="caption">{t(`roles.scopeName.${s}`)}</Typography>
                          </TableCell>
                        )),
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {OBJECT_GROUPS.map((group) => (
                      <Fragment key={group.key}>
                        <TableRow>
                          <TableCell colSpan={1 + ACTIONS.length * SCOPES.length} sx={{ bgcolor: 'action.hover', pl: '12px !important' }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              {t(group.key)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                        {group.objects.map((o) => (
                          <TableRow key={o.id} hover>
                            <TableCell sx={{ pl: '12px !important' }}>
                              <Typography variant="body2">{t(o.caption)}</Typography>
                            </TableCell>
                            {ACTIONS.map((a) =>
                              SCOPES.map((s, i) => {
                                const id = permissionId(o.id, a, s);
                                const available = o.scopes.includes(s);
                                const locked = lockedForDraft.has(id);
                                return (
                                  <TableCell key={id} align="center" sx={i === 0 ? { borderLeft: 1, borderColor: 'divider' } : undefined}>
                                    {available && (
                                      <Checkbox
                                        size="small"
                                        sx={{ p: 0.25 }}
                                        checked={draft.permissions.has(id)}
                                        disabled={locked}
                                        onChange={() => togglePermission(id)}
                                        slotProps={{ input: { 'aria-label': `${t(o.caption)} ${t(`roles.perm.${a}`)} ${t(`roles.scopeName.${s}`)}` } }}
                                      />
                                    )}
                                  </TableCell>
                                );
                              }),
                            )}
                          </TableRow>
                        ))}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t('roles.perm.hint')}</Typography>
            </Box>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={saving || !draft?.name.trim()} onClick={() => void save()}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'reset' ? t('roles.reset') : t('common.delete')}
        message={
          confirm
            ? t(confirm.kind === 'reset' ? 'roles.resetConfirm' : 'roles.deleteConfirm', { name: roleLabel(confirm.role, locale) })
            : ''
        }
        confirmLabel={confirm?.kind === 'reset' ? t('roles.reset') : t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmColor={confirm?.kind === 'reset' ? 'warning' : 'error'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
      />
    </Box>
  );
}
