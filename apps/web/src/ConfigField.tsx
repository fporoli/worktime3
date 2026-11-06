import { useEffect, useState, type ReactNode } from 'react';
import { Box, Checkbox, FormControlLabel, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { deDE, enUS, frFR, itIT } from '@mui/x-date-pickers/locales';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/de';
import 'dayjs/locale/fr';
import 'dayjs/locale/it';
import { WIDTH_PX, formFields, type FieldDef, type FormDef } from '@worktime3/shared/fields';
import { useI18n, type Locale } from './i18n';
import { formatLocaleDate, formatLocaleDateTime, formatLocaleNumber, parseLocaleNumber } from './localeFormat';

export interface FieldOption {
  value: string;
  label: string;
}

const PICKER_TEXTS: Record<Locale, typeof enUS> = { en: enUS, de: deDE, fr: frFR, it: itIT };

/** Date pickers in the app's language (date order, month names, button texts). Wrap the app once. */
export function DatePickerLocalization({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  return (
    <LocalizationProvider
      dateAdapter={AdapterDayjs}
      adapterLocale={locale}
      localeText={PICKER_TEXTS[locale].components.MuiLocalizationProvider.defaultProps.localeText}
    >
      {children}
    </LocalizationProvider>
  );
}

function widthSx(field: FieldDef) {
  return field.width === 'full' ? { flexBasis: '100%' } : { minWidth: WIDTH_PX[field.width] };
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** How a stored value reads in the user's language. */
function displayValue(field: FieldDef, value: unknown, locale: string, options: FieldOption[] | undefined, yes: string, no: string): string {
  if (field.type === 'checkbox') return value === true ? yes : no;
  if (isEmpty(value)) return '';
  switch (field.type) {
    case 'number':
      return typeof value === 'number' ? formatLocaleNumber(value, locale) : String(value);
    case 'date':
      return formatLocaleDate(String(value), locale);
    case 'datetime':
      return formatLocaleDateTime(String(value), locale);
    case 'select':
      return options?.find((o) => o.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/**
 * A number entry that accepts the user's way of writing numbers (`12,50`, `1'234.50`) and hands
 * back a JS number, `null` when emptied. Shows the formatted value while not focused.
 */
function NumberEntry({ field, label, value, onChange, placeholder }: {
  field: FieldDef;
  label: string;
  value: unknown;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  const { t, locale } = useI18n();
  const formatted = typeof value === 'number' ? formatLocaleNumber(value, locale) : '';
  const [text, setText] = useState(formatted);
  const [focused, setFocused] = useState(false);
  const parsed = parseLocaleNumber(text, locale);
  const invalid = parsed === undefined;

  useEffect(() => {
    if (!focused) setText(formatted);
  }, [formatted, focused]);

  return (
    <TextField
      size="small"
      label={label}
      placeholder={placeholder}
      required={field.required}
      value={focused ? text : formatted}
      onFocus={() => {
        setText(formatted);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const next = parseLocaleNumber(e.target.value, locale);
        if (next !== undefined) onChange(next);
      }}
      error={focused && invalid}
      helperText={focused && invalid ? t('fields.invalidNumber') : undefined}
      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
      sx={widthSx(field)}
    />
  );
}

export interface ConfigFieldProps {
  field: FieldDef;
  value: unknown;
  editing: boolean;
  onChange: (value: unknown) => void;
  /** Options for a `select` field. */
  options?: FieldOption[];
}

/** One configurable field: read-only text when not editing, the right entry for its type when editing. */
export function ConfigField({ field, value, editing, onChange, options }: ConfigFieldProps) {
  const { t, locale } = useI18n();
  const label = t(field.caption);
  const placeholder = field.placeholder ? t(field.placeholder) : undefined;
  let content: ReactNode;

  if (!editing || field.readOnly) {
    const shown = displayValue(field, value, locale, options, t('common.yes'), t('common.no'));
    content = (
      <Box sx={widthSx(field)}>
        <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{shown || t('common.notSet')}</Typography>
      </Box>
    );
  } else {
    switch (field.type) {
      case 'checkbox':
        content = (
          <FormControlLabel
            sx={widthSx(field)}
            control={<Checkbox size="small" checked={value === true} onChange={(e) => onChange(e.target.checked)} />}
            label={label}
          />
        );
        break;
      case 'number':
        content = <NumberEntry field={field} label={label} value={value} onChange={onChange} placeholder={placeholder} />;
        break;
      case 'date':
        content = (
          <DatePicker
            label={label}
            value={isEmpty(value) ? null : dayjs(String(value))}
            onChange={(d: Dayjs | null) => onChange(d && d.isValid() ? d.format('YYYY-MM-DD') : '')}
            slotProps={{ textField: { size: 'small', required: field.required, sx: widthSx(field) } }}
          />
        );
        break;
      case 'datetime':
        content = (
          <DateTimePicker
            label={label}
            value={isEmpty(value) ? null : dayjs(String(value))}
            onChange={(d: Dayjs | null) => onChange(d && d.isValid() ? d.toISOString() : '')}
            slotProps={{ textField: { size: 'small', required: field.required, sx: widthSx(field) } }}
          />
        );
        break;
      case 'select':
        content = (
          <TextField
            select
            size="small"
            label={label}
            required={field.required}
            value={isEmpty(value) ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
            sx={widthSx(field)}
          >
            <MenuItem value=""><em>{t('common.notSet')}</em></MenuItem>
            {(options ?? []).map((o) => (<MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>))}
          </TextField>
        );
        break;
      default: {
        const rows = field.height ?? 1;
        content = (
          <TextField
            size="small"
            label={label}
            placeholder={placeholder}
            required={field.required}
            value={isEmpty(value) ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
            multiline={rows > 1}
            minRows={rows > 1 ? rows : undefined}
            sx={widthSx(field)}
          />
        );
      }
    }
  }

  if (!field.tooltip) return <>{content}</>;
  return (
    <Tooltip title={t(field.tooltip)} placement="top-start">
      <Box component="span" sx={{ display: 'inline-flex', ...(field.width === 'full' ? { flexBasis: '100%' } : {}) }}>{content}</Box>
    </Tooltip>
  );
}

export interface ConfigFieldGroupProps {
  form: FormDef;
  group: string;
  values: Record<string, unknown>;
  editing: boolean;
  onChange: (key: string, value: unknown) => void;
  /** Option lists for `select` fields, by `FieldDef.options` name. */
  options?: Record<string, FieldOption[]>;
}

/** A group's fields in their configured order, wrapping like the hand-written forms did. */
export function ConfigFieldGroup({ form, group, values, editing, onChange, options }: ConfigFieldGroupProps) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {formFields(form, group).map((field) => (
        <Box key={field.key} sx={{ display: 'contents' }}>
          {field.newRow && <Box sx={{ flexBasis: '100%', height: 0 }} />}
          <ConfigField
            field={field}
            value={values[field.key]}
            editing={editing}
            onChange={(v) => onChange(field.key, v)}
            options={field.options ? options?.[field.options] : undefined}
          />
        </Box>
      ))}
    </Box>
  );
}
