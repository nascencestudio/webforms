/// <reference path="../virtual.d.ts" />
/**
 * `GET /_webforms/challenge?form=<id>`: a fresh proof-of-work challenge for a form (ADR 0001 §4). Anyone
 * may ask (visitors fill the forms); a challenge is only signed data, nothing is stored until it's used.
 */
import config from 'virtual:webforms/config';
import type { APIRoute } from 'astro';
import { FORM_ID } from '../forms.js';
import { issueChallenge } from '../protect.js';
import { webformsKey } from './secret.js';

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const formId = context.url.searchParams.get('form') ?? '';
	if (!FORM_ID.test(formId)) return new Response('Not found', { status: 404 });
	const { salt, difficulty, token } = issueChallenge(webformsKey(), formId, Date.now(), config.difficulty);
	return new Response(JSON.stringify({ salt, difficulty, token }), {
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
	});
};
