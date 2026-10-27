# Application Tracker — Template

A personal job application tracker with a pipeline board (Leads ->
Needs Submitting -> Applied -> Interviewing -> Offer -> Closed/Rejected),
fit scoring with a per-role questionnaire, a prep queue, key contacts, and
a draft-only outreach workspace.

**The safety rule built into this template:** the tracker never sends a
message on your behalf. Outreach drafts need your exact-text approval, then
you copy the text into LinkedIn, email, or text yourself and mark the draft
sent. Editing an approved draft sends it back to unapproved.

## Start here: the onboarding questionnaire

Open the **Onboarding** tab first. It starts with your resume and walks
through everything the tracker needs to be *yours* instead of a blank
board:

1. **Resume** — upload your resume and add your LinkedIn profile URL.
2. **Email** — choose your provider, connect it in your assistant, and
   record exactly what it may scan for (job alerts, interview invites,
   decisions, recruiter mail).
3. **Job alerts** — confirm LinkedIn and Indeed job-notification emails
   are switched on for your target titles and locations (step-by-step
   checklist included), plus company career-page alerts.
4. **Targets, locations, and pay** — the roles, places, and numbers your
   fit score and lead searches should be built around.
5. **Standing answers** — the questions every application asks, answered
   once, by you (self-ID answers are optional, opt-in only).
6. **Automation preferences** — approve-everything, or auto-submit only
   roles that pass your gates with every field known. Blocked roles are
   parked with a reason, never guessed at.

Full questionnaire: [ONBOARDING.md](ONBOARDING.md)

## What's in this repo

- `client/src/` — React UI (pipeline, secondary jobs, contacts, outreach,
  settings, and the onboarding wizard)
- `server/src/` — server actions (`actions.ts`) and Drizzle schema
  (`schema.ts`)
- `drizzle/0001_create_tracker_tables.sql` — one consolidated migration:
  all tables, **no seed data**
- `examples/seed-example.sql` — fictional example rows only

## What was deliberately left out

- No database file, no build output, no `node_modules`
- No real applications, contacts, names, phone numbers, resume data, or
  links from anyone's real tracker — this template was sanitized and
  grep-verified before publishing

## How to use it

This source is a Muse web artifact (a TypeScript space). It depends on
`@hatch/space-sdk`, which the Muse artifact runtime provides, so it is
not a standalone app you can `bun run` anywhere — yet.

1. In Muse, create a new web artifact (fullstack) and bring this source
   in as the starting point — or adapt the client/server code to your
   own stack.
2. Apply `drizzle/0001_create_tracker_tables.sql` to a fresh SQLite
   database.
3. Optionally load `examples/seed-example.sql`, then replace the example
   rows with your own.
4. Open the Onboarding tab and finish the questionnaire.

Using this as a template: on GitHub, use **Use this template** (or fork)
so your copy gets your data — never commit your real database, resume,
or contacts back to a public repo.

## License

MIT — see [LICENSE](LICENSE).
