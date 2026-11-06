import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { checkFieldOverride, checkGroupsOverride, GROUPS_KEY, mergeForm, type FormDef, type ResolvedForm } from '@worktime3/shared/fields';
import { Alert, Button } from '@mui/material';
import { changedKeys, cloneLayers, configFor, emptyLayer, type Layers, type Scope } from './formDesign';
import { useT } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

// ---------------------------------------------------------------------------
// Design mode on/off, for the whole app (switched in the user menu)
// ---------------------------------------------------------------------------

export interface DesignModeState {
  /** The caller may use design mode in the current org (developer, or superdeveloper). */
  canDesign: boolean;
  /** The caller may edit the global template (superdeveloper). */
  canEditGlobal: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** Where the side panel goes: below the app bar, left of anything pinned to the right edge. */
  panelTop: number;
  panelRight: number;
  /** Number of configurable forms on screen; a page with none shows a notice while designing. */
  formCount: number;
  /** Called by useFormTemplate while design mode is on; returns the unregister function. */
  registerForm: () => () => void;
}

const DesignModeContext = createContext<DesignModeState>({
  canDesign: false,
  canEditGlobal: false,
  enabled: false,
  setEnabled: () => {},
  panelTop: 64,
  panelRight: 0,
  formCount: 0,
  registerForm: () => () => {},
});

export function DesignModeProvider({ value, children }: { value: DesignModeState; children: ReactNode }) {
  return <DesignModeContext.Provider value={value}>{children}</DesignModeContext.Provider>;
}

export function useDesignMode(): DesignModeState {
  return useContext(DesignModeContext);
}

/**
 * While design mode is on and the page shows no configurable form, says so, so the switch never
 * seems to do nothing. Waits a moment so a lazily loaded page can register its form first.
 */
export function DesignModeNotice() {
  const t = useT();
  const { enabled, formCount, setEnabled, panelRight } = useDesignMode();
  const empty = enabled && formCount === 0;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!empty) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), 600);
    return () => clearTimeout(timer);
  }, [empty]);
  if (!show) return null;
  return (
    <Alert
      severity="info"
      sx={{ position: 'fixed', bottom: 16, right: panelRight + 16, zIndex: (th) => th.zIndex.snackbar, maxWidth: 420, boxShadow: 3 }}
      action={
        <Button color="inherit" size="small" onClick={() => setEnabled(false)}>
          {t('design.close')}
        </Button>
      }
    >
      {t('design.noFormOnPage')}
    </Alert>
  );
}

/**
 * Asks the API whether the caller may design forms in `orgId`. Fetched again on every org switch,
 * since the developer role is per organization. Design mode turns off when access is lost.
 */
