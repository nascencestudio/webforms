# Devlog

Short log of this repository's sessions, newest first. The project-wide devlog (all sessions) is
in [tapestry-playground](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/devlog.md).

---

## 2026-11-24: 0.1.1, dependency refresh

- Dev dependencies: Tapestry 0.7.2, astro 7.4.13 (clears GHSA-mh32-jxcr-mh9f and GHSA-r3h5-4585-7x3w),
  biome 2.6.8 (Markdown/YAML formatting kept off), vitest 5.1.1, @types/node 22.20.5; `.nvmrc` 22.23.4
  (astro ≥ 7.4.7 needs it); actions/setup-node 7.1.0. IP Guard 0.1.0 is still current.
- minimatch GHSA-g3hv-75wg-m249 fixed (`@ts-morph/common` 0.29.1 → minimatch 11.0.9), ignore removed;
  braces still unpatched, re-check 2026-12-24. Dependabot ignores `@types/node` majors.
- Held: TypeScript 7.

## 2026-10-20: StudioCMS mail patch

**Request:** patches for Tapestry known issues #39 and #40, shipped with the plugin for sites to apply.

### Done
- `patches/studiocms@0.6.1.patch` and `@0.7.0.patch` (identical; the code is the same in both versions): the
  notifier logs a notification it can't send instead of failing the dashboard action; the SMTP settings
  handler updates saved settings and creates them only the first time. In `files`; CI's package check
  allows `patches/`. README: how to apply, and to use Tapestry's patch on Tapestry sites.
- Tested in the playground (its own StudioCMS patch carries the hunks) on a scratch site: the webforms suite
  with `E2E_MAIL_SINK=1` saves SMTP settings twice and creates a folder while SMTP points at a closed port.

---

## 2026-10-20: First version (0.1.0)

**Request:** a Drupal Webform-like form builder for StudioCMS sites with strong spam protection and no
Google CAPTCHA; mail through Brevo (one agency account, many domains). Defaults confirmed by the user;
our own proof of work instead of ALTCHA. [ADR 0001](decisions/0001-webforms.md).

### Done
- Pure core with 21 unit tests: form definitions and validation, timing tokens, the proof of work (forged,
  reused, expired, wrong form), CSV escaping, the builder's actions.
- Runtime: plugin data storage with lazy cleanup, the submit/challenge/options/admin/export endpoints,
  `Webform.astro` + a small client (Web Worker proof of work), the dashboard (forms, fields, settings,
  submissions), the Tapestry component, IP Guard through a build-time bridge.
- Playground: `webforms` suite (8 steps; 9 with `E2E_MAIL_SINK=1`, which sends a real email through
  StudioCMS's mailer to a test SMTP server) and every dashboard view plus the public form (empty, errors,
  sent) in the a11y audit, both themes. The audit caught radios/checkboxes below WCAG 2.2's target size.

### Learned
- StudioCMS's mailer writes quoted-printable; SMTP settings can be saved only once (Tapestry known issue
  #39); with mail on, a failed notification email fails dashboard saves (#40). README warns site builders.

### Next
- GitHub repo, npm versions of IP Guard and Tapestry in devDependencies, first release (after them).
