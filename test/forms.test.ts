import { describe, expect, it } from 'vitest';
import {
	contactForm,
	DEFAULT_SETTINGS,
	emailBody,
	type Field,
	type Form,
	isEmail,
	isPhone,
	LIMITS,
	linkCount,
	multiLine,
	parseField,
	parseForm,
	parseSettings,
	subjectFor,
	validateSubmission,
} from '../src/forms.js';

let n = 0;
const fid = () => `fd_${String(n++).padStart(10, '0')}`;
const field = (type: Field['type'], extra: Partial<Field> = {}): Field => ({
	id: fid(),
	type,
	label: `${type} field`,
	help: '',
	required: false,
	...extra,
});
const FORM_ID = 'wf_aaaaaaaaaaaaaaaa';
const form = (fields: Field[], settings = DEFAULT_SETTINGS): Form => ({
	id: FORM_ID,
	name: 'Contact',
	fields,
	settings,
});
const posted = (values: Record<string, string | string[]>) => (name: string) => [values[name] ?? []].flat();

describe('form definitions', () => {
	it('keep a valid form', () => {
		const f = form([
			field('text', { required: true, maxLength: 80 }),
			field('select', { options: ['A', 'B'] }),
			field('markup', { label: '', help: 'Line one\nLine two' }),
		]);
		expect(parseForm(JSON.parse(JSON.stringify(f)))).toEqual(f);
	});

	it('drop invalid fields and clean the rest', () => {
		const parsed = parseForm({
			id: FORM_ID,
			name: '  Contact\nus ',
			extra: 'x',
			fields: [
				{ id: 'bad', type: 'text', label: 'x' },
				{ ...field('text'), type: 'html' },
				{ ...field('text'), label: '' },
				{ ...field('select'), options: [] },
				{ ...field('radio'), options: [' A ', 'A', 'B\nC', ''] },
				{ ...field('text'), maxLength: 99_999, required: 'yes' },
				{ ...field('markup'), required: true, help: '' },
			],
		});
		expect(parsed?.name).toBe('Contact us');
		expect(parsed?.fields.map((f) => [f.type, f.options ?? f.maxLength, f.required])).toEqual([
			['radio', ['A', 'B C'], false],
			['text', 200, false],
		]);
		expect(parseForm({ id: 'wf_x', name: 'x', fields: [] })).toBeNull();
		expect(parseForm({ id: FORM_ID, name: ' ', fields: [] })).toBeNull();
		expect(parseField({ ...field('textarea'), maxLength: 20_000 })?.maxLength).toBe(5000);
	});

	it('clean settings: recipients, redirect, retention', () => {
		const settings = parseSettings({
			recipients: ['Owner@Example.com', 'owner@example.com', 'not an email', 'a@b', 'x@y.z\nBcc: evil@example.com'],
			subject: 'New\r\nBcc: evil@example.com',
			redirect: '//evil.example',
			retentionDays: 0,
			keep: false,
		});
		expect(settings.recipients).toEqual(['owner@example.com']);
		expect(settings.subject).toBe('New Bcc: evil@example.com');
		expect(settings.redirect).toBe('');
		expect(settings.retentionDays).toBe(90);
		expect(settings.keep).toBe(false);
		expect(parseSettings({ redirect: '/thanks' }).redirect).toBe('/thanks');
		expect(parseSettings({ redirect: 'javascript:alert(1)' }).redirect).toBe('');
		expect(
			parseSettings({ recipients: Array.from({ length: 20 }, (_, i) => `p${i}@example.com`) }).recipients,
		).toHaveLength(10);
	});

	it('know email addresses and phone numbers', () => {
		for (const ok of ['a@example.com', 'first.last+tag@sub.example.co.uk', 'x@xn--bcher-kva.example'])
			expect(isEmail(ok), ok).toBe(true);
		for (const bad of [
			'a@b',
			'a b@example.com',
			'a@example.com\n',
			'<a@example.com>',
			'a@-example.com',
			'@example.com',
			`${'a'.repeat(65)}@example.com`,
		]) {
			expect(isEmail(bad), bad).toBe(false);
		}
		expect(isPhone('+1 (604) 555-0100')).toBe(true);
		expect(isPhone('12345')).toBe(false);
		expect(isPhone('555-CALL-NOW')).toBe(false);
	});
});

