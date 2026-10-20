// Webforms' build-time modules (written by the plugin from its options and what's installed).
declare module 'virtual:webforms/config' {
	const config: {
		/** Proof-of-work difficulty (leading zero bits). */
		difficulty: number;
		/** Submissions with more links than this are kept as spam. */
		maxLinks: number;
		/** The dashboard page (after the dashboard's base path). */
		dashboardPage: string;
	};
	export default config;
}

/** IP Guard's checks when @nascencestudio/ipguard is installed, else null (ADR 0001 §1). */
declare module 'virtual:webforms/ipguard' {
	export const guard: null | {
		checkAction(
			context: { request: Request; clientAddress?: string },
			options: { key: string },
		): Promise<{ outcome: 'allow' | 'refuse'; message: string }>;
		recordAttempt(context: { request: Request; clientAddress?: string }): Promise<void>;
	};
}
