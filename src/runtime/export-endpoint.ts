/**
 * `GET /_webforms/export?form=<id>` (editors): a form's kept submissions as CSV (ADR 0001 §6; cells that
 * could run as spreadsheet formulas are neutralised, csv.ts). `&spam` includes spam.
 */
import type { APIRoute } from 'astro';
import { toCsv } from '../csv.js';
import { listSubmissions, loadForm } from './store.js';
import { getWebformsViewer } from './viewer.js';

export const prerender = false;

export const GET: APIRoute = async (context) => {
	if (!(await getWebformsViewer(context)).isEditor) return new Response('Editors only', { status: 403 });
	const form = await loadForm(context.url.searchParams.get('form'));
	if (!form) return new Response('Not found', { status: 404 });
	const withSpam = context.url.searchParams.has('spam');
	const rows = (await listSubmissions(form.id))
		.filter((s) => withSpam || s.spam.length === 0)
		.map((s) => ({
			createdAt: s.createdAt,
			status: s.spam.length ? 'Spam' : s.mail === 'sent' ? 'Emailed' : 'Kept',
			values: s.values,
		}));
	const name =
		form.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'form';
	return new Response(toCsv(form, rows), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${name}-submissions.csv"`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	});
};
