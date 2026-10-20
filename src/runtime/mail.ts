/// <reference types="studiocms/v/types" />
/**
 * Sending a submission by email through StudioCMS's mailer (Dashboard → SMTP Configuration), ADR 0001 §5:
 * plain text, visitor input never in a header (the subject is the form's own text, one line), the
 * visitor's address in the body. Returns what happened; never throws. Server only.
 */
import { Mailer } from 'studiocms:mailer';
import { Effect, runEffect } from 'studiocms/effect';
import type { MailStatus } from './store.js';

/** Whether StudioCMS's mailer is set up and turned on (for the dashboard's notice). */
export async function mailEnabled(): Promise<boolean> {
	try {
		return await runEffect(
			Effect.gen(function* () {
				const mailer = yield* Mailer;
				return yield* mailer.isEnabled;
			}).pipe(Mailer.Provide),
		);
	} catch {
		return false;
	}
}

export async function sendSubmission(message: { to: string[]; subject: string; text: string }): Promise<MailStatus> {
	if (message.to.length === 0) return 'no-recipients';
	try {
		return await runEffect(
			Effect.gen(function* () {
				const mailer = yield* Mailer;
				if (!(yield* mailer.isEnabled)) return 'off' as const;
				const result = yield* mailer.sendMail({ to: message.to, subject: message.subject, text: message.text });
				return 'error' in result ? ('failed' as const) : ('sent' as const);
			}).pipe(Mailer.Provide),
		);
	} catch (error) {
		console.error('[webforms] sending the submission failed', error);
		return 'failed';
	}
}
