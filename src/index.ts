/**
 * @nascencestudio/webforms: forms for StudioCMS sites (ADR 0001).
 * - Dashboard → Webforms: admins build forms from fields; editors read and export submissions.
 * - `<Webform form="…" />` (`@nascencestudio/webforms/Webform.astro`), and a Webform component for
 *   Tapestry (`@nascencestudio/webforms/tapestry`; Tapestry is optional).
 * - Submissions are kept, then emailed through StudioCMS's mailer (Dashboard → SMTP Configuration).
 * - Spam is stopped in layers without third parties: a hidden field, a minimum fill time, a proof of work,
 *   IP Guard (`@nascencestudio/ipguard`, when installed) and a links limit.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { definePlugin } from 'studiocms/plugins';
import { DEFAULT_DIFFICULTY } from './protect.js';

export type { Field, FieldType, Form, FormSettings, Values } from './forms.js';
export { FIELD_TYPES, parseForm, validateSubmission } from './forms.js';

const PACKAGE_NAME = '@nascencestudio/webforms';
const IPGUARD = '@nascencestudio/ipguard/guard';
const CONFIG_MODULE = 'virtual:webforms/config';
const IPGUARD_MODULE = 'virtual:webforms/ipguard';
/** StudioCMS names a plugin page's address from its identifier (`/` and `-` become `_`). */
export const DASHBOARD_PAGE = 'nascencestudio_webforms/webforms';

export interface WebformsOptions {
	/** Proof-of-work difficulty in leading zero bits (12–22). Default 17: about a second in a browser. */
	difficulty?: number;
	/** Submissions with more links than this are kept as spam (default 3). */
	maxLinks?: number;
	/** Use IP Guard when it's installed (default true). */
	ipguard?: boolean;
}

export type WebformsPlugin = ReturnType<typeof definePlugin>;

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** IP Guard's guard module, resolved from the site (null when it isn't installed). */
function findIpGuard(root: string): string | null {
	try {
		return createRequire(`${root.replace(/\/?$/, '/')}package.json`).resolve(IPGUARD);
	} catch {
		return null;
	}
}

/**
 * The Webforms plugin.
 *
 * @example
 * ```js
 * // studiocms.config.mjs
 * import webforms from '@nascencestudio/webforms';
 * export default defineStudioCMSConfig({ plugins: [ipguard(), webforms()] });
 * ```
 */
export function webforms(options: WebformsOptions = {}): WebformsPlugin {
	const difficulty = options.difficulty ?? DEFAULT_DIFFICULTY;
	if (!Number.isInteger(difficulty) || difficulty < 12 || difficulty > 22) {
		throw new Error('[webforms] difficulty must be a whole number from 12 to 22.');
	}
	const maxLinks = options.maxLinks ?? 3;
	if (!Number.isInteger(maxLinks) || maxLinks < 0) throw new Error('[webforms] maxLinks must be a whole number ≥ 0.');
	return definePlugin({
		identifier: PACKAGE_NAME,
		name: 'Webforms',
		hooks: {
			'studiocms:astro-config': ({ addIntegrations }) => {
				addIntegrations({
					name: PACKAGE_NAME,
					hooks: {
						'astro:config:setup': ({ config, injectRoute, updateConfig, logger }) => {
							const routes: Array<[string, string]> = [
								['/_webforms/submit', './runtime/submit-endpoint.js'],
								['/_webforms/challenge', './runtime/challenge-endpoint.js'],
								['/_webforms/options', './runtime/options-endpoint.js'],
								['/_webforms/admin', './runtime/admin-endpoint.js'],
								['/_webforms/export', './runtime/export-endpoint.js'],
							];
							for (const [pattern, entrypoint] of routes) {
								injectRoute({ pattern, entrypoint: resolve(entrypoint), prerender: false });
							}
							const guardPath = options.ipguard === false ? null : findIpGuard(fileURLToPath(config.root));
							logger.info(guardPath ? 'IP Guard found: submissions are checked by it.' : 'IP Guard not installed.');
							const modules = new Map([
								[
									`\0${CONFIG_MODULE}`,
									`export default ${JSON.stringify({ difficulty, maxLinks, dashboardPage: DASHBOARD_PAGE })};`,
								],
								[
									`\0${IPGUARD_MODULE}`,
									guardPath
										? `import { checkAction, recordAttempt } from ${JSON.stringify(guardPath)};\nexport const guard = { checkAction, recordAttempt };\n`
										: 'export const guard = null;\n',
								],
							]);
							updateConfig({
								vite: {
									plugins: [
										{
											name: 'webforms:virtual-modules',
											resolveId: (id: string) => (modules.has(`\0${id}`) ? `\0${id}` : undefined),
											load: (id: string) => modules.get(id),
										},
									],
								},
							});
						},
					},
				});
			},
			'studiocms:dashboard': ({ setDashboard }) => {
				setDashboard({
					translations: { en: {} },
					// Editors read submissions; admins build forms (the endpoints check it again).
					dashboardPages: {
						user: [
							{
								title: { en: 'Webforms' },
								description: 'Forms and their submissions.',
								route: 'webforms',
								icon: 'heroicons:clipboard-document-list',
								sidebar: 'double',
								requiredPermissions: 'editor',
								innerSidebarComponent: resolve('./runtime/WebformsNav.astro'),
								pageBodyComponent: resolve('./runtime/WebformsPage.astro'),
							},
						],
					},
				});
			},
		},
	});
}

export default webforms;
