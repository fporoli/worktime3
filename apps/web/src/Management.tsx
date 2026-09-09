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

export interface OrgMember {
  id: string; // membership_id
  user_id: string;
  role_id: string;
  status: string;
  email: string;
  display_name: string;
}

export interface TeamItem {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  created_at?: string;
  member_count?: number;
}

export interface TeamMemberItem {
  team_id: string;
  membership_id: string;
  user_id: string;
  email: string;
  display_name: string;
  manager_user_id?: string | null;
  manager_display_name?: string | null;
  team_role_id?: string | null;
  team_role_name?: string | null;
}

export interface ProjectItem {
  id: string;
  organization_id: string;
  name: string;
  owner_user_id: string;
  cost_item?: string | null;
  type: 'internal' | 'customer' | 'research';
  owner_name?: string | null;
  owner_email?: string | null;
  subproject_count?: number;
}

export interface SubprojectItem {
  id: string;
  project_id: string;
  organization_id: string;
  name: string;
  owner_user_id: string;
  cost_item?: string | null;
  type: 'phase' | 'work_package' | 'task';
  owner_name?: string | null;
  owner_email?: string | null;
  project_name?: string | null;
}

interface ManagementProps {
  session: Session;
  role: 'admin' | 'manager' | 'user';
  authHeaders: () => Promise<Record<string, string>>;
  onDataChanged?: () => void;
}

