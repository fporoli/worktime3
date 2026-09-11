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

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface StaticDataRow {
  id: string;
  entity: string;
  entity_uuid: string | null;
  enum_name: string;
  values: Record<string, string>;
  translation: Record<string, unknown>;
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

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Static Data</Typography>
        <Chip label="Admin Access" color="secondary" size="small" variant="outlined" />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Manage platform enums ({enums.length}) — the pickable values behind projects, subprojects, and other typed fields.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

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

      <UserLookup authHeaders={authHeaders} />

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
