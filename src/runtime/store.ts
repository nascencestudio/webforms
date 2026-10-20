/// <reference types="studiocms/v/types" />
/**
 * Webforms' storage (ADR 0001 §7): rows in StudioCMS's plugin data table, re-validated on read.
 * - forms: `…webforms-form:<wf_id>`
 * - submissions: `…webforms-sub:<wf_id>:<time, 13 digits>:<random>` (listed per form, newest last)
 * - used proof-of-work challenges: `…webforms-pow:<salt>` until they expire (single use)
 * - state: the Contact form created once, the last cleanup.
 * Expired submissions and challenges are removed lazily, at most once an hour (StudioCMS has no cron).
 * Straight through the SDK's database client (`usePluginData()` can't save in StudioCMS 0.6.1). Server only.
 */
import { randomBytes } from 'node:crypto';
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import { contactForm, FORM_ID, type Form, parseForm, type Values } from '../forms.js';

const P = '@nascencestudio/webforms';
const FORM = `${P}-form:`;
const SUB = `${P}-sub:`;
const POW = `${P}-pow:`;
const STATE_ROW = `${P}-state`;
const CLEANUP_MS = 3_600_000;

export const random = (n: number) => new Uint8Array(randomBytes(n));
const db = () => SDKCoreJs.dbService.db;

const parseJson = (data: string): unknown => {
	try {
		return JSON.parse(data) as unknown;
	} catch {
		return null;
	}
};

async function rowsWithPrefix(prefix: string) {
	return db()
		.selectFrom('StudioCMSPluginData')
		.select(['id', 'data'])
		.where('id', '>=', prefix)
		.where('id', '<', `${prefix}￿`)
		.execute();
}

async function readRow(id: string): Promise<unknown> {
	const row = await db().selectFrom('StudioCMSPluginData').select('data').where('id', '=', id).executeTakeFirst();
	return row ? parseJson(row.data) : null;
}

async function writeRow(id: string, value: unknown, options: { onlyNew?: boolean } = {}): Promise<boolean> {
	const data = JSON.stringify(value);
	return db()
		.transaction()
		.execute(async (trx) => {
			const existing = await trx.selectFrom('StudioCMSPluginData').select('id').where('id', '=', id).executeTakeFirst();
			if (existing && options.onlyNew) return false;
			if (existing) await trx.updateTable('StudioCMSPluginData').set({ data }).where('id', '=', id).execute();
			else await trx.insertInto('StudioCMSPluginData').values({ id, data }).execute();
			return true;
		});
}

async function deleteRows(ids: readonly string[]) {
	if (ids.length) await db().deleteFrom('StudioCMSPluginData').where('id', 'in', ids).execute();
}

const touched = () => runSDK(SDKCoreJs.PLUGINS.clearPluginDataCache()).catch(() => {});

// --- Forms -----------------------------------------------------------------------------------------

