export const DEFAULT_ABSENCE_TYPES = ['vacation', 'military_service', 'accident', 'compensation', 'school', 'sickness', 'other'] as const;
export type AbsenceType = (typeof DEFAULT_ABSENCE_TYPES)[number];

/** Seed payload for a new org's `static_data` row (entity="absences", enum_name="absence_type")
 * — kept in sync with the one-time backfill in 026-absence-type-half-day-documents.sql. */
export const ABSENCE_TYPE_STATIC_DATA = {
  entity: 'absences',
  enum_name: 'absence_type',
  values: Object.fromEntries(DEFAULT_ABSENCE_TYPES.map((t) => [t, {}])),
  translation: {
    en: { vacation: 'Vacation', military_service: 'Military service', accident: 'Accident', compensation: 'Compensation', school: 'School / education', sickness: 'Sickness', other: 'Other' },
    de: { vacation: 'Ferien', military_service: 'Militärdienst', accident: 'Unfall', compensation: 'Kompensation', school: 'Schule / Ausbildung', sickness: 'Krankheit', other: 'Sonstiges' },
    fr: { vacation: 'Vacances', military_service: 'Service militaire', accident: 'Accident', compensation: 'Compensation', school: 'École / formation', sickness: 'Maladie', other: 'Autre' },
    it: { vacation: 'Vacanza', military_service: 'Servizio militare', accident: 'Infortunio', compensation: 'Compensazione', school: 'Scuola / formazione', sickness: 'Malattia', other: 'Altro' },
  },
};

export function isKnownAbsenceType(value: string): value is AbsenceType {
  return (DEFAULT_ABSENCE_TYPES as readonly string[]).includes(value);
}
