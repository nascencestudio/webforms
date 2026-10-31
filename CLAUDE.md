# CLAUDE.md: @nascencestudio/webforms

The source of truth for anyone (human or AI) working in this repo. Read it at the start of every
session and keep it current.

## What it is

Forms for StudioCMS sites ([ADR 0001](docs/decisions/0001-webforms.md)): Dashboard → Webforms (admins build
forms, editors read and export submissions), `<Webform form="…" />`, a Webform component for Tapestry
(`./tapestry`, optional), submissions stored then emailed through StudioCMS's mailer, spam stopped in layers
(honeypot, signed timing token, our own proof of work, IP Guard when installed, links limit). Mail goes out
through Brevo on port 587 (the user's agency account, one domain per client). Nascence Studio, MIT.

Sibling checkouts in `/Volumes/T7/www/`: `tapestry/`, `medialibrary/`, `tapestry-seo/`, `tapestry-menus/`,
`ipguard/`, `tapestry-playground/` (dev site and browser tests: `e2e/webforms.e2e.mjs`, webforms states in
`e2e/a11y.e2e.mjs`, the dev-only `src/pages/e2e/webform.astro`), and this repo. The devlog of record for the
whole project is the playground's; this repo has its own short one.

## Status

- **0.1.0 released 2026-10-31** (GitHub `nascencestudio/webforms`, npm with provenance), on Tapestry ≥ 0.7.0
  and IP Guard 0.1.0 (dev dependencies from npm). Releases: bump `version`, PR, merge, GitHub release
  `v<version>`, approve the staged version on npmjs.com (trusted publishing only; no tokens).

## Rules

1. **Security first.** pnpm only (never npm/npx/yarn; `pnpm view`). Hardening in `pnpm-workspace.yaml`
   with written reasons. Pin exact versions. No runtime dependencies (keep it that way, or write an ADR).
   `pnpm audit` must pass. No Meta libraries. No third-party CAPTCHA (user).
2. **Visitor input is hostile.** Every value is checked against the form's definition (`validateSubmission`)
   and capped; nothing a visitor types goes into an email header; CSV cells are neutralised; stored rows are
   re-validated on read (`parseForm`, `parseSubmission`).
3. **Spam answers look like success**; only IP Guard's refusal is visible. Don't add error messages that tell
   bots which check they failed.
4. **Document everything:** devlog entry each session; decisions as ADRs (`docs/decisions`, 0001+).
5. **Tests with every change**, adversarial for tokens, the proof of work and validation. UI changes: keep
   the playground's `webforms` and `a11y` suites passing.

## Layout

```
src/
├── index.ts          ← plugin: options (difficulty, maxLinks, ipguard), routes, virtual:webforms/config + /ipguard, dashboard page
├── forms.ts          ← Form/Field types, FIELD_TYPES, LIMITS, parseForm, validateSubmission, emailBody, subjectFor, linkCount, contactForm (pure)
├── protect.ts        ← signingKey, formToken/checkFormToken (timing), issueChallenge/checkPow/solve (proof of work) (pure)
├── builder.ts        ← dashboard actions as data: newForm, applyAction (add/edit/move/remove field, rename, settings) (pure)
├── csv.ts            ← CSV export with formula neutralising (pure)
├── tapestry.ts       ← `./tapestry`: webformComponents() (needs Tapestry ≥ 0.7, the first release with ADR 0042 select options)
├── client/webform.ts ← browser: proof of work in a Worker, submit with fetch, errors by field, thank-you
├── thumbnails/       ← the Tapestry library thumbnail
└── runtime/          ← store.ts (plugin data rows, lazy cleanup), secret.ts (key from CMS_ENCRYPTION_KEY),
                         mail.ts (studiocms:mailer), submit/challenge/options/admin/export endpoints (/_webforms/*),
                         Webform.astro, WebformsNav.astro + WebformsPage.astro (dashboard), viewer.ts
```

## Commands

| Command | |
| --- | --- |
| `pnpm install` / `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm audit` | |
| Release | Bump `version`, PR, merge, GitHub release `v<version>`, approve the staged version on npm. Never publish locally. |

## Gotchas

- StudioCMS names the page `/dashboard/nascencestudio_webforms/webforms`. It's an editor-level page: admins
  see the builder, editors only the submissions (the endpoints check roles again).
- Astro refuses cross-site form POSTs before our code runs: tests must send `Origin`.
- Submissions sent within 3 s of the page load are spam by design: browser tests wait 3.2 s first, and
  errors by field come from the server only after that.
- IP Guard counts spam towards its rate limit: tests that submit many times use separate addresses
  (`X-Forwarded-For`, documentation ranges).
- The email is quoted-printable (StudioCMS's mailer): decode before matching text in tests.
- With mail on, a failing notification email makes StudioCMS refuse dashboard saves (Tapestry known issue
  #40); SMTP settings can be saved only once (#39). `patches/studiocms@<version>.patch` fixes both (mail
  only; shipped for sites without Tapestry). Tapestry's patch contains the same hunks: keep them identical,
  for every supported StudioCMS version (pnpm allows one patch per package version). Email tests
  (`E2E_MAIL_SINK=1`) run on scratch or CI sites only and turn mail back off.
- After rebuilding IP Guard or Tapestry, the playground needs `pnpm install` (sometimes twice, "linked package
  out of date") and a dev server restart.
- Radios and checkboxes must stay ≥ 20px on rows ≥ 28px apart (axe `target-size`, WCAG 2.2).
