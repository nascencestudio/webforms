# @nascencestudio/webforms

**Forms for [StudioCMS](https://studiocms.dev) sites:** built in the dashboard, submissions kept and
emailed, spam stopped in layers without Google or any other third party.

- **Build forms in Dashboard → Webforms** (admins): short text, email, phone, long text, dropdown, radio
  buttons, checkboxes, a single checkbox (consent) and text blocks. Each field has a label, help text,
  required and a maximum length. Each form has recipients, an email subject, a thank-you message or a page
  to go to, and how long submissions are kept (90 days by default). A **Contact** form is ready on first use.
- **Read submissions** (editors): messages and spam apart, one submission at a time, mark as spam or not
  spam, delete, **export CSV** (cells that would run as spreadsheet formulas are neutralised).
- **Put a form on a page** with `<Webform form="…" />`, or, on [Tapestry](https://github.com/nascencestudio/tapestry)
  sites, drag the **Webform** component in and pick the form.
- **Spam stopped in layers**, cheapest first, with nothing for people to solve:
  1. a hidden field that bots fill in;
  2. a signed timing token (sent within 3 seconds, or a day later: suspicious);
  3. a **proof of work** the browser solves in the background (about a second, in a Web Worker): a signed,
     expiring, single-use challenge that makes bulk spam expensive;
  4. [IP Guard](https://github.com/nascencestudio/ipguard) when installed: review lists, rate limit,
     AbuseIPDB reputation;
  5. a links limit.

  Spam is kept and marked (not emailed) and answered like a success, so bots learn nothing. Without
  JavaScript the form still posts; such submissions are kept as spam rather than lost.
- **Mail without surprises:** submissions are stored first, then emailed, so a mail failure loses nothing
  (the Submissions page shows whether the email went out). Visitor input never goes into an email header;
  the visitor's address is in the body ("Reply to: …").
- **Accessible:** labels, errors by field (announced, focus on the first), WCAG 2.2 AA checked with axe.

## Requirements

- Node ≥ 22.12, Astro 7, StudioCMS 0.6 or 0.7
- Optional: `@nascencestudio/ipguard` 0.1 (recommended), `@nascencestudio/tapestry` 0.6 (the Webform component)

## Install

```sh
pnpm add @nascencestudio/webforms @nascencestudio/ipguard
```

```js
// studiocms.config.mjs
import ipguard from '@nascencestudio/ipguard';
import webforms from '@nascencestudio/webforms';
export default defineStudioCMSConfig({ plugins: [ipguard(), webforms()] });
```

Show a form anywhere in your site's Astro code:

```astro
---
import Webform from '@nascencestudio/webforms/Webform.astro';
---
<Webform form="wf_…" />
```

The form's id is in its address in Dashboard → Webforms (`?form=wf_…`). On Tapestry sites, add the component:

```js
import { webformComponents } from '@nascencestudio/webforms/tapestry';
tapestry({ components: [...components, ...webformComponents()] })
```

Options: `webforms({ difficulty: 17, maxLinks: 3, ipguard: true })`: the proof of work's difficulty in
leading zero bits (12 to 22; each step doubles the work), how many links a message may contain before
it's kept as spam, and whether to use IP Guard when it's installed.

Tokens and challenges are signed with a key derived from StudioCMS's `CMS_ENCRYPTION_KEY`; nothing else to set.

## Sending email

Webforms emails through StudioCMS's mailer (**Dashboard → SMTP Configuration**). Many hosts (Hetzner among
them) block outgoing ports 25 and 465, so use an email delivery service on port 587. With
[Brevo](https://www.brevo.com/), one account can send for several domains (the free plan: 300 emails a day in
all):

1. In Brevo, add the site's domain and put the DNS records it gives you (SPF, DKIM, DMARC) in the domain's DNS.
2. In Dashboard → SMTP Configuration: host `smtp-relay.brevo.com`, port 587, not secure (STARTTLS is used),
   your Brevo SMTP login and key, and a sender address on the verified domain. Turn mail on in the site
   configuration.
3. **Send a test right away** (e.g. a password reset, or a form submission). Two StudioCMS issues make this
   important:
   - with mail on, StudioCMS emails admins about dashboard changes, and when that email fails **the save
     fails** (HTTP 400, "Failed to send notification"): a wrong setting stops editors saving pages. Turning
     mail off restores saving.
   - SMTP settings can be saved only once from the dashboard; to change them later, delete the
     `SCMS_MAILER_CONFIG_1` row in the `StudioCMSDynamicConfigSettings` table first.

Add the form to your privacy policy: submissions are kept for the form's retention period (and, with IP
Guard, visitors' addresses are checked as its README describes).

## How it's built

Webforms is developed with an AI coding assistant (Anthropic's Claude), directed by its maintainer at
Nascence Studio, who sets the requirements, makes the decisions and checks the results. Commits written
with the assistant's help say so (`Co-Authored-By`).

- **Decisions are written down** in [docs/decisions](docs/decisions/) and the [devlog](docs/devlog.md).
- **Behaviour is tested:** unit tests cover form definitions, value validation, the timing token, the proof
  of work (forged, reused, expired, wrong form), CSV escaping and the builder's actions; browser tests in
  [tapestry-playground](https://github.com/nascencestudio/tapestry-playground) build a form, place it with
  Tapestry, send it as a visitor, check each spam layer, the email (a test SMTP server), the Submissions
  page and an accessibility audit.
- **No runtime dependencies.** Releases are published from GitHub Actions with npm provenance and approved
  with two-factor authentication.

## License

MIT © Nascence Studio
