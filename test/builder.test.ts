import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyAction, newForm } from '../src/builder.js';
import { DEFAULT_SETTINGS, type Form, LIMITS } from '../src/forms.js';

const random = (n: number) => new Uint8Array(randomBytes(n));
const fd = (fields: Record<string, string>) => {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.append(k, v);
	return data;
};
const base = (): Form => {
	const created = newForm('Contact', random);
	if ('error' in created) throw new Error(created.error);
	return created.form;
};
const apply = (form: Form, fields: Record<string, string>) => {
	const result = applyAction(form, fd(fields), random);
	if ('error' in result) throw new Error(result.error);
	return result.form;
};

describe('the form builder', () => {
	it('creates a form with default settings', () => {
		const form = base();
		expect(form).toMatchObject({ name: 'Contact', fields: [], settings: DEFAULT_SETTINGS });
		expect(form.id).toMatch(/^wf_[a-z0-9]{16}$/);
		expect(newForm('  ', random)).toEqual({ error: 'name-required' });
	});

	it('adds, edits, moves and removes fields', () => {
		let form = apply(base(), { action: 'add-field', type: 'text', label: 'Name', required: 'on', maxLength: '80' });
		form = apply(form, { action: 'add-field', type: 'select', label: 'Topic', options: 'Sales\n\nSupport\nSales' });
		form = apply(form, { action: 'add-field', type: 'markup', help: 'We reply within a day.' });
		expect(form.fields.map((f) => [f.type, f.label, f.required, f.maxLength ?? f.options ?? f.help])).toEqual([
			['text', 'Name', true, 80],
			['select', 'Topic', false, ['Sales', 'Support']],
			['markup', '', false, 'We reply within a day.'],
		]);
		const [name, topic] = form.fields;
		form = apply(form, {
			action: 'edit-field',
			field: name?.id as string,
			type: 'text',
			label: 'Your name',
			maxLength: '40',
		});
		expect(form.fields[0]).toMatchObject({ id: name?.id, label: 'Your name', required: false, maxLength: 40 });
		form = apply(form, { action: 'move-up', field: topic?.id as string });
		expect(form.fields.map((f) => f.label)).toEqual(['Topic', 'Your name', '']);
		form = apply(form, { action: 'move-up', field: topic?.id as string });
		expect(form.fields[0]?.label).toBe('Topic');
		form = apply(form, { action: 'remove-field', field: topic?.id as string });
		expect(form.fields.map((f) => f.label)).toEqual(['Your name', '']);
	});

	it('explains what’s missing', () => {
		const form = base();
		const err = (fields: Record<string, string>) => applyAction(form, fd(fields), random);
		expect(err({ action: 'add-field', type: 'text', label: ' ' })).toEqual({ error: 'label-required' });
		expect(err({ action: 'add-field', type: 'radio', label: 'Size', options: '\n' })).toEqual({
			error: 'options-required',
		});
		expect(err({ action: 'add-field', type: 'markup', help: '' })).toEqual({ error: 'text-required' });
		expect(err({ action: 'add-field', type: 'script', label: 'x' })).toEqual({ error: 'unknown' });
		expect(err({ action: 'edit-field', field: 'fd_nope000000', type: 'text', label: 'x' })).toEqual({
			error: 'no-such-field',
		});
		expect(err({ action: 'rename', name: '' })).toEqual({ error: 'name-required' });
		expect(err({ action: 'explode' })).toEqual({ error: 'unknown' });
		let full = form;
		for (let i = 0; i < LIMITS.fields; i++) full = apply(full, { action: 'add-field', type: 'text', label: `F${i}` });
		expect(applyAction(full, fd({ action: 'add-field', type: 'text', label: 'One more' }), random)).toEqual({
			error: 'too-many-fields',
		});
	});

	it('saves settings and refuses bad ones', () => {
		const ok = {
			action: 'settings',
			recipients: 'Owner@Example.com\nsales@example.com, owner@example.com',
			subject: 'Hi {form}',
			thankYou: 'Thanks!',
			redirect: '/thanks',
			keep: 'on',
			retentionDays: '30',
		};
		expect(apply(base(), ok).settings).toEqual({
			recipients: ['owner@example.com', 'sales@example.com'],
			subject: 'Hi {form}',
			thankYou: 'Thanks!',
			redirect: '/thanks',
			keep: true,
			retentionDays: 30,
		});
		const form = base();
		expect(applyAction(form, fd({ ...ok, recipients: 'owner@example.com\nnot-an-email' }), random)).toEqual({
			error: 'bad-recipient',
		});
		expect(
			applyAction(
				form,
				fd({ ...ok, recipients: Array.from({ length: 11 }, (_, i) => `p${i}@example.com`).join('\n') }),
				random,
			),
		).toEqual({
			error: 'too-many-recipients',
		});
		expect(applyAction(form, fd({ ...ok, redirect: 'https://evil.example' }), random)).toEqual({
			error: 'bad-redirect',
		});
		expect(applyAction(form, fd({ ...ok, retentionDays: '0' }), random)).toEqual({ error: 'bad-retention' });
		expect(apply(form, { ...ok, keep: '' }).settings.keep).toBe(false);
	});
});
