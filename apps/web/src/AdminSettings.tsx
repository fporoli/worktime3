import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import type { Session } from './Login';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface StaticDataRow {
  id: string;
  entity: string;
  entity_uuid: string | null;
  enum_name: string;
  values: Record<string, string>;
  translation: Record<string, unknown>;
}

interface OrgDetails {
  id: string;
  slug: string;
  name: string;
  type: string;
  avatar_url: string | null;
}

interface DomainItem {
  id: string;
  domain: string;
  verified_at: string | null;
  auto_join_enabled: boolean;
}

interface SsoConfig {
  protocol: 'saml2' | 'oidc';
  idp_entity_id: string;
  idp_sso_url: string;
  is_active: boolean;
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
  session: Session;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function AdminSettings({ session, authHeaders }: AdminSettingsProps) {
  const orgId = session.memberships[0]?.organizationId ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const [tab, setTab] = useState<'enums' | 'organization'>('enums');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- ENUMS STATE ---
  const [enums, setEnums] = useState<StaticDataRow[]>([]);
  const [enumDialogOpen, setEnumDialogOpen] = useState(false);
  const [editingEnum, setEditingEnum] = useState<StaticDataRow | null>(null);
  const [enumEntity, setEnumEntity] = useState('');
  const [enumName, setEnumName] = useState('');
  const [enumKvList, setEnumKvList] = useState<KV[]>([{ key: '', label: '' }]);

  // --- ORGANIZATION STATE ---
  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgLogoUrl, setOrgLogoUrl] = useState('');
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newDomainAutoJoin, setNewDomainAutoJoin] = useState(false);
  const [sso, setSso] = useState<SsoConfig | null>(null);
  const [ssoProtocol, setSsoProtocol] = useState<'saml2' | 'oidc'>('saml2');
  const [ssoEntityId, setSsoEntityId] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');

  // -------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------
  async function reloadEnums() {
    try {
      const res = await fetch(`${API}/static-data`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setEnums(data);
    } catch { /* offline fallback */ }
  }

  async function reloadOrg() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data) {
        setOrg(data);
        setOrgName(data.name ?? '');
        setOrgLogoUrl(data.avatar_url ?? '');
      }
    } catch { /* offline fallback */ }
  }

  async function reloadDomains() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/domains`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setDomains(data);
    } catch { /* offline fallback */ }
  }

  async function reloadSso() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/sso`, { headers: await authHeaders() });
      const data = await res.json();
      if (data) {
        setSso(data);
        setSsoProtocol(data.protocol ?? 'saml2');
        setSsoEntityId(data.idp_entity_id ?? '');
        setSsoUrl(data.idp_sso_url ?? '');
      }
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    reloadEnums();
    reloadOrg();
    reloadDomains();
    reloadSso();
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
    setEnumDialogOpen(true);
  }

  function openEditEnum(row: StaticDataRow) {
    setEditingEnum(row);
    setEnumEntity(row.entity);
    setEnumName(row.enum_name);
    const list = valuesToKvList(row.values);
    setEnumKvList(list.length > 0 ? list : [{ key: '', label: '' }]);
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

  async function handleSaveEnum() {
    if (!enumEntity.trim() || !enumName.trim()) return;
    setError(null);
    const values = kvListToValues(enumKvList);
    try {
      if (editingEnum) {
        await fetch(`${API}/static-data/${editingEnum.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ enumName: enumName.trim(), values }),
        });
        setSuccess(`Enum "${enumName}" updated.`);
      } else {
        const res = await fetch(`${API}/static-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ entity: enumEntity.trim(), enumName: enumName.trim(), values }),
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
      await fetch(`${API}/static-data/${row.id}`, { method: 'DELETE', headers: await authHeaders() });
      setEnums((prev) => prev.filter((e) => e.id !== row.id));
      setSuccess('Enum deleted.');
    } catch {
      setError('Failed to delete enum.');
    }
  }

  // -------------------------------------------------------------
  // ORGANIZATION ACTIONS
  // -------------------------------------------------------------
  async function handleSaveOrg() {
    if (!orgName.trim()) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ name: orgName.trim(), avatarUrl: orgLogoUrl.trim() || null }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? 'Only admins can edit organization settings.' : 'Failed to save organization.');
        return;
      }
      setSuccess('Organization settings saved.');
      await reloadOrg();
    } catch {
      setError('Failed to save organization.');
    }
  }

  async function handleAddDomain() {
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ domain, autoJoin: newDomainAutoJoin }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? 'Only admins can manage domains.' : 'Failed to add domain.');
        return;
      }
      setNewDomain('');
      setNewDomainAutoJoin(false);
      setSuccess(`Domain "${domain}" saved.`);
      await reloadDomains();
    } catch {
      setError('Failed to add domain.');
    }
  }

  async function handleSaveSso() {
    if (!ssoEntityId.trim() || !ssoUrl.trim()) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ protocol: ssoProtocol, idpEntityId: ssoEntityId.trim(), idpSsoUrl: ssoUrl.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? 'Only admins can configure SSO.' : 'Failed to save SSO configuration.');
        return;
      }
      setSuccess('SSO configuration saved.');
      await reloadSso();
    } catch {
      setError('Failed to save SSO configuration.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Static Data & Organization Settings</Typography>
        <Chip label="Admin Access" color="secondary" size="small" variant="outlined" />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Manage platform enums and organization-wide settings (name, domains, SSO).
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tab value="enums" label={`Enums (${enums.length})`} />
        <Tab value="organization" label="Organization" />
      </Tabs>

      {/* ========================================================================= */}
      {/* TAB: ENUMS                                                                */}
      {/* ========================================================================= */}
      {tab === 'enums' && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" size="small" onClick={openCreateEnum}>+ New Enum</Button>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Entity</TableCell>
                <TableCell>Enum Name</TableCell>
                <TableCell>Values</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {enums.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{row.entity}</TableCell>
                  <TableCell>{row.enum_name}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {Object.entries(row.values).map(([k, v]) => (
                        <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" />
                      ))}
                      {Object.keys(row.values).length === 0 && (
                        <Typography variant="caption" color="text.secondary">(empty)</Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" sx={{ mr: 1 }} onClick={() => openEditEnum(row)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => handleDeleteEnum(row)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
              {enums.length === 0 && (
                <TableRow><TableCell colSpan={4}>No static data enums defined yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* ========================================================================= */}
      {/* TAB: ORGANIZATION                                                         */}
      {/* ========================================================================= */}
      {tab === 'organization' && (
        <Box sx={{ display: 'grid', gap: 3 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Organization Profile</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField label="Organization Name" value={orgName} onChange={(e) => setOrgName(e.target.value)} size="small" sx={{ minWidth: 220 }} />
              <TextField label="Logo URL" value={orgLogoUrl} onChange={(e) => setOrgLogoUrl(e.target.value)} size="small" sx={{ minWidth: 260 }} placeholder="https://…" />
              <Button variant="contained" onClick={handleSaveOrg} disabled={!orgName.trim()}>Save</Button>
              {org && <Chip label={`slug: ${org.slug}`} size="small" variant="outlined" />}
            </Box>
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Verified Domains</Typography>
            <Table size="small" sx={{ mb: 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Domain</TableCell>
                  <TableCell>Verified</TableCell>
                  <TableCell>Auto-join</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {domains.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.domain}</TableCell>
                    <TableCell>{d.verified_at ? 'Yes' : 'Pending'}</TableCell>
                    <TableCell>{d.auto_join_enabled ? 'Enabled' : 'Disabled'}</TableCell>
                  </TableRow>
                ))}
                {domains.length === 0 && (
                  <TableRow><TableCell colSpan={3}>No domains configured yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField label="Add Domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} size="small" placeholder="example.com" />
              <FormControlLabel
                control={<Checkbox checked={newDomainAutoJoin} onChange={(e) => setNewDomainAutoJoin(e.target.checked)} size="small" />}
                label="Auto-join"
              />
              <Button variant="outlined" size="small" onClick={handleAddDomain} disabled={!newDomain.trim()}>Add</Button>
            </Box>
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>SSO Configuration</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField select label="Protocol" value={ssoProtocol} onChange={(e) => setSsoProtocol(e.target.value as 'saml2' | 'oidc')} size="small" sx={{ minWidth: 120 }}>
                <MenuItem value="saml2">SAML 2.0</MenuItem>
                <MenuItem value="oidc">OIDC</MenuItem>
              </TextField>
              <TextField label="IdP Entity ID" value={ssoEntityId} onChange={(e) => setSsoEntityId(e.target.value)} size="small" sx={{ minWidth: 220 }} />
              <TextField label="IdP SSO URL" value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} size="small" sx={{ minWidth: 260 }} />
              <Button variant="outlined" size="small" onClick={handleSaveSso} disabled={!ssoEntityId.trim() || !ssoUrl.trim()}>Save</Button>
              {sso && <Chip label={sso.is_active ? 'Active' : 'Inactive'} size="small" color={sso.is_active ? 'success' : 'default'} />}
            </Box>
          </Box>
        </Box>
      )}

      {/* ========================================================================= */}
      {/* DIALOG: CREATE / EDIT ENUM                                                */}
      {/* ========================================================================= */}
      <Dialog open={enumDialogOpen} onClose={() => setEnumDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingEnum ? 'Edit Enum' : 'New Enum'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <TextField
            label="Entity"
            value={enumEntity}
            onChange={(e) => setEnumEntity(e.target.value)}
            size="small"
            required
            autoFocus
            disabled={!!editingEnum}
            placeholder="e.g. projects"
            helperText="The table/resource this enum belongs to."
            sx={{ mt: 1 }}
          />
          <TextField
            label="Enum Name"
            value={enumName}
            onChange={(e) => setEnumName(e.target.value)}
            size="small"
            required
            placeholder="e.g. project_type"
          />
          <Typography variant="subtitle2">Values</Typography>
          {enumKvList.map((kv, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField label="Key" value={kv.key} onChange={(e) => updateKv(i, 'key', e.target.value)} size="small" sx={{ flex: 1 }} />
              <TextField label="Label" value={kv.label} onChange={(e) => updateKv(i, 'label', e.target.value)} size="small" sx={{ flex: 1 }} />
              <IconButton size="small" color="error" onClick={() => removeKvRow(i)} disabled={enumKvList.length === 1} aria-label="Remove value">
                ✕
              </IconButton>
            </Box>
          ))}
          <Button size="small" onClick={addKvRow} sx={{ justifySelf: 'start' }}>+ Add value</Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnumDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEnum} disabled={!enumEntity.trim() || !enumName.trim()}>Save</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
