import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/csv.js';
import { DEFAULT_SETTINGS, type Form } from '../src/forms.js';

describe('CSV export', () => {
	it('neutralises formulas and quotes what needs quoting', () => {
		expect(csvCell('=HYPERLINK("http://evil","click")')).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
		for (const start of ['+1+1', '-2', '@SUM(A1)', '\tx', '\rx'])
			expect(csvCell(start).startsWith("'") || csvCell(start).startsWith('"\'')).toBe(true);
		expect(csvCell('plain')).toBe('plain');
		expect(csvCell('a, b')).toBe('"a, b"');
		expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
		expect(csvCell('-')).toBe("'-");
	});

	it('writes a header and one line per submission', () => {
		const form: Form = {
			id: 'wf_aaaaaaaaaaaaaaaa',
			name: 'Contact',
			settings: DEFAULT_SETTINGS,
			fields: [
				{ id: 'fd_0000000001', type: 'text', label: 'Name', help: '', required: true, maxLength: 100 },
				{ id: 'fd_0000000002', type: 'markup', label: '', help: 'Note', required: false },
				{ id: 'fd_0000000003', type: 'checkboxes', label: 'Topics', help: '', required: false, options: ['A', 'B'] },
			],
		};
		const csv = toCsv(form, [
			{
				createdAt: '2026-10-20T10:00:00.000Z',
				status: 'Sent',
				values: { fd_0000000001: '=1+1', fd_0000000003: ['A', 'B'] },
			},
			{ createdAt: '2026-10-20T11:00:00.000Z', status: 'Spam', values: {} },
		]);
		expect(csv).toBe(
			"﻿Submitted (UTC),Status,Name,Topics\r\n2026-10-20T10:00:00.000Z,Sent,'=1+1,A; B\r\n2026-10-20T11:00:00.000Z,Spam,,\r\n",
		);
	});
});