describe('submissions', () => {
	const name = field('text', { required: true, maxLength: 10 });
	const email = field('email', { required: true });
	const phone = field('phone');
	const message = field('textarea', { maxLength: 20 });
	const topic = field('select', { options: ['Sales', 'Support'] });
	const size = field('radio', { options: ['S', 'M'] });
	const extras = field('checkboxes', { options: ['Newsletter', 'Call me'] });
	const consent = field('checkbox', { required: true });
	const note = field('markup', { label: '', help: 'Read this' });
	const f = form([name, email, phone, message, topic, size, extras, consent, note]);

	it('keep valid values by field id and find the reply address', () => {
		const result = validateSubmission(
			f,
			posted({
				[name.id]: '  Ada  ',
				[email.id]: 'ada@example.com',
				[phone.id]: '+44 20 7946 0000',
				[message.id]: 'Hi\r\nthere  ',
				[topic.id]: 'Support',
				[extras.id]: ['Newsletter', 'Newsletter'],
				[consent.id]: 'yes',
				unknown: 'dropped',
				[note.id]: 'ignored',
			}),
		);
		expect(result.errors).toEqual({});
		expect(result.replyTo).toBe('ada@example.com');
		expect(result.values).toEqual({
			[name.id]: 'Ada',
			[email.id]: 'ada@example.com',
			[phone.id]: '+44 20 7946 0000',
			[message.id]: 'Hi\nthere',
			[topic.id]: 'Support',
			[extras.id]: ['Newsletter'],
			[consent.id]: 'yes',
		});
	});

	it('explain what’s wrong', () => {
		const result = validateSubmission(
			f,
			posted({
				[name.id]: 'A name that is far too long',
				[email.id]: 'ada@example.com\r\nBcc: evil@example.com',
				[phone.id]: 'call me',
				[message.id]: 'x'.repeat(21),
				[topic.id]: 'Hacking',
				[size.id]: 'XL',
				[extras.id]: ['Newsletter', 'Free money'],
			}),
		);
		expect(Object.keys(result.errors).sort()).toEqual(
			[name.id, email.id, phone.id, message.id, topic.id, size.id, extras.id, consent.id].sort(),
		);
		expect(result.errors[consent.id]).toBe('Please tick this box.');
		expect(result.replyTo).toBeNull();
	});

	it('require required fields', () => {
		const result = validateSubmission(f, posted({}));
		expect(Object.keys(result.errors).sort()).toEqual([name.id, email.id, consent.id].sort());
	});

	it('cap and clean whatever is posted', () => {
		const result = validateSubmission(form([field('textarea', { maxLength: 10_000 })]), () => [
			`a\u0000b\u0007c${'z'.repeat(20_000)}`,
		]);
		const value = Object.values(result.values)[0] as string;
		expect(value.startsWith('abc')).toBe(true);
		expect(value.length).toBe(LIMITS.textareaMax);
		expect(multiLine('a\u001bb', 10)).toBe('ab');
	});
});

describe('email', () => {
	it('lists the answers in order, with a reply address, in plain text', () => {
		let call = 0;
		const f = contactForm((len) => new Uint8Array(len).map((_, i) => i * 7 + call++));
		expect(new Set(f.fields.map((x) => x.id)).size).toBe(4);
		const [nameF, emailF, , messageF] = f.fields as Field[];
		const values = {
			[nameF?.id as string]: 'Ada',
			[emailF?.id as string]: 'ada@example.com',
			[messageF?.id as string]: 'Hello\nthere',
		};
		const body = emailBody(f, values, { replyTo: 'ada@example.com', when: '2026-10-20 10:00 UTC', page: '/contact' });
		expect(body).toBe(
			[
				'Name:',
				'Ada',
				'',
				'Email:',
				'ada@example.com',
				'',
				'Phone:',
				'(empty)',
				'',
				'Message:',
				'Hello\nthere',
				'',
				'—',
				'Form: Contact',
				'Sent: 2026-10-20 10:00 UTC',
				'Page: /contact',
				'Reply to: ada@example.com',
			].join('\n'),
		);
		expect(subjectFor(f)).toBe('New message from your website: Contact');
		expect(subjectFor({ ...f, name: 'Evil\nBcc: x' })).not.toMatch(/\n/);
	});

	it('counts links for the spam heuristic', () => {
		expect(linkCount({ a: 'see https://a.example and http://b.example', b: ['www.c.example', '[url=x]'] })).toBe(4);
		expect(linkCount({ a: 'no links here' })).toBe(0);
	});
});
