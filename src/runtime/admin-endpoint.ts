/// <reference types="studiocms/v/types" />
/**
 * `POST /_webforms/admin`: Dashboard → Webforms' forms (ADR 0001 §2, §6). Admins only, same origin.
 * Creating forms, the builder's actions (builder.ts), deleting a form (its name must be typed), and
 * marking or deleting submissions. Answers redirect back (`return`) with `saved` or `error=<code>`.
 */
import type { APIRoute } from 'astro';
import { applyAction, type BuilderError, newForm } from '../builder.js';
import {
	deleteForm,
	deleteSubmissions,
	loadForm,
	loadSubmission,
	random,
	saveForm,
	updateSubmission,
} from './store.js';
import { getWebformsViewer } from './viewer.js';

export const prerender = false;

const MAX_BODY = 64 * 1024;
const safeReturn = (value: unknown) =>
	typeof value === 'string' && /^\/(?!\/)[^\s\\]{0,500}$/.test(value) ? value : '/';

function redirect(back: string, outcome: { saved: true } | { error: BuilderError } | { to: string }) {
	if ('to' in outcome)
		return new Response(null, { status: 303, headers: { Location: outcome.to, 'Cache-Control': 'no-store' } });
	const url = new URL(back, 'http://x');
	url.searchParams.delete('saved');
	url.searchParams.delete('error');
	if ('saved' in outcome) url.searchParams.set('saved', '');
	else url.searchParams.set('error', outcome.error);
	return new Response(null, {
		status: 303,
		headers: { Location: `${url.pathname}${url.search}`, 'Cache-Control': 'no-store' },
	});
}

const subIds = (data: FormData) =>
	[...new Set(data.getAll('ids').filter((v): v is string => typeof v === 'string'))].slice(0, 500);

export const POST: APIRoute = async (context) => {
	if (context.request.headers.get('origin') !== context.url.origin)
		return new Response('Cross-origin request refused', { status: 403 });
	if (!(await getWebformsViewer(context)).isAdmin) return new Response('Admins only', { status: 403 });
	if (Number(context.request.headers.get('content-length') ?? 0) > MAX_BODY)
		return new Response('Too large', { status: 413 });
	let data: FormData;
	try {
		data = await context.request.formData();
	} catch {
		return new Response('Bad form', { status: 400 });
	}
	const back = safeReturn(data.get('return'));
	const action = data.get('action');

	try {
		if (action === 'create') {
			const created = newForm(data.get('name'), random);
			if ('error' in created) return redirect(back, created);
			await saveForm(created.form);
			const base = new URL(back, 'http://x').pathname;
			return redirect(back, { to: `${base}?form=${created.form.id}&saved` });
		}

		if (action === 'delete-form') {
			const form = await loadForm(data.get('form'));
			if (!form) return redirect(back, { error: 'no-such-form' });
			if (data.get('confirm') !== form.name) return redirect(back, { error: 'confirm-name' });
			await deleteForm(form.id);
			return redirect(back, { to: `${new URL(back, 'http://x').pathname}?saved` });
		}

		if (action === 'mark-spam' || action === 'mark-ok' || action === 'delete-submissions') {
			const ids = subIds(data);
			if (action === 'delete-submissions') {
				await deleteSubmissions(ids);
				return redirect(back, { saved: true });
			}
			for (const id of ids) {
				const submission = await loadSubmission(id);
				if (!submission) continue;
				const spam = action === 'mark-spam' ? (submission.spam.length ? submission.spam : ['marked']) : [];
				await updateSubmission({ ...submission, spam });
			}
			return redirect(back, { saved: true });
		}

		// The builder: rename, settings, fields.
		const form = await loadForm(data.get('form'));
		if (!form) return redirect(back, { error: 'no-such-form' });
		const result = applyAction(form, data, random);
		if ('error' in result) return redirect(back, result);
		await saveForm(result.form);
		return redirect(back, { saved: true });
	} catch (error) {
		console.error('[webforms] admin action failed', error);
		return redirect(back, { error: 'failed' });
	}
};