export async function listForms(): Promise<Form[]> {
	return (await rowsWithPrefix(FORM))
		.map((row) => parseForm(parseJson(row.data)))
		.filter((f): f is Form => f !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadForm(id: unknown): Promise<Form | null> {
	if (typeof id !== 'string' || !FORM_ID.test(id)) return null;
	return parseForm(await readRow(`${FORM}${id}`));
}

export async function saveForm(form: Form): Promise<void> {
	const clean = parseForm(form);
	if (!clean) throw new Error('invalid form');
	await writeRow(`${FORM}${clean.id}`, clean);
	await touched();
}

/** Delete a form and its submissions. */
export async function deleteForm(id: string): Promise<void> {
	if (!FORM_ID.test(id)) return;
	const subs = (await rowsWithPrefix(`${SUB}${id}:`)).map((r) => r.id);
	await deleteRows([`${FORM}${id}`, ...subs]);
	await touched();
}

/**
 * Create the Contact form once, on a site without forms (ADR 0001 §2). A state row records it, so
 * deleting every form later doesn't bring it back.
 */
export async function ensureContactForm(): Promise<void> {
	try {
		const state = ((await readRow(STATE_ROW)) ?? {}) as Record<string, unknown>;
		if (state.contactForm) return;
		if ((await rowsWithPrefix(FORM)).length === 0) await saveForm(contactForm(random));
		await writeRow(STATE_ROW, { ...state, contactForm: true });
	} catch (error) {
		console.warn('[webforms] could not set up the Contact form', error);
	}
}

// --- Submissions -----------------------------------------------------------------------------------

export type MailStatus = 'sent' | 'failed' | 'off' | 'no-recipients' | 'skipped';

export interface Submission {
	id: string;
	formId: string;
	/** ISO time. */
	createdAt: string;
	values: Values;
	/** Why it was judged spam (empty: not spam). */
	spam: string[];
	mail: MailStatus;
	/** The page it was sent from (a path). */
	page: string;
	/** The visitor's email, for replying. */
	replyTo: string | null;
}

const SUB_ID = /^wf_[a-z0-9]{16}:\d{13}:[a-z0-9]{8}$/;

function parseSubmission(id: string, raw: unknown): Submission | null {
	if (!SUB_ID.test(id) || !raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const values: Values = {};
	if (r.values && typeof r.values === 'object') {
		for (const [k, v] of Object.entries(r.values as Record<string, unknown>)) {
			if (!/^fd_[a-z0-9]{10}$/.test(k)) continue;
			if (typeof v === 'string') values[k] = v;
			else if (Array.isArray(v)) values[k] = v.filter((x): x is string => typeof x === 'string');
		}
	}
	const MAIL: MailStatus[] = ['sent', 'failed', 'off', 'no-recipients', 'skipped'];
	return {
		id,
		formId: id.slice(0, 19),
		createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(Number(id.slice(20, 33))).toISOString(),
		values,
		spam: Array.isArray(r.spam) ? r.spam.filter((x): x is string => typeof x === 'string').slice(0, 10) : [],
		mail: MAIL.includes(r.mail as MailStatus) ? (r.mail as MailStatus) : 'skipped',
		page: typeof r.page === 'string' ? r.page.slice(0, 300) : '',
		replyTo: typeof r.replyTo === 'string' ? r.replyTo.slice(0, 254) : null,
	};
}

export async function addSubmission(
	input: Omit<Submission, 'id' | 'createdAt'>,
	now = Date.now(),
): Promise<Submission> {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const suffix = [...randomBytes(8)].map((b) => alphabet[b % 36]).join('');
	const id = `${input.formId}:${String(Math.floor(now)).padStart(13, '0')}:${suffix}`;
	const submission: Submission = { ...input, id, createdAt: new Date(now).toISOString() };
	await writeRow(`${SUB}${id}`, submission);
	return submission;
}

export async function updateSubmission(submission: Submission): Promise<void> {
	await writeRow(`${SUB}${submission.id}`, submission);
}

/** A form's submissions, newest first. */
export async function listSubmissions(formId: string): Promise<Submission[]> {
	if (!FORM_ID.test(formId)) return [];
	return (await rowsWithPrefix(`${SUB}${formId}:`))
		.map((row) => parseSubmission(row.id.slice(SUB.length), parseJson(row.data)))
		.filter((s): s is Submission => s !== null)
		.reverse();
}

export async function loadSubmission(id: unknown): Promise<Submission | null> {
	if (typeof id !== 'string' || !SUB_ID.test(id)) return null;
	return parseSubmission(id, await readRow(`${SUB}${id}`));
}

export async function deleteSubmissions(ids: readonly string[]): Promise<void> {
	await deleteRows(ids.filter((id) => SUB_ID.test(id)).map((id) => `${SUB}${id}`));
}

/** Count per form: [all, spam]. */
export async function submissionCounts(): Promise<Map<string, { all: number; spam: number }>> {
	const counts = new Map<string, { all: number; spam: number }>();
	for (const row of await rowsWithPrefix(SUB)) {
		const formId = row.id.slice(SUB.length, SUB.length + 19);
		const entry = counts.get(formId) ?? { all: 0, spam: 0 };
		entry.all++;
		if ((parseJson(row.data) as { spam?: unknown[] } | null)?.spam?.length) entry.spam++;
		counts.set(formId, entry);
	}
	return counts;
}

// --- Single-use challenges -------------------------------------------------------------------------

/** Mark a challenge as used; false when it already was (a replay). */
export async function useChallenge(salt: string, expires: number): Promise<boolean> {
	return writeRow(`${POW}${salt}`, { expires }, { onlyNew: true });
}

// --- Cleanup ---------------------------------------------------------------------------------------

/** At most once an hour: submissions past their form's retention, used challenges past their expiry. */
export async function maybeCleanup(now = Date.now()): Promise<void> {
	try {
		const state = ((await readRow(STATE_ROW)) ?? {}) as Record<string, unknown>;
		if (typeof state.lastCleanup === 'number' && now - state.lastCleanup < CLEANUP_MS) return;
		await writeRow(STATE_ROW, { ...state, lastCleanup: now });
		const retention = new Map((await listForms()).map((f) => [f.id, f.settings.retentionDays * 86_400_000]));
		const stale: string[] = [];
		for (const row of await rowsWithPrefix(SUB)) {
			const id = row.id.slice(SUB.length);
			const formId = id.slice(0, 19);
			const time = Number(id.slice(20, 33));
			const keep = retention.get(formId);
			if (keep === undefined || now - time > keep) stale.push(row.id);
		}
		for (const row of await rowsWithPrefix(POW)) {
			const expires = (parseJson(row.data) as { expires?: unknown } | null)?.expires;
			if (typeof expires !== 'number' || expires < now) stale.push(row.id);
		}
		await deleteRows(stale);
	} catch (error) {
		console.warn('[webforms] cleanup failed', error);
	}
}
