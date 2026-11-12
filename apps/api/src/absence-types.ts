/**
 * Absence types live only in static_data (entity "absences", enum_name "absence_type"): the org's
 * own row, else the global one (inserted by 047-absence-approval-flag.sql). `values` maps each type
 * key to its attributes, e.g. `{"vacation": {}, "sickness": {"approval": false}}`; labels are in
 * `translation`.
 */
export interface AbsenceTypeAttributes {
  /** false: the absence is approved on submit and the manager is notified instead of asked. */
  approval?: boolean;
}

/** Whether an absence of this type goes to the manager for approval, given the row's `values`. */
export function absenceNeedsApproval(values: Record<string, unknown>, type: string): boolean {
  const attributes = values[type];
  if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
    return (attributes as AbsenceTypeAttributes).approval !== false;
  }
  return true;
}
