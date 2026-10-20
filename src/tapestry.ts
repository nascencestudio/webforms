/**
 * `@nascencestudio/webforms/tapestry`: a Webform component for Tapestry's library (ADR 0001 §1), so a form
 * can go in pages, templates, headers and footers. The form is chosen from the site's forms (a select
 * filled from `/_webforms/options`, Tapestry ADR 0042). Needs Tapestry 0.6 or later.
 *
 * @example
 * ```js
 * import { webformComponents } from '@nascencestudio/webforms/tapestry';
 * tapestry({ components: [...components, ...webformComponents()] })
 * ```
 */
import { type ComponentDefinition, defineComponent } from '@nascencestudio/tapestry';

export const WEBFORM_TYPE = 'tapestry-webform';

export function webformComponents(options: { category?: string } = {}): ComponentDefinition[] {
	return [
		defineComponent({
			type: WEBFORM_TYPE,
			label: 'Webform',
			description: 'A form built in Dashboard → Webforms (contact, quote request…).',
			category: options.category ?? 'Forms',
			component: new URL('./runtime/Webform.astro', import.meta.url).href,
			thumbnail: new URL('./thumbnails/webform.svg', import.meta.url).href,
			props: {
				form: {
					type: 'select',
					label: 'Form',
					description: 'Forms are built in Dashboard → Webforms.',
					options: [],
					optionsUrl: '/_webforms/options',
				},
			},
		}),
	];
}
