# 0001. Webforms: forms built in the dashboard, submissions stored and emailed, spam stopped in layers

- Status: Accepted (2026-10-19; the user confirmed the proposed defaults and chose our own proof of work).
- Date: 2026-10-19

## Context

Small-business sites need at least a contact form; the user knows Drupal's Webform module and wants
that ease. No StudioCMS form plugin exists (registry checked). StudioCMS has a mailer (`studiocms:mailer`,
configured in Dashboard → SMTP Configuration, used for password resets and invites) that plugins can
call. Sites run on Hetzner, which blocks outgoing ports 25/465, so mail goes through an email delivery
service on port 587: **Brevo** *(user)*, one agency account with each client's domain verified (free
plan: 300 emails a day across all domains, enough for small sites). Spam protection must not depend on
Google (no reCAPTCHA) *(user)*.

## Decision

1. **A StudioCMS plugin without Tapestry**, `@nascencestudio/webforms` *(user)*. Sites show a form with
   `<Webform form="…" />` (Astro). Tapestry sites also get a Webform component from a separate entry
   (`@nascencestudio/webforms/tapestry`; Tapestry is an optional peer). IP checks come from
   `@nascencestudio/ipguard` when installed (its ADR 0001).
2. **Dashboard → Webforms** (admins build forms; editors view submissions). Fields in the
   first version: short text, email, phone, long text, dropdown, radio buttons, checkboxes,
   a single checkbox (e.g. consent), and a text block (help or a heading). Each field: label, help,
   required, maximum length. Per form: recipients (validated addresses, up to 10), email subject,
   thank-you message or a page to go to, whether to keep submissions, how long (default 90 days).
   A **Contact** form is created on first use, like Tapestry Menus' Main navigation.
   Later: conditional fields, several steps. File uploads are left out of the first version (the
   riskiest part).
3. **A submission**: `POST /_webforms/submit` (same origin, size-limited) → validate against the form's
   definition (unknown fields dropped, every value checked and capped) → spam checks (4) → store (if
   the form keeps submissions) → email the recipients → thank-you. Storing first means a mail failure
   loses nothing; the Submissions page shows whether the email went out.
4. **Spam checks, cheapest first** (no third party, no cookies, nothing for people to solve):
   1. **Honeypot**: a field hidden from people; bots fill it in.
   2. **Timing**: a signed token from when the form was shown; too fast (under 3 s) or too old (over a
      day) is suspicious.
   3. **Proof of work**: before sending, the browser solves a small puzzle (about a second, in a Web
      Worker, with Web Crypto's SHA-256): the server issues a signed, expiring, **single-use** challenge
      and checks the answer. It makes bulk spam expensive. Our own implementation (about a hundred lines a
      side, nothing added to the supply chain) *(user)*; ALTCHA's library was the alternative.
   4. **IP Guard** (when installed): lists, rate limit, AbuseIPDB (its ADR 0001).
   5. **Content limits**: e.g. too many links in a message.
   Outcomes: **accept**; **spam** (stored and marked, not emailed, reviewable); **refuse** (IP Guard's
   decision; nothing stored). Without JavaScript the proof of work can't run: such submissions are kept
   as spam rather than lost.
5. **Email** through StudioCMS's mailer: plain text, the form's fields in order; visitor input never goes
   into a header (that's how forms get abused to send spam); the visitor's address in the body
   ("Reply to: …"), since the mailer has no Reply-To. Revisit with our own sender on the same SMTP
   settings if replying directly matters.
6. **Submissions page**: list per form, view, mark spam / not spam, delete, export CSV (cells that
   start with `=`, `+`, `-` or `@` are escaped so spreadsheets don't run them as formulas). Expired
   submissions are deleted lazily (StudioCMS has no cron).
7. **Storage**: StudioCMS's plugin data table (forms and submissions as rows), re-validated on read;
   the same approach as Tapestry Menus.
8. **Privacy**: a submission keeps what the visitor typed and when, not their address (IP Guard keeps
   addresses only as its ADR describes); a retention period per form; deleting a submission deletes it.

## Mail setup (per site, no code)

Add the client's domain to the agency Brevo account and put its three DNS records (SPF, DKIM, DMARC)
in the client's DNS; enter Brevo's SMTP settings (port 587) in the site's SMTP Configuration; send a
test (e.g. a password reset). A checklist goes in the README.

## Consequences

- One plugin to install for forms; IP Guard optional; Tapestry optional.
- Tests: unit tests for form definitions, value validation, the timing token and the proof of work
  (forged, reused, expired); browser tests for building a form, submitting it, each spam check
  rejecting what it should, the email (a test SMTP server) and the Submissions page; accessibility.
