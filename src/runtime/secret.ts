/**
 * The key webforms signs its tokens with, derived from the site's `CMS_ENCRYPTION_KEY` (StudioCMS
 * requires it). Without one, a random key per server start is used (tokens then don't survive a
 * restart) and a warning is logged. Server only.
 */
import { randomBytes } from 'node:crypto';
import { signingKey } from '../protect.js';

let key: Buffer | null = null;

export function webformsKey(): Buffer {
	if (key) return key;
	const secret = process.env.CMS_ENCRYPTION_KEY;
	if (!secret)
		console.warn('[webforms] CMS_ENCRYPTION_KEY is not set: using a temporary key (forms reload after a restart).');
	key = signingKey(secret || randomBytes(32).toString('hex'));
	return key;
}
