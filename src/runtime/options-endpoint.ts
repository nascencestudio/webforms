/**
 * `GET /_webforms/options` (editors): the forms as choices for Tapestry's Webform component
 * (`{ options: [{ value, label }] }`, Tapestry ADR 0042).
 */
import type { APIRoute } from 'astro';
import { ensureContactForm, listForms } from './store.js';
import { getWebformsViewer } from './viewer.js';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
	});

export const GET: APIRoute = async (context) => {
	if (!(await getWebformsViewer(context)).isEditor) return json({ error: 'Editors only' }, 403);
	await ensureContactForm();
	return json({ options: (await listForms()).map((f) => ({ value: f.id, label: f.name })) });
};