export function useDesignAccess(orgId: string | null, authHeaders: () => Promise<Record<string, string>>): Omit<DesignModeState, 'panelTop' | 'panelRight'> {
  const [access, setAccess] = useState({ canDesign: false, canEditGlobal: false });
  const [enabled, setEnabled] = useState(false);
  const [formCount, setFormCount] = useState(0);
  const registerForm = useCallback(() => {
    setFormCount((n) => n + 1);
    return () => setFormCount((n) => n - 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAccess({ canDesign: false, canEditGlobal: false });
    setEnabled(false);
    if (!orgId) return;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/form-design-access`, { headers: await authHeaders() });
        const body = await res.json();
        if (!cancelled && body.ok) setAccess({ canDesign: !!body.canDesign, canEditGlobal: !!body.canEditGlobal });
      } catch { /* offline: no design mode */ }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return { ...access, enabled: enabled && access.canDesign, setEnabled, formCount, registerForm };
}

// ---------------------------------------------------------------------------
// One form's template, and its draft while designing
// ---------------------------------------------------------------------------

/** A failed save or check for one `field_config` key. */
export interface DesignError {
  scope: Scope;
  key: string;
  reason: string;
  property?: string;
}

export interface FormDesigner {
  formDef: FormDef;
  /** Code defaults + the draft layers: what the form shows while designing. */
  preview: ResolvedForm;
  /** Draft layers being edited (both scopes; only `scope` is changed by the panel). */
  draft: Layers;
  scope: Scope;
  setScope: (s: Scope) => void;
  /** Selected field key, or `group:<key>` for a section. */
  selected: string | null;
  select: (key: string | null) => void;
  /** Replaces the draft layer of the current scope. */
  update: (fn: (layer: Layers[Scope]) => Layers[Scope]) => void;
  /** Problems found by the client-side check of the current drafts. */
  problems: DesignError[];
  /** Number of `field_config` rows that would change on save. */
  changes: number;
  saving: boolean;
  saveErrors: DesignError[];
  panelTop: number;
  panelRight: number;
  /** Saves every changed row; resolves to what failed. */
  save: () => Promise<DesignError[]>;
  discard: () => void;
  canEditGlobal: boolean;
  close: () => void;
}

export interface FormTemplate {
  /** The template forms render: the saved one, or the design preview while designing. */
  form: ResolvedForm;
  /** The saved template. Use it for what a save sends, so a draft layout never changes saved keys. */
  savedForm: ResolvedForm;
  /** Present while design mode is on. */
  designer: FormDesigner | null;
}

/** Problems with the draft layers, by the same checks the API runs on save. */
function checkLayers(formDef: FormDef, saved: Layers, draft: Layers): DesignError[] {
  const out: DesignError[] = [];
  for (const scope of ['global', 'org'] as Scope[]) {
    for (const key of changedKeys(saved[scope], draft[scope])) {
      const config = configFor(draft[scope], key);
      const r = key === GROUPS_KEY ? checkGroupsOverride(formDef, config) : checkFieldOverride(formDef, key, config);
      if (!r.ok) out.push({ scope, key, reason: r.reason, property: r.property });
    }
  }
  return out;
}

/**
 * Loads the org's merged template for a form. With design mode on, also loads the layers and keeps
 * an editable draft; the form previews the draft until it is saved or discarded.
 */
export function useFormTemplate(orgId: string, formDef: FormDef, authHeaders: () => Promise<Record<string, string>>): FormTemplate {
  const mode = useDesignMode();
  const defaults = useMemo(() => mergeForm(formDef), [formDef]);
  const [savedForm, setSavedForm] = useState<ResolvedForm>(defaults);
  const [saved, setSaved] = useState<Layers | null>(null);
  const [draft, setDraft] = useState<Layers | null>(null);
  const [scope, setScope] = useState<Scope>('org');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<DesignError[]>([]);

  const loadForm = useCallback(async () => {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/forms/${formDef.id}`, { headers: await authHeaders() });
      const body = await res.json();
      setSavedForm(body.ok && body.form ? body.form : defaults);
    } catch {
      setSavedForm(defaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, formDef.id]);

  /** Loads the layers; returns them, or null when they cannot be read. */
  const loadLayers = useCallback(async (): Promise<Layers | null> => {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/forms/${formDef.id}/layers`, { headers: await authHeaders() });
      const body = await res.json();
      if (!body.ok) return null;
      const layers: Layers = {
        global: { fields: body.global?.fields ?? {}, groups: body.global?.groups ?? {} },
        org: { fields: body.org?.fields ?? {}, groups: body.org?.groups ?? {} },
      };
      setSaved(layers);
      return layers;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, formDef.id]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  const { enabled: designing, registerForm } = mode;
  useEffect(() => (designing ? registerForm() : undefined), [designing, registerForm]);

  useEffect(() => {
    setSaveErrors([]);
    setSelected(null);
    setScope('org');
    if (!mode.enabled) {
      setSaved(null);
      setDraft(null);
      return;
    }
    loadLayers().then((layers) => setDraft(layers ? cloneLayers(layers) : { global: emptyLayer(), org: emptyLayer() }));
  }, [mode.enabled, loadLayers]);

  const preview = useMemo(() => (draft ? mergeForm(formDef, draft.global, draft.org) : savedForm), [draft, formDef, savedForm]);
  const problems = useMemo(() => (saved && draft ? checkLayers(formDef, saved, draft) : []), [formDef, saved, draft]);
  const changes = saved && draft ? changedKeys(saved.global, draft.global).length + changedKeys(saved.org, draft.org).length : 0;

  async function save(): Promise<DesignError[]> {
    if (!saved || !draft) return [];
    setSaving(true);
    const errors: DesignError[] = [];
    try {
      const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
      for (const s of ['global', 'org'] as Scope[]) {
        if (s === 'global' && !mode.canEditGlobal) continue;
        const base = s === 'global' ? `${API}/forms/${formDef.id}` : `${API}/organizations/${orgId}/forms/${formDef.id}`;
        for (const key of changedKeys(saved[s], draft[s])) {
          try {
            const res = await fetch(`${base}/fields/${encodeURIComponent(key)}`, { method: 'PUT', headers, body: JSON.stringify({ config: configFor(draft[s], key) }) });
            const body = await res.json();
            if (!body.ok) errors.push({ scope: s, key, reason: body.reason ?? body.error ?? 'unknown', property: body.property });
          } catch {
            errors.push({ scope: s, key, reason: 'offline' });
          }
        }
      }
      const layers = await loadLayers();
      await loadForm();
      // Keep the draft of what failed, so it can be corrected; everything else now matches what is saved.
      if (layers) {
        const next = cloneLayers(layers);
        for (const e of errors) {
          if (e.key === GROUPS_KEY) next[e.scope].groups = draft[e.scope].groups;
          else if (draft[e.scope].fields[e.key]) next[e.scope].fields[e.key] = draft[e.scope].fields[e.key];
        }
        setDraft(next);
      }
    } finally {
      setSaveErrors(errors);
      setSaving(false);
    }
    return errors;
  }

  function discard() {
    if (saved) setDraft(cloneLayers(saved));
    setSaveErrors([]);
  }

  const designer: FormDesigner | null =
    mode.enabled && draft
      ? {
          formDef,
          preview,
          draft,
          scope,
          setScope,
          selected,
          select: setSelected,
          update: (fn) => setDraft((d) => (d ? { ...d, [scope]: fn(d[scope]) } : d)),
          problems,
          changes,
          saving,
          saveErrors,
          save,
          discard,
          canEditGlobal: mode.canEditGlobal,
          panelTop: mode.panelTop,
          panelRight: mode.panelRight,
          close: () => mode.setEnabled(false),
        }
      : null;

  return { form: designer ? preview : savedForm, savedForm, designer };
}

// ---------------------------------------------------------------------------
// Field frames: ConfigFieldGroup reads this to frame fields and report clicks
// ---------------------------------------------------------------------------

export interface FieldDesignState {
  selected: string | null;
  select: (key: string) => void;
}

const FieldDesignContext = createContext<FieldDesignState | null>(null);

/** Puts a form's fields into design mode: ConfigFieldGroups inside show frames and hidden fields. */
export function FieldDesignScope({ designer, children }: { designer: FormDesigner | null; children: ReactNode }) {
  const value = useMemo(() => (designer ? { selected: designer.selected, select: designer.select } : null), [designer?.selected, designer?.select]);
  return <FieldDesignContext.Provider value={value}>{children}</FieldDesignContext.Provider>;
}

export function useFieldDesign(): FieldDesignState | null {
  return useContext(FieldDesignContext);
}
