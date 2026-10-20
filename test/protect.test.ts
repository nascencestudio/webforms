import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	CHALLENGE_TTL_MS,
	checkFormToken,
	checkPow,
	formToken,
	issueChallenge,
	leadingZeroBits,
	MAX_FORM_AGE_MS,
	powInput,
	signingKey,
	solve,
} from '../src/protect.js';

const key = signingKey('site-secret-for-tests');
const other = signingKey('another-site');
const FORM = 'wf_aaaaaaaaaaaaaaaa';
const NOW = Date.parse('2026-10-20T12:00:00Z');

describe('the form token (timing)', () => {
	it('accepts a real fill, refuses too fast, too old, forged and for another form', () => {
		const token = formToken(key, FORM, NOW);
		expect(checkFormToken(key, FORM, token, NOW + 10_000)).toBe('ok');
		expect(checkFormToken(key, FORM, token, NOW + 1000)).toBe('too-fast');
		expect(checkFormToken(key, FORM, token, NOW + MAX_FORM_AGE_MS + 1)).toBe('too-old');
		expect(checkFormToken(other, FORM, token, NOW + 10_000)).toBe('invalid');
		expect(checkFormToken(key, 'wf_bbbbbbbbbbbbbbbb', token, NOW + 10_000)).toBe('invalid');
		// Changing the time breaks the signature (a bot can't backdate it).
		const [, sig] = token.split('.');
		expect(checkFormToken(key, FORM, `${NOW - 60_000}.${sig}`, NOW + 10_000)).toBe('invalid');
		for (const bad of [undefined, '', 'x', `${'9'.repeat(200)}`, `${NOW}.short`])
			expect(checkFormToken(key, FORM, bad, NOW)).toBe('invalid');
	});
});

describe('the proof of work', () => {
	it('counts leading zero bits', () => {
		expect(leadingZeroBits(new Uint8Array([0, 0, 0x80]))).toBe(16);
		expect(leadingZeroBits(new Uint8Array([0, 0x01]))).toBe(15);
		expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
		expect(leadingZeroBits(new Uint8Array([0, 0]))).toBe(16);
	});

	it('accepts a solved challenge once checked, for its form, before it expires', () => {
		const challenge = issueChallenge(key, FORM, NOW, 8);
		const nonce = solve(challenge);
		const hash = createHash('sha256').update(powInput(challenge.salt, nonce)).digest();
		expect(leadingZeroBits(hash)).toBeGreaterThanOrEqual(8);
		expect(checkPow(key, FORM, challenge.token, nonce, NOW + 1000)).toEqual({
			ok: true,
			salt: challenge.salt,
			expires: challenge.expires,
		});
		expect(checkPow(key, FORM, challenge.token, nonce, NOW + CHALLENGE_TTL_MS + 1)).toEqual({
			ok: false,
			why: 'expired',
		});
		expect(checkPow(key, 'wf_bbbbbbbbbbbbbbbb', challenge.token, nonce, NOW)).toEqual({ ok: false, why: 'invalid' });
		expect(checkPow(other, FORM, challenge.token, nonce, NOW)).toEqual({ ok: false, why: 'invalid' });
	});

	it('refuses wrong answers and tampered challenges', () => {
		const challenge = issueChallenge(key, FORM, NOW, 12);
		const nonce = solve(challenge);
		let wrong = 0;
		while (true) {
			const hash = createHash('sha256')
				.update(powInput(challenge.salt, String(wrong)))
				.digest();
			if (leadingZeroBits(hash) < 12) break;
			wrong++;
		}
		expect(checkPow(key, FORM, challenge.token, String(wrong), NOW)).toEqual({ ok: false, why: 'wrong' });
		// Lowering the difficulty or extending the expiry breaks the signature.
		const [salt, , expires, sig] = challenge.token.split('.');
		expect(checkPow(key, FORM, `${salt}.1.${expires}.${sig}`, nonce, NOW)).toEqual({ ok: false, why: 'invalid' });
		expect(checkPow(key, FORM, `${salt}.12.${Number(expires) + 9e9}.${sig}`, nonce, NOW)).toEqual({
			ok: false,
			why: 'invalid',
		});
		for (const [t, n] of [
			[challenge.token, '-1'],
			[challenge.token, '1e5'],
			[challenge.token, '9'.repeat(13)],
			['garbage', nonce],
			[undefined, nonce],
		]) {
			expect(checkPow(key, FORM, t, n, NOW).ok).toBe(false);
		}
	});

	it('makes each challenge different', () => {
		expect(issueChallenge(key, FORM, NOW).salt).not.toBe(issueChallenge(key, FORM, NOW).salt);
	});
});
