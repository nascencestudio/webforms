/**
 * The form builder's actions as data (ADR 0001 §2): what an admin submits in Dashboard → Webforms, turned
 * into an updated form or an error code the page explains. Pure; the endpoint saves the result.
 */
import {
	FIELD_TYPES,
	type Field,
	type FieldType,
	type Form,
	isEmail,
	LIMITS,
	multiLine,
	newId,
	oneLine,
	parseField,
	parseForm,
	parseSettings,
} from './forms.js';

export const ERRORS = {
	'name-required': 'Give the form a name.',
	'label-required': 'Give the field a label.',
	'text-required': 'A text block needs some text.',
	'options-required': 'Add at least one option (one per line).',
	'too-many-fields': `A form can have up to ${LIMITS.fields} fields.`,
	'bad-recipient': 'One of the recipients isn’t a valid email address.',
	'too-many-recipients': `Up to ${LIMITS.recipients} recipients.`,
	'bad-redirect': 'The page to go to must be a path on this site, like /thanks.',
	'bad-retention': `Keep submissions between 1 and ${LIMITS.retentionDays} days.`,
	'no-such-form': 'That form no longer exists.',
	'no-such-field': 'That field no longer exists.',
	'confirm-name': 'Type the form’s name exactly to delete it.',
	unknown: 'Unknown action.',
	failed: 'That didn’t work. Please try again.',
} as const;
export type BuilderError = keyof typeof ERRORS;

type Result = { form: Form } | { error: BuilderError };

const text = (form: FormData, name: string) => {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
};

export const FIELD_LABELS: Record<FieldType, string> = {
	text: 'Short text',
	email: 'Email',
	phone: 'Phone',
	textarea: 'Long text',
	select: 'Dropdown',
	radio: 'Radio buttons',
	checkboxes: 'Checkboxes',
	checkbox: 'Single checkbox',
	markup: 'Text block',
};

/** A field from the field form (new when `id` is null). */
function fieldFrom(form: FormData, id: string): Field | { error: BuilderError } {
	const type = text(form, 'type') as FieldType;
	if (!FIELD_TYPES.includes(type)) return { error: 'unknown' };
	const label = oneLine(text(form, 'label'), LIMITS.label);
	const help =
		type === 'markup' ? multiLine(text(form, 'help'), LIMITS.markup) : oneLine(text(form, 'help'), LIMITS.help);
	if (type === 'markup' && !help) return { error: 'text-required' };
	if (type !== 'markup' && !label) return { error: 'label-required' };
	const options = text(form, 'options')
		.split(/\r?\n/)
		.map((o) => oneLine(o, LIMITS.option))
		.filter(Boolean);
	if (['select', 'radio', 'checkboxes'].includes(type) && options.length === 0) return { error: 'options-required' };
	const max = Number(text(form, 'maxLength'));
	const field = parseField({
		id,
		type,
		label,
		help,
		required: form.get('required') === 'on',
		...(Number.isInteger(max) && max > 0 ? { maxLength: max } : {}),
		options,
	});
	return field ?? { error: 'unknown' };
}

/** Apply a builder action to a form. `random` makes ids. */
export function applyAction(current: Form, form: FormData, random: (n: number) => Uint8Array): Result {
	const action = text(form, 'action');
	const fieldId = text(form, 'field');
	const index = current.fields.findIndex((f) => f.id === fieldId);
	const save = (next: Form): Result => {
		const parsed = parseForm(next);
		return parsed ? { form: parsed } : { error: 'failed' };
	};

	switch (action) {
		case 'rename': {
			const name = oneLine(text(form, 'name'), LIMITS.name);
			return name ? save({ ...current, name }) : { error: 'name-required' };
		}
		case 'settings': {
			const recipients = text(form, 'recipients')
				.split(/[\s,;]+/)
				.map((r) => r.trim().toLowerCase())
				.filter(Boolean);
			if (recipients.some((r) => !isEmail(r))) return { error: 'bad-recipient' };
			if (new Set(recipients).size > LIMITS.recipients) return { error: 'too-many-recipients' };
			const redirect = text(form, 'redirect').trim();
			const settings = parseSettings({
				recipients,
				subject: text(form, 'subject'),
				thankYou: text(form, 'thankYou'),
				redirect,
				keep: form.get('keep') === 'on',
				retentionDays: Number(text(form, 'retentionDays')),
			});
			if (redirect && !settings.redirect) return { error: 'bad-redirect' };
			const days = Number(text(form, 'retentionDays'));
			if (!Number.isInteger(days) || days < 1 || days > LIMITS.retentionDays) return { error: 'bad-retention' };
			return save({ ...current, settings });
		}
		case 'add-field': {
			if (current.fields.length >= LIMITS.fields) return { error: 'too-many-fields' };
			const field = fieldFrom(form, newId('fd_', random));
			return 'error' in field ? field : save({ ...current, fields: [...current.fields, field] });
		}
		case 'edit-field': {
			if (index < 0) return { error: 'no-such-field' };
			const field = fieldFrom(form, fieldId);
			if ('error' in field) return field;
			return save({ ...current, fields: current.fields.map((f) => (f.id === fieldId ? field : f)) });
		}
		case 'move-up':
		case 'move-down': {
			if (index < 0) return { error: 'no-such-field' };
			const to = action === 'move-up' ? index - 1 : index + 1;
			if (to < 0 || to >= current.fields.length) return { form: current };
			const fields = [...current.fields];
			[fields[index], fields[to]] = [fields[to] as Field, fields[index] as Field];
			return save({ ...current, fields });
		}
		case 'remove-field': {
			if (index < 0) return { error: 'no-such-field' };
			return save({ ...current, fields: current.fields.filter((f) => f.id !== fieldId) });
		}
		default:
			return { error: 'unknown' };
	}
}

/** A new, empty form. */
export function newForm(name: unknown, random: (n: number) => Uint8Array): Result {
	const clean = oneLine(name, LIMITS.name);
	if (!clean) return { error: 'name-required' };
	const form = parseForm({ id: newId('wf_', random), name: clean, fields: [], settings: {} });
	return form ? { form } : { error: 'failed' };
}
