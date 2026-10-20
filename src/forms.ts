/**
 * Forms and submissions (ADR 0001): form definitions (fields and settings), validated on every read and
 * save, and the validation of a visitor's submission against its form. Unknown fields are dropped; every
 * value is checked and capped; email and phone values can't carry line breaks. Pure.
 */

export const FORM_ID = /^wf_[a-z0-9]{16}$/;
export const FIELD_ID = /^fd_[a-z0-9]{10}$/;
export const FIELD_TYPES = [
	'text',
	'email',
	'phone',
	'textarea',
	'select',
	'radio',
	'checkboxes',
	'checkbox',
	'markup',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const LIMITS = {
	name: 60,
	label: 100,
	help: 300,
	markup: 2000,
	option: 100,
	options: 50,
	fields: 50,
	recipients: 10,
	subject: 150,
	thankYou: 500,
	textMax: 500,
	textareaMax: 10_000,
	email: 254,
	phone: 30,
	retentionDays: 3650,
} as const;

export interface Field {
	id: string;
	type: FieldType;
	/** The question (for `markup`: unused). */
	label: string;
	/** Help under the field (for `markup`: the text shown). */
	help: string;
	required: boolean;
	/** text / textarea: the longest answer. */
	maxLength?: number;
	/** select / radio / checkboxes: the choices. */
	options?: string[];
}

export interface FormSettings {
	/** Who gets the submissions by email. */
	recipients: string[];
	/** The email subject; `{form}` is replaced by the form's name. */
	subject: string;
	/** Shown after sending. */
	thankYou: string;
	/** A page on this site to go to after sending instead (`/thanks`), or empty. */
	redirect: string;
	/** Keep submissions on the Submissions page. */
	keep: boolean;
	/** Delete kept submissions after this many days. */
	retentionDays: number;
}

export interface Form {
	id: string;
	name: string;
	fields: Field[];
	settings: FormSettings;
}

export const DEFAULT_SETTINGS: FormSettings = {
	recipients: [],
	subject: 'New message from your website: {form}',
	thankYou: 'Thank you. Your message has been sent.',
	redirect: '',
	keep: true,
	retentionDays: 90,
};

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** One line of text: control characters become spaces, whitespace collapsed, trimmed, capped. */
export function oneLine(value: unknown, max: number): string {
	if (typeof value !== 'string') return '';
	let text = '';
	for (const char of value) text += (char.codePointAt(0) ?? 0) < 0x20 || char === '\u007f' ? ' ' : char;
	return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Several lines: CRLF/CR become LF, other control characters dropped, trailing spaces trimmed, capped. */
export function multiLine(value: unknown, max: number): string {
	if (typeof value !== 'string') return '';
	let text = '';
	for (const char of value.replace(/\r\n?/g, '\n')) {
		const code = char.codePointAt(0) ?? 0;
		if (char === '\n' || char === '\t' || (code >= 0x20 && code !== 0x7f)) text += char;
	}
	return text
		.split('\n')
		.map((line) => line.replace(/\s+$/, ''))
		.join('\n')
		.trim()
		.slice(0, max);
}

/** An email address: one line, one @, a dot in the domain, no spaces or angle brackets. */
export const EMAIL =
	/^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isEmail = (value: string) => value.length <= LIMITS.email && EMAIL.test(value);
/** A phone number: digits, spaces and + ( ) - . with at least 6 digits. */
export const isPhone = (value: string) =>
	value.length <= LIMITS.phone && /^[0-9+()\-. ]+$/.test(value) && (value.match(/[0-9]/g)?.length ?? 0) >= 6;

/** A path on this site (`/thanks`), or empty. */
export const cleanRedirect = (value: unknown): string =>
	typeof value === 'string' && /^\/(?!\/)[A-Za-z0-9\-._~/%]{0,200}$/.test(value.trim()) ? value.trim() : '';

const intIn = (value: unknown, min: number, max: number, fallback: number) =>
	typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;

const MAX_DEFAULT: Partial<Record<FieldType, number>> = { text: 200, textarea: 5000 };
const MAX_CEILING: Partial<Record<FieldType, number>> = { text: LIMITS.textMax, textarea: LIMITS.textareaMax };
const HAS_OPTIONS = new Set<FieldType>(['select', 'radio', 'checkboxes']);

export function parseField(raw: unknown): Field | null {
	if (!isObject(raw) || typeof raw.id !== 'string' || !FIELD_ID.test(raw.id)) return null;
	if (!FIELD_TYPES.includes(raw.type as FieldType)) return null;
	const type = raw.type as FieldType;
	const field: Field = {
		id: raw.id,
		type,
		label: oneLine(raw.label, LIMITS.label),
		help: type === 'markup' ? multiLine(raw.help, LIMITS.markup) : oneLine(raw.help, LIMITS.help),
		required: type !== 'markup' && raw.required === true,
	};
	if (type !== 'markup' && !field.label) return null;
	if (type === 'markup' && !field.help) return null;
	const ceiling = MAX_CEILING[type];
	if (ceiling) field.maxLength = intIn(raw.maxLength, 1, ceiling, MAX_DEFAULT[type] as number);
	if (HAS_OPTIONS.has(type)) {
		const options = Array.isArray(raw.options) ? raw.options : [];
		field.options = [...new Set(options.map((o) => oneLine(o, LIMITS.option)).filter(Boolean))].slice(
			0,
			LIMITS.options,
		);
		if (field.options.length === 0) return null;
	}
	return field;
}

export function parseSettings(raw: unknown): FormSettings {
	const r = isObject(raw) ? raw : {};
	const recipients = Array.isArray(r.recipients) ? r.recipients : [];
	return {
		recipients: [...new Set(recipients.map((x) => oneLine(x, LIMITS.email).toLowerCase()).filter(isEmail))].slice(
			0,
			LIMITS.recipients,
		),
		subject: oneLine(r.subject, LIMITS.subject) || DEFAULT_SETTINGS.subject,
		thankYou: oneLine(r.thankYou, LIMITS.thankYou) || DEFAULT_SETTINGS.thankYou,
		redirect: cleanRedirect(r.redirect),
		keep: typeof r.keep === 'boolean' ? r.keep : DEFAULT_SETTINGS.keep,
		retentionDays: intIn(r.retentionDays, 1, LIMITS.retentionDays, DEFAULT_SETTINGS.retentionDays),
	};
}

/** A stored or received form (any JSON) → a valid form, or null. Invalid fields are dropped. */
export function parseForm(raw: unknown): Form | null {
	if (!isObject(raw) || typeof raw.id !== 'string' || !FORM_ID.test(raw.id)) return null;
	const name = oneLine(raw.name, LIMITS.name);
	if (!name) return null;
	const seen = new Set<string>();
	const fields = (Array.isArray(raw.fields) ? raw.fields : [])
		.map(parseField)
		.filter((f): f is Field => {
			if (!f || seen.has(f.id)) return false;
			seen.add(f.id);
			return true;
		})
		.slice(0, LIMITS.fields);
	return { id: raw.id, name, fields, settings: parseSettings(raw.settings) };
}

/** The values a submission keeps, by field id: text, or the chosen options. */
export type Values = Record<string, string | string[]>;

export interface ValidationResult {
	values: Values;
	/** Messages by field id; empty when the submission is valid. */
	errors: Record<string, string>;
	/** The visitor's email (the first email field), for "Reply to". */
	replyTo: string | null;
}

/**
 * A submission against its form. `input` gives the posted values by name (the field's id): every
 * value is checked, capped and kept only if the form has that field.
 */
export function validateSubmission(form: Form, input: (name: string) => string[]): ValidationResult {
	const values: Values = {};
	const errors: Record<string, string> = {};
	let replyTo: string | null = null;
	for (const field of form.fields) {
		if (field.type === 'markup') continue;
		const raw = input(field.id).slice(0, LIMITS.options);
		const first = raw[0] ?? '';
		let value: string | string[] = '';
		switch (field.type) {
			case 'textarea': {
				const text = multiLine(first, LIMITS.textareaMax);
				if (text.length > (field.maxLength ?? LIMITS.textareaMax))
					errors[field.id] = `Use at most ${field.maxLength} characters.`;
				value = text;
				break;
			}
			case 'text': {
				const text = oneLine(first, LIMITS.textMax + 1);
				if (text.length > (field.maxLength ?? LIMITS.textMax))
					errors[field.id] = `Use at most ${field.maxLength} characters.`;
				value = text;
				break;
			}
			case 'email': {
				value = oneLine(first, LIMITS.email + 1);
				if (value && !isEmail(value)) errors[field.id] = 'Enter a valid email address.';
				else if (value && !replyTo) replyTo = value;
				break;
			}
			case 'phone': {
				value = oneLine(first, LIMITS.phone + 1);
				if (value && !isPhone(value)) errors[field.id] = 'Enter a valid phone number.';
				break;
			}
			case 'select':
			case 'radio': {
				value = oneLine(first, LIMITS.option);
				if (value && !field.options?.includes(value)) errors[field.id] = 'Choose one of the options.';
				break;
			}
			case 'checkboxes': {
				const chosen = [...new Set(raw.map((v) => oneLine(v, LIMITS.option)).filter(Boolean))];
				if (chosen.some((v) => !field.options?.includes(v))) errors[field.id] = 'Choose from the options.';
				value = chosen.filter((v) => field.options?.includes(v));
				break;
			}
			case 'checkbox': {
				value = first === 'yes' ? 'yes' : '';
				break;
			}
		}
		const empty = Array.isArray(value) ? value.length === 0 : value === '';
		if (field.required && empty && !errors[field.id]) {
			errors[field.id] = field.type === 'checkbox' ? 'Please tick this box.' : 'Please fill in this field.';
		}
		if (!empty) values[field.id] = value;
	}
	return { values, errors, replyTo };
}

/** How many links a submission's text contains (for the spam heuristic). */
export function linkCount(values: Values): number {
	const text = Object.values(values).flat().join('\n');
	return (text.match(/https?:\/\/|www\.|\[url[=\]]|<a\s/gi) ?? []).length;
}

/** The email subject, with `{form}` replaced; one line. */
export const subjectFor = (form: Form) =>
	oneLine(form.settings.subject.replaceAll('{form}', form.name), LIMITS.subject + LIMITS.name);

/** The email body: each field's label and answer, in order (plain text). */
export function emailBody(
	form: Form,
	values: Values,
	meta: { replyTo: string | null; when: string; page: string },
): string {
	const lines: string[] = [];
	for (const field of form.fields) {
		if (field.type === 'markup') continue;
		const value = values[field.id];
		const shown = Array.isArray(value)
			? value.join(', ')
			: field.type === 'checkbox'
				? value
					? 'Yes'
					: 'No'
				: (value ?? '');
		lines.push(`${field.label}:`, shown ? shown : '(empty)', '');
	}
	lines.push('—', `Form: ${form.name}`, `Sent: ${meta.when}`);
	if (meta.page) lines.push(`Page: ${meta.page}`);
	if (meta.replyTo) lines.push(`Reply to: ${meta.replyTo}`);
	return lines.join('\n');
}

/** A new id (`wf_` for forms, `fd_` for fields) from random bytes. */
export function newId(prefix: 'wf_' | 'fd_', random: (n: number) => Uint8Array): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	return prefix + [...random(prefix === 'wf_' ? 16 : 10)].map((b) => alphabet[b % 36]).join('');
}

/** The Contact form created on first use (ADR 0001 §2). */
export function contactForm(random: (n: number) => Uint8Array): Form {
	const field = (type: FieldType, label: string, required: boolean, extra: Partial<Field> = {}): Field => ({
		id: newId('fd_', random),
		type,
		label,
		help: '',
		required,
		...extra,
	});
	return {
		id: newId('wf_', random),
		name: 'Contact',
		fields: [
			field('text', 'Name', true, { maxLength: 100 }),
			field('email', 'Email', true),
			field('phone', 'Phone', false),
			field('textarea', 'Message', true, { maxLength: 5000 }),
		],
		settings: { ...DEFAULT_SETTINGS },
	};
}
