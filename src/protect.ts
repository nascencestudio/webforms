/**
 * Spam checks that need no third party (ADR 0001 §4): a signed form token (when the form was shown, so
 * too-fast and too-old submissions stand out) and a proof of work (the browser finds a number whose
 * SHA-256 with a signed, expiring challenge starts with enough zero bits; checking takes one hash).
 * Tokens are signed with HMAC-SHA-256 under a key derived from the site's secret; nothing is stored until
 * a challenge is used (single use is enforced by the caller). Server only (node:crypto).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Submissions sooner than this after the form was shown look automated. */
export const MIN_FILL_MS = 3000;
/** A form older than this must be reloaded. */
export const MAX_FORM_AGE_MS = 24 * 3600 * 1000;
/** A challenge must be solved and submitted within this time. */
export const CHALLENGE_TTL_MS = 15 * 60 * 1000;
/** Default leading zero bits: about 130,000 hashes on average, roughly a second in a browser. */
export const DEFAULT_DIFFICULTY = 17;

/** A signing key for webforms, derived from the site's secret (so it differs from other uses). */
export function signingKey(siteSecret: string): Buffer {
	return createHmac('sha256', siteSecret).update('nascencestudio/webforms v1').digest();
}

const sign = (key: Buffer, text: string) => createHmac('sha256', key).update(text).digest('base64url');

function sameSignature(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/** The form token, embedded when the form is rendered: `<issued ms>.<signature>`, bound to the form. */
export function formToken(key: Buffer, formId: string, now: number): string {
	const issued = String(Math.floor(now));
	return `${issued}.${sign(key, `form|${formId}|${issued}`)}`;
}

export type TimingCheck = 'ok' | 'invalid' | 'too-fast' | 'too-old';

export function checkFormToken(key: Buffer, formId: string, token: unknown, now: number): TimingCheck {
	if (typeof token !== 'string' || token.length > 100) return 'invalid';
	const match = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
	if (!match) return 'invalid';
	const [, issued = '', signature = ''] = match;
	if (!sameSignature(signature, sign(key, `form|${formId}|${issued}`))) return 'invalid';
	const age = now - Number(issued);
	if (age < MIN_FILL_MS) return 'too-fast';
	if (age > MAX_FORM_AGE_MS) return 'too-old';
	return 'ok';
}

export interface Challenge {
	/** Random, hex; part of what's hashed, and the key for single use. */
	salt: string;
	/** Leading zero bits required. */
	difficulty: number;
	/** ms. */
	expires: number;
	/** The whole challenge as one string, sent back with the answer. */
	token: string;
}

/** A new challenge for a form. */
export function issueChallenge(key: Buffer, formId: string, now: number, difficulty = DEFAULT_DIFFICULTY): Challenge {
	const salt = randomBytes(16).toString('hex');
	const expires = Math.floor(now + CHALLENGE_TTL_MS);
	const signature = sign(key, `pow|${formId}|${salt}|${difficulty}|${expires}`);
	return { salt, difficulty, expires, token: `${salt}.${difficulty}.${expires}.${signature}` };
}

/** Leading zero bits of a hash. */
export function leadingZeroBits(bytes: Uint8Array): number {
	let bits = 0;
	for (const byte of bytes) {
		if (byte === 0) {
			bits += 8;
			continue;
		}
		return bits + Math.clz32(byte) - 24;
	}
	return bits;
}

/** What's hashed for an answer (the browser hashes exactly this). */
export const powInput = (salt: string, nonce: string) => `${salt}:${nonce}`;

export type PowCheck =
	| { ok: true; salt: string; expires: number }
	| { ok: false; why: 'invalid' | 'expired' | 'wrong' };

/** Check an answer: a valid, unexpired challenge for this form, and a nonce meeting its difficulty. */
export function checkPow(key: Buffer, formId: string, token: unknown, nonce: unknown, now: number): PowCheck {
	if (typeof token !== 'string' || typeof nonce !== 'string' || token.length > 200)
		return { ok: false, why: 'invalid' };
	const match = /^([0-9a-f]{32})\.(\d{1,2})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
	if (!match || !/^\d{1,12}$/.test(nonce)) return { ok: false, why: 'invalid' };
	const [, salt = '', difficultyText = '', expiresText = '', signature = ''] = match;
	const difficulty = Number(difficultyText);
	if (!sameSignature(signature, sign(key, `pow|${formId}|${salt}|${difficulty}|${expiresText}`))) {
		return { ok: false, why: 'invalid' };
	}
	const expires = Number(expiresText);
	if (expires < now) return { ok: false, why: 'expired' };
	const hash = createHash('sha256').update(powInput(salt, nonce)).digest();
	if (leadingZeroBits(hash) < difficulty) return { ok: false, why: 'wrong' };
	return { ok: true, salt, expires };
}

/** Solve a challenge (tests and benchmarks; browsers use the client's Web Crypto version). */
export function solve(challenge: Pick<Challenge, 'salt' | 'difficulty'>): string {
	for (let nonce = 0; ; nonce++) {
		const hash = createHash('sha256')
			.update(powInput(challenge.salt, String(nonce)))
			.digest();
		if (leadingZeroBits(hash) >= challenge.difficulty) return String(nonce);
	}
}
