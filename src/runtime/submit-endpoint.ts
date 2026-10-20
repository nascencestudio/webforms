/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * `POST /_webforms/submit` (ADR 0001 §3–4): a visitor's submission. Same origin, 100 KB at most.
 * Checks, cheapest first: honeypot → form token (timing) → proof of work (single use) → IP Guard (when
 * installed) → the values against the form → links. Spam is kept and marked (not emailed) and answered
 * exactly like a success, so bots learn nothing; IP Guard's refusal shows its block message and stores
 * nothing. Valid submissions are stored first (when the form keeps them), then emailed.
 * With JavaScript the answer is JSON; without it, a redirect back to the page (`?webform=<id>&…`).
 */
import config from 'virtual:webforms/config';
import { guard } from 'virtual:webforms/ipguard';
import type { APIRoute } from 'astro';
import { emailBody, linkCount, subjectFor, validateSubmission } from '../forms.js';
import { checkFormToken, checkPow } from '../protect.js';
import { sendSubmission } from './mail.js';
import { webformsKey } from './secret.js';
import { addSubmission, loadForm, maybeCleanup, updateSubmission, useChallenge } from './store.js';

export const prerender = false;

const MAX_BODY = 100 * 1024;
export const HONEYPOT = 'website';

const safePage = (value: unknown) =>
	typeof value === 'string' && /^\/(?!\/)[^\s\\]{0,300}$/.test(value) ? value : '/';

export const POST: APIRoute = async (context) => {
	const wantsJson = (context.request.headers.get('accept') ?? '').includes('application/json');
	const reply = (status: number, body: Record<string, unknown>, page = '/', formId = '') => {
		if (wantsJson) {
			return new Response(JSON.stringify(body), {
				status,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
					'X-Content-Type-Options': 'nosniff',
				},
			});
		}
		const url = new URL(page, 'http://x');
		if (formId) {
			url.searchParams.set('webform', formId);
			url.searchParams.set('webform-status', body.ok ? 'sent' : status === 403 ? 'refused' : 'invalid');
		}
		const target =
			typeof body.redirect === 'string' && body.redirect
				? body.redirect
				: `${url.pathname}${url.search}#webform-${formId}`;
		return new Response(null, { status: 303, headers: { Location: target, 'Cache-Control': 'no-store' } });
	};

	if (context.request.headers.get('origin') !== context.url.origin)
		return reply(403, { ok: false, message: 'Refused.' });
	if (Number(context.request.headers.get('content-length') ?? 0) > MAX_BODY)
		return reply(413, { ok: false, message: 'Too large.' });
	let data: FormData;
	try {
		data = await context.request.formData();
	} catch {
		return reply(400, { ok: false, message: 'Not a form.' });
	}
	const form = await loadForm(data.get('_form'));
	const page = safePage(data.get('_page'));
	if (!form) return reply(404, { ok: false, message: 'This form no longer exists.' }, page);

	const now = Date.now();
	const key = webformsKey();
	const spam: string[] = [];
	const done = { ok: true, message: form.settings.thankYou, redirect: form.settings.redirect };

	// 1. Honeypot: a field people never see.
	if (String(data.get(HONEYPOT) ?? '') !== '') spam.push('honeypot');
	// 2. Timing.
	const timing = checkFormToken(key, form.id, data.get('_token'), now);
	if (timing === 'too-old')
		return reply(
			400,
			{ ok: false, message: 'This form has expired. Please reload the page and try again.' },
			page,
			form.id,
		);
	if (timing !== 'ok') spam.push(timing === 'too-fast' ? 'too-fast' : 'bad-token');
	// 3. Proof of work, single use.
	const pow = checkPow(key, form.id, data.get('_pow'), data.get('_nonce'), now);
	if (!data.get('_pow')) spam.push('no-proof');
	else if (!pow.ok) spam.push(`proof-${pow.why}`);
	else if (!(await useChallenge(pow.salt, pow.expires))) spam.push('proof-reused');

	if (spam.length > 0) {
		// Spam counts towards IP Guard's rate limit; it's kept (marked) when the form keeps submissions.
		await guard?.recordAttempt(context).catch(() => {});
		if (form.settings.keep) {
			const checked = validateSubmission(form, (name) =>
				data.getAll(name).filter((v): v is string => typeof v === 'string'),
			);
			await addSubmission({
				formId: form.id,
				values: checked.values,
				spam,
				mail: 'skipped',
				page,
				replyTo: checked.replyTo,
			});
		}
		await maybeCleanup(now);
		return reply(200, done, page, form.id);
	}

	// 4. IP Guard: lists, rate limit, AbuseIPDB.
	if (guard) {
		const verdict = await guard.checkAction(context, { key: `webform:${form.id}` });
		if (verdict.outcome === 'refuse') return reply(403, { ok: false, message: verdict.message }, page, form.id);
	}

	// 5. The values.
	const checked = validateSubmission(form, (name) =>
		data.getAll(name).filter((v): v is string => typeof v === 'string'),
	);
	if (Object.keys(checked.errors).length > 0) {
		return reply(
			400,
			{ ok: false, message: 'Please check the highlighted fields.', errors: checked.errors },
			page,
			form.id,
		);
	}
	// 6. Links.
	const reasons = linkCount(checked.values) > config.maxLinks ? ['links'] : [];

	let submission = form.settings.keep
		? await addSubmission(
				{ formId: form.id, values: checked.values, spam: reasons, mail: 'skipped', page, replyTo: checked.replyTo },
				now,
			)
		: null;
	if (reasons.length === 0) {
		const mail = await sendSubmission({
			to: form.settings.recipients,
			subject: subjectFor(form),
			text: emailBody(form, checked.values, {
				replyTo: checked.replyTo,
				when: `${new Date(now).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
				page,
			}),
		});
		if (submission) {
			submission = { ...submission, mail };
			await updateSubmission(submission);
		}
	}
	await maybeCleanup(now);
	return reply(200, done, page, form.id);
};