export default function Management({ session, role, authHeaders, onDataChanged }: ManagementProps) {
  const orgId = session.memberships[0]?.organizationId ?? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const [tab, setTab] = useState<'teams' | 'projects'>('teams');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Org members for assignments
  const [members, setMembers] = useState<OrgMember[]>([
    { id: 'aaaaaaaa-aaaa-aaaa-aaaa-111111111111', user_id: '11111111-1111-1111-1111-111111111111', role_id: '00000000-0000-0000-0000-000000000002', status: 'active', email: 'admin@acme.example', display_name: 'Acme Admin' },
    { id: 'aaaaaaaa-aaaa-aaaa-aaaa-222222222222', user_id: '22222222-2222-2222-2222-222222222222', role_id: '00000000-0000-0000-0000-000000000006', status: 'active', email: 'manager@acme.example', display_name: 'Marta Manager' },
    { id: 'aaaaaaaa-aaaa-aaaa-aaaa-333333333333', user_id: '33333333-3333-3333-3333-333333333333', role_id: '00000000-0000-0000-0000-000000000003', status: 'active', email: 'user@acme.example', display_name: 'Uli User' },
  ]);

  // --- TEAMS STATE ---
  const [teams, setTeams] = useState<TeamItem[]>([
    { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', organization_id: orgId, name: 'Platform', description: 'Platform team', member_count: 1 },
  ]);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamItem | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');

  // Team Members Dialog
  const [selectedTeam, setSelectedTeam] = useState<TeamItem | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberItem[]>([]);
  const [addMemberId, setAddMemberId] = useState('');
  const [addMemberManagerId, setAddMemberManagerId] = useState('');

  // --- PROJECTS & SUBPROJECTS STATE ---
  const [projects, setProjects] = useState<ProjectItem[]>([
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      organization_id: orgId,
      name: 'Website Relaunch',
      owner_user_id: '22222222-2222-2222-2222-222222222222',
      cost_item: 'COST-100',
      type: 'customer',
      owner_name: 'Marta Manager',
      owner_email: 'manager@acme.example',
      subproject_count: 1,
    },
  ]);
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, SubprojectItem[]>>({
    'cccccccc-cccc-cccc-cccc-cccccccccccc': [
      {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        project_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        organization_id: orgId,
        name: 'Design phase',
        owner_user_id: '22222222-2222-2222-2222-222222222222',
        cost_item: 'COST-101',
        type: 'phase',
        owner_name: 'Marta Manager',
        owner_email: 'manager@acme.example',
      },
    ],
  });
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>('cccccccc-cccc-cccc-cccc-cccccccccccc');

  // Project Dialog
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectType, setProjectType] = useState<'internal' | 'customer' | 'research'>('internal');
  const [projectCost, setProjectCost] = useState('');
  const [projectOwner, setProjectOwner] = useState(session.userId);

  // Subproject Dialog
  const [subprojectDialogOpen, setSubprojectDialogOpen] = useState(false);
  const [editingSubproject, setEditingSubproject] = useState<SubprojectItem | null>(null);
  const [subprojectParentId, setSubprojectParentId] = useState<string>('');
  const [subprojectName, setSubprojectName] = useState('');
  const [subprojectType, setSubprojectType] = useState<'phase' | 'work_package' | 'task'>('phase');
  const [subprojectCost, setSubprojectCost] = useState('');
  const [subprojectOwner, setSubprojectOwner] = useState(session.userId);

  // -------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------
  async function reloadMembers() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) setMembers(data);
    } catch { /* offline fallback */ }
  }

  async function reloadTeams() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/teams`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setTeams(data);
    } catch { /* offline fallback */ }
  }

  async function reloadProjects() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/projects`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch { /* offline fallback */ }
  }

  async function reloadSubprojects(pid: string) {
    if (!pid) return;
    try {
      const res = await fetch(`${API}/projects/${pid}/subprojects`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) {
        setSubprojectsByProject((prev) => ({ ...prev, [pid]: data }));
      }
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    reloadMembers();
    reloadTeams();
    reloadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (expandedProjectId) reloadSubprojects(expandedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedProjectId]);

  // Load team members when selectedTeam changes
  async function loadTeamMembers(team: TeamItem) {
    setSelectedTeam(team);
    setAddMemberId('');
    setAddMemberManagerId('');
    try {
      const res = await fetch(`${API}/teams/${team.id}/members`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setTeamMembers(data);
    } catch {
      // offline fallback
      const uli = members.find((m) => m.email.includes('user'));
      if (uli) {
        setTeamMembers([
          {
            team_id: team.id,
            membership_id: uli.id,
            user_id: uli.user_id,
            email: uli.email,
            display_name: uli.display_name,
            manager_user_id: session.userId,
            manager_display_name: session.displayName,
          },
        ]);
      }
    }
  }

  // -------------------------------------------------------------
  // TEAM ACTIONS
  // -------------------------------------------------------------
  function openCreateTeam() {
    setEditingTeam(null);
    setTeamName('');
    setTeamDesc('');
    setTeamDialogOpen(true);
  }

  function openEditTeam(team: TeamItem) {
    setEditingTeam(team);
    setTeamName(team.name);
    setTeamDesc(team.description ?? '');
    setTeamDialogOpen(true);
  }

  async function handleSaveTeam() {
    if (!teamName.trim()) return;
    setError(null);
    try {
      if (editingTeam) {
        // Update team
        await fetch(`${API}/teams/${editingTeam.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ name: teamName.trim(), description: teamDesc.trim() || null }),
        });
        setTeams((prev) =>
          prev.map((t) => (t.id === editingTeam.id ? { ...t, name: teamName.trim(), description: teamDesc.trim() || null } : t)),
        );
        setSuccess(`Team "${teamName}" updated successfully.`);
      } else {
        // Create team
        const res = await fetch(`${API}/organizations/${orgId}/teams`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ name: teamName.trim(), description: teamDesc.trim() || null }),
        });
        const data = await res.json();
        const newTeam: TeamItem = {
          id: data.id ?? String(Date.now()),
          organization_id: orgId,
          name: teamName.trim(),
          description: teamDesc.trim() || null,
          member_count: 0,
        };
        setTeams((prev) => [...prev, newTeam]);
        setSuccess(`Team "${teamName}" created successfully.`);
      }
      setTeamDialogOpen(false);
      await reloadTeams();
    } catch {
      setError('Failed to save team.');
    }
  }

  async function handleDeleteTeam(teamId: string) {
    if (!confirm('Are you sure you want to delete this team?')) return;
    setError(null);
    try {
      await fetch(`${API}/teams/${teamId}`, { method: 'DELETE', headers: await authHeaders() });
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
      setSuccess('Team deleted successfully.');
      if (selectedTeam?.id === teamId) setSelectedTeam(null);
    } catch {
      setError('Failed to delete team.');
    }
  }

  async function handleAddTeamMember() {
    if (!selectedTeam || !addMemberId) return;
    const member = members.find((m) => m.id === addMemberId || m.user_id === addMemberId);
    if (!member) return;
    const mgr = members.find((m) => m.user_id === addMemberManagerId);
    setError(null);
    try {
      await fetch(`${API}/teams/${selectedTeam.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ membershipId: member.id, managerUserId: addMemberManagerId || undefined }),
      });
      const newTm: TeamMemberItem = {
        team_id: selectedTeam.id,
        membership_id: member.id,
        user_id: member.user_id,
        email: member.email,
        display_name: member.display_name,
        manager_user_id: addMemberManagerId || null,
        manager_display_name: mgr ? mgr.display_name : null,
      };
      setTeamMembers((prev) => [...prev.filter((m) => m.membership_id !== member.id), newTm]);
      setTeams((prev) =>
        prev.map((t) => (t.id === selectedTeam.id ? { ...t, member_count: (t.member_count ?? 0) + 1 } : t)),
      );
      setAddMemberId('');
      setAddMemberManagerId('');
      setSuccess(`Added ${member.display_name} to ${selectedTeam.name}.`);
    } catch {
      setError('Failed to add team member.');
    }
  }

  async function handleRemoveTeamMember(membershipId: string) {
    if (!selectedTeam) return;
    setError(null);
    try {
      await fetch(`${API}/teams/${selectedTeam.id}/members/${membershipId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      setTeamMembers((prev) => prev.filter((m) => m.membership_id !== membershipId));
      setTeams((prev) =>
        prev.map((t) => (t.id === selectedTeam.id ? { ...t, member_count: Math.max(0, (t.member_count ?? 1) - 1) } : t)),
      );
      setSuccess('Team member removed.');
    } catch {
      setError('Failed to remove team member.');
    }
  }

  // -------------------------------------------------------------
  // PROJECT ACTIONS
  // -------------------------------------------------------------
  function openCreateProject() {
    setEditingProject(null);
    setProjectName('');
    setProjectType('internal');
    setProjectCost('');
    setProjectOwner(session.userId);
    setProjectDialogOpen(true);
  }

  function openEditProject(proj: ProjectItem) {
    setEditingProject(proj);
    setProjectName(proj.name);
    setProjectType(proj.type);
    setProjectCost(proj.cost_item ?? '');
    setProjectOwner(proj.owner_user_id);
    setProjectDialogOpen(true);
  }

  async function handleSaveProject() {
    if (!projectName.trim()) return;
    setError(null);
    try {
      const owner = members.find((m) => m.user_id === projectOwner);
      if (editingProject) {
        await fetch(`${API}/projects/${editingProject.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            name: projectName.trim(),
            type: projectType,
            costItem: projectCost.trim() || null,
            ownerUserId: projectOwner,
          }),
        });
        setProjects((prev) =>
          prev.map((p) =>
            p.id === editingProject.id
              ? {
                  ...p,
                  name: projectName.trim(),
                  type: projectType,
                  cost_item: projectCost.trim() || null,
                  owner_user_id: projectOwner,
                  owner_name: owner?.display_name ?? p.owner_name,
                  owner_email: owner?.email ?? p.owner_email,
                }
              : p,
          ),
        );
        setSuccess(`Project "${projectName}" updated.`);
      } else {
        const res = await fetch(`${API}/organizations/${orgId}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            name: projectName.trim(),
            type: projectType,
            costItem: projectCost.trim() || undefined,
            ownerUserId: projectOwner,
          }),
        });
        const data = await res.json();
        const newProj: ProjectItem = {
          id: data.id ?? String(Date.now()),
          organization_id: orgId,
          name: projectName.trim(),
          type: projectType,
          cost_item: projectCost.trim() || null,
          owner_user_id: projectOwner,
          owner_name: owner?.display_name ?? session.displayName,
          owner_email: owner?.email ?? session.email,
          subproject_count: 0,
        };
        setProjects((prev) => [...prev, newProj]);
        setSuccess(`Project "${projectName}" created.`);
      }
      setProjectDialogOpen(false);
      onDataChanged?.();
      await reloadProjects();
    } catch {
      setError('Failed to save project.');
    }
  }

  async function handleDeleteProject(projectId: string) {
    if (!confirm('Are you sure you want to delete this project and all its subprojects?')) return;
    setError(null);
    try {
      await fetch(`${API}/projects/${projectId}`, { method: 'DELETE', headers: await authHeaders() });
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setSubprojectsByProject((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      if (expandedProjectId === projectId) setExpandedProjectId(null);
      setSuccess('Project deleted.');
      onDataChanged?.();
    } catch {
      setError('Failed to delete project.');
    }
  }

  // -------------------------------------------------------------
  // SUBPROJECT ACTIONS
  // -------------------------------------------------------------
  function canManageSubprojects(project: ProjectItem): boolean {
    if (role === 'admin') return true;
    if (role === 'manager' && project.owner_user_id === session.userId) return true;
    return false;
  }

  function openCreateSubproject(project: ProjectItem) {
    setEditingSubproject(null);
    setSubprojectParentId(project.id);
    setSubprojectName('');
    setSubprojectType('phase');
    setSubprojectCost('');
    setSubprojectOwner(session.userId);
    setSubprojectDialogOpen(true);
  }

  function openEditSubproject(sub: SubprojectItem) {
    setEditingSubproject(sub);
    setSubprojectParentId(sub.project_id);
    setSubprojectName(sub.name);
    setSubprojectType(sub.type);
    setSubprojectCost(sub.cost_item ?? '');
    setSubprojectOwner(sub.owner_user_id);
    setSubprojectDialogOpen(true);
  }

  async function handleSaveSubproject() {
    if (!subprojectName.trim() || !subprojectParentId) return;
    setError(null);
    try {
      const owner = members.find((m) => m.user_id === subprojectOwner);
      const parent = projects.find((p) => p.id === subprojectParentId);
      if (editingSubproject) {
        await fetch(`${API}/subprojects/${editingSubproject.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            name: subprojectName.trim(),
            type: subprojectType,
            costItem: subprojectCost.trim() || null,
            ownerUserId: subprojectOwner,
          }),
        });
        setSubprojectsByProject((prev) => ({
          ...prev,
          [subprojectParentId]: (prev[subprojectParentId] ?? []).map((s) =>
            s.id === editingSubproject.id
              ? {
                  ...s,
                  name: subprojectName.trim(),
                  type: subprojectType,
                  cost_item: subprojectCost.trim() || null,
                  owner_user_id: subprojectOwner,
                  owner_name: owner?.display_name ?? s.owner_name,
                  owner_email: owner?.email ?? s.owner_email,
                }
              : s,
          ),
        }));
        setSuccess(`Subproject "${subprojectName}" updated.`);
      } else {
        const res = await fetch(`${API}/projects/${subprojectParentId}/subprojects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            organizationId: orgId,
            name: subprojectName.trim(),
            type: subprojectType,
            costItem: subprojectCost.trim() || undefined,
            ownerUserId: subprojectOwner,
          }),
        });
        const data = await res.json();
        const newSub: SubprojectItem = {
          id: data.id ?? String(Date.now()),
          project_id: subprojectParentId,
          organization_id: orgId,
          name: subprojectName.trim(),
          type: subprojectType,
          cost_item: subprojectCost.trim() || null,
          owner_user_id: subprojectOwner,
          owner_name: owner?.display_name ?? session.displayName,
          owner_email: owner?.email ?? session.email,
          project_name: parent?.name ?? null,
        };
        setSubprojectsByProject((prev) => ({
          ...prev,
          [subprojectParentId]: [...(prev[subprojectParentId] ?? []), newSub],
        }));
        setProjects((prev) =>
          prev.map((p) => (p.id === subprojectParentId ? { ...p, subproject_count: (p.subproject_count ?? 0) + 1 } : p)),
        );
        setSuccess(`Subproject "${subprojectName}" added.`);
      }
      setSubprojectDialogOpen(false);
      onDataChanged?.();
      await reloadSubprojects(subprojectParentId);
    } catch {
      setError('Failed to save subproject.');
    }
  }

  async function handleDeleteSubproject(sub: SubprojectItem) {
    if (!confirm(`Are you sure you want to delete subproject "${sub.name}"?`)) return;
    setError(null);
    try {
      await fetch(`${API}/subprojects/${sub.id}`, { method: 'DELETE', headers: await authHeaders() });
      setSubprojectsByProject((prev) => ({
        ...prev,
        [sub.project_id]: (prev[sub.project_id] ?? []).filter((s) => s.id !== sub.id),
      }));
      setProjects((prev) =>
        prev.map((p) => (p.id === sub.project_id ? { ...p, subproject_count: Math.max(0, (p.subproject_count ?? 1) - 1) } : p)),
      );
      setSuccess(`Subproject "${sub.name}" deleted.`);
      onDataChanged?.();
    } catch {
      setError('Failed to delete subproject.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Management: Teams, Projects & Subprojects</Typography>
        <Chip
          label={role === 'admin' ? 'Admin Access (Full Control)' : 'Manager Access (Teams & Owned Subprojects)'}
          color={role === 'admin' ? 'secondary' : 'primary'}
          size="small"
          variant="outlined"
        />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Manage teams and assignments. Create and customize projects and subprojects.
        {role === 'manager' && ' Note: Managers may create/modify subprojects on projects they own.'}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tab value="teams" label={`Teams (${teams.length})`} />
        <Tab value="projects" label={`Projects & Subprojects (${projects.length})`} />
      </Tabs>

      {/* ========================================================================= */}
      {/* TAB 0: TEAMS                                                              */}
      {/* ========================================================================= */}
      {tab === 'teams' && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" size="small" onClick={openCreateTeam}>+ Create Team</Button>
          </Box>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Team Name</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="center">Members</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {teams.map((t) => (
                <TableRow key={t.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{t.name}</TableCell>
                  <TableCell>{t.description ?? '—'}</TableCell>
                  <TableCell align="center">
                    <Chip label={`${t.member_count ?? 0} members`} size="small" />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => loadTeamMembers(t)}>
                      Members
                    </Button>
                    <Button size="small" sx={{ mr: 1 }} onClick={() => openEditTeam(t)}>
                      Edit
                    </Button>
                    <Button size="small" color="error" onClick={() => handleDeleteTeam(t.id)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {teams.length === 0 && (
                <TableRow><TableCell colSpan={4}>No teams created yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: PROJECTS & SUBPROJECTS                                             */}
      {/* ========================================================================= */}
      {tab === 'projects' && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" size="small" onClick={openCreateProject}>+ Create Project</Button>
          </Box>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Project Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Cost Item</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell align="center">Subprojects</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.map((p) => {
                const isExpanded = expandedProjectId === p.id;
                const pSubprojects = subprojectsByProject[p.id] ?? [];
                const isOwner = p.owner_user_id === session.userId;
                const canSub = canManageSubprojects(p);

                return (
                  <TableRow key={p.id} hover selected={isExpanded}>
                    <TableCell sx={{ fontWeight: 600 }}>{p.name}</TableCell>
                    <TableCell>
                      <Chip
                        label={p.type}
                        size="small"
                        color={p.type === 'customer' ? 'primary' : p.type === 'research' ? 'warning' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{p.cost_item ?? '—'}</TableCell>
                    <TableCell>
                      {p.owner_name ?? p.owner_email ?? '—'}
                      {isOwner && <Chip label="You" size="small" color="success" sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell align="center">
                      <Button
                        size="small"
                        variant={isExpanded ? 'contained' : 'outlined'}
                        onClick={() => setExpandedProjectId(isExpanded ? null : p.id)}
                      >
                        Subprojects ({pSubprojects.length || p.subproject_count || 0})
                      </Button>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        sx={{ mr: 1 }}
                        disabled={role !== 'admin' && !isOwner}
                        onClick={() => openEditProject(p)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={role !== 'admin' && !isOwner}
                        onClick={() => handleDeleteProject(p.id)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {projects.length === 0 && (
                <TableRow><TableCell colSpan={6}>No projects created yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          {/* Subprojects Section for the currently expanded project */}
          {expandedProjectId && (() => {
            const currentProj = projects.find((p) => p.id === expandedProjectId);
            if (!currentProj) return null;
            const pSubs = subprojectsByProject[currentProj.id] ?? [];
            const canSub = canManageSubprojects(currentProj);

            return (
              <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Subprojects of "{currentProj.name}"
                  </Typography>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={!canSub}
                    onClick={() => openCreateSubproject(currentProj)}
                  >
                    + Add Subproject
                  </Button>
                </Box>
                {!canSub && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    (Only the project owner or an admin can add/modify subprojects for this project.)
                  </Typography>
                )}

                <Table size="small" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Subproject Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Cost Item</TableCell>
                      <TableCell>Owner</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pSubs.map((s) => (
                      <TableRow key={s.id} hover>
                        <TableCell sx={{ fontWeight: 500 }}>{s.name}</TableCell>
                        <TableCell><Chip label={s.type} size="small" variant="outlined" /></TableCell>
                        <TableCell>{s.cost_item ?? '—'}</TableCell>
                        <TableCell>
                          {s.owner_name ?? s.owner_email ?? '—'}
                          {s.owner_user_id === session.userId && <Chip label="You" size="small" color="success" sx={{ ml: 1 }} />}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            disabled={!canSub}
                            sx={{ mr: 1 }}
                            onClick={() => openEditSubproject(s)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            disabled={!canSub}
                            onClick={() => handleDeleteSubproject(s)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {pSubs.length === 0 && (
                      <TableRow><TableCell colSpan={5}>No subprojects yet for this project.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            );
          })()}
        </Box>
      )}

      {/* ========================================================================= */}
      {/* DIALOG: CREATE / EDIT TEAM                                                */}
      {/* ========================================================================= */}
      <Dialog open={teamDialogOpen} onClose={() => setTeamDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{editingTeam ? 'Edit Team' : 'Create Team'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <TextField
            label="Team Name"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            size="small"
            required
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={teamDesc}
            onChange={(e) => setTeamDesc(e.target.value)}
            size="small"
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTeamDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveTeam} disabled={!teamName.trim()}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* ========================================================================= */}
      {/* DIALOG: MANAGE TEAM MEMBERS                                               */}
      {/* ========================================================================= */}
      <Dialog open={!!selectedTeam} onClose={() => setSelectedTeam(null)} fullWidth maxWidth="sm">
        <DialogTitle>Team Members: {selectedTeam?.name}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          {selectedTeam?.description && (
            <Typography variant="body2" color="text.secondary">{selectedTeam.description}</Typography>
          )}

          <Typography variant="subtitle2">Current Members ({teamMembers.length})</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Member</TableCell>
                <TableCell>Manager</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {teamMembers.map((tm) => (
                <TableRow key={tm.membership_id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{tm.display_name}</Typography>
                    <Typography variant="caption" color="text.secondary">{tm.email}</Typography>
                  </TableCell>
                  <TableCell>{tm.manager_display_name ?? '—'}</TableCell>
                  <TableCell align="right">
                    <Button size="small" color="error" onClick={() => handleRemoveTeamMember(tm.membership_id)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {teamMembers.length === 0 && (
                <TableRow><TableCell colSpan={3}>No members in this team yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Add Member to Team</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField
                select
                label="Select Member"
                value={addMemberId}
                onChange={(e) => setAddMemberId(e.target.value)}
                size="small"
                sx={{ minWidth: 200 }}
              >
                <MenuItem value=""><em>Select member...</em></MenuItem>
                {members
                  .filter((m) => !teamMembers.some((tm) => tm.membership_id === m.id || tm.user_id === m.user_id))
                  .map((m) => (
                    <MenuItem key={m.id} value={m.id}>{m.display_name} ({m.email})</MenuItem>
                  ))}
              </TextField>
              <TextField
                select
                label="Assign Manager (Optional)"
                value={addMemberManagerId}
                onChange={(e) => setAddMemberManagerId(e.target.value)}
                size="small"
                sx={{ minWidth: 180 }}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {members.map((m) => (
                  <MenuItem key={m.user_id} value={m.user_id}>{m.display_name}</MenuItem>
                ))}
              </TextField>
              <Button variant="contained" size="small" disabled={!addMemberId} onClick={handleAddTeamMember}>
                Add
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedTeam(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ========================================================================= */}
      {/* DIALOG: CREATE / EDIT PROJECT                                             */}
      {/* ========================================================================= */}
      <Dialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingProject ? 'Edit Project' : 'Create Project'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <TextField
            label="Project Name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            size="small"
            required
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            select
            label="Type"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value as any)}
            size="small"
          >
            <MenuItem value="internal">Internal</MenuItem>
            <MenuItem value="customer">Customer</MenuItem>
            <MenuItem value="research">Research</MenuItem>
          </TextField>
          <TextField
            label="Cost Item"
            value={projectCost}
            onChange={(e) => setProjectCost(e.target.value)}
            size="small"
            placeholder="e.g. COST-101"
          />
          <TextField
            select
            label="Project Owner"
            value={projectOwner}
            onChange={(e) => setProjectOwner(e.target.value)}
            size="small"
          >
            {members.map((m) => (
              <MenuItem key={m.user_id} value={m.user_id}>
                {m.display_name} ({m.email}) {m.user_id === session.userId ? '(You)' : ''}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProjectDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveProject} disabled={!projectName.trim()}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* ========================================================================= */}
      {/* DIALOG: CREATE / EDIT SUBPROJECT                                          */}
      {/* ========================================================================= */}
      <Dialog open={subprojectDialogOpen} onClose={() => setSubprojectDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingSubproject ? 'Edit Subproject' : 'Add Subproject'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          <TextField
            label="Subproject Name"
            value={subprojectName}
            onChange={(e) => setSubprojectName(e.target.value)}
            size="small"
            required
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            select
            label="Type"
            value={subprojectType}
            onChange={(e) => setSubprojectType(e.target.value as any)}
            size="small"
          >
            <MenuItem value="phase">Phase</MenuItem>
            <MenuItem value="work_package">Work Package</MenuItem>
            <MenuItem value="task">Task</MenuItem>
          </TextField>
          <TextField
            label="Cost Item"
            value={subprojectCost}
            onChange={(e) => setSubprojectCost(e.target.value)}
            size="small"
            placeholder="e.g. COST-102"
          />
          <TextField
            select
            label="Subproject Owner"
            value={subprojectOwner}
            onChange={(e) => setSubprojectOwner(e.target.value)}
            size="small"
          >
            {members.map((m) => (
              <MenuItem key={m.user_id} value={m.user_id}>
                {m.display_name} ({m.email}) {m.user_id === session.userId ? '(You)' : ''}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubprojectDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveSubproject} disabled={!subprojectName.trim()}>Save</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

