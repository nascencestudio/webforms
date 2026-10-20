/**
 * Submissions as CSV (ADR 0001 §6). Values that start with `=`, `+`, `-`, `@`, a tab or a carriage return
 * get a leading apostrophe, so spreadsheets show them as text instead of running them as formulas (a
 * submitted "=HYPERLINK(...)" is a known way to attack whoever opens the export). Pure.
 */
import type { Form, Values } from './forms.js';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
	const safe = FORMULA_START.test(value) ? `'${value}` : value;
	return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export interface CsvRow {
	createdAt: string;
	status: string;
	values: Values;
}

/** One line per submission: the time, its status, then each field (multiple choices joined with "; "). */
export function toCsv(form: Form, rows: readonly CsvRow[]): string {
	const fields = form.fields.filter((f) => f.type !== 'markup');
	const header = ['Submitted (UTC)', 'Status', ...fields.map((f) => f.label)];
	const lines = rows.map((row) => [
		row.createdAt,
		row.status,
		...fields.map((f) => {
			const value = row.values[f.id];
			return Array.isArray(value) ? value.join('; ') : (value ?? '');
		}),
	]);
	// A byte order mark so spreadsheet programs read it as UTF-8; CRLF line endings (RFC 4180).
	return `﻿${[header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
