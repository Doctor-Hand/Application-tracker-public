import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, eq } from "drizzle-orm";
import * as schema from "./schema";

const stageSchema = z.enum(["Leads", "Needs Submitting", "Applied", "Interviewing", "Offer", "Closed/Rejected"]);
const prepStatusSchema = z.enum(["none", "requested", "in_progress", "done", "blocked"]);
const laneSchema = z.enum(["medical", "bridge"]);
const fitBreakdownSchema = z.object({
  role: z.number(),
  warm: z.number(),
  lane: z.number(),
  fresh: z.number(),
  location: z.number(),
});
const fitSourceSchema = z.enum(["auto", "manual", "questionnaire", "sweep"]);

/**
 * SINGLE-WRITER LOCK for fit scores. A score has exactly one writer once it
 * is locked: the pipeline sweep (source "sweep", set from people evidence),
 * the user's questionnaire (source "questionnaire"), or the user's manual override
 * (source "manual"). Locked scores carry fit_manual = 1, but the lock check
 * also honors the source alone so a row whose flag was lost in an older edit
 * is still protected. Automated re-scoring (dailyMaintenance) must NEVER
 * write a locked score — it may only compute what the rubric would say and
 * flag a divergence in its health report.
 */
function isFitLocked(row: { fitManual: number; fitSource: string }): boolean {
  return row.fitManual === 1 || row.fitSource === "manual" || row.fitSource === "questionnaire" || row.fitSource === "sweep";
}

/** Who the warm path is, for evidence citations: the People field first. */
function warmEvidence(row: { people: string; tags: string; fitNotes: string }): string {
  const people = row.people.trim();
  if (people) return people;
  const noteMatch = row.fitNotes.match(/warm path:\s*(.+)/i);
  if (noteMatch && noteMatch[1]) return noteMatch[1].trim();
  if (parseTags(row.tags).map((t) => t.toLowerCase()).includes("warm-intro")) return "warm-intro tag on the card (no person named in the People field yet)";
  return "";
}
const fitAnswersSchema = z.object({
  role_type: z.enum(["", "associate", "css", "sales_rep", "other"]).default(""),
  role_lane_match: z.enum(["", "exact", "adjacent", "different"]).default(""),
  role_day_to_day: z.enum(["", "very_close", "somewhat", "not_really"]).default(""),
  warm_knows_someone: z.enum(["", "strong", "some", "none"]).default(""),
  warm_contact_type: z.enum(["", "hiring_manager", "team_rep", "recruiter", "other_employee", "none"]).default(""),
  warm_referral: z.enum(["", "yes", "maybe", "no"]).default(""),
  warm_talked: z.enum(["", "multiple", "once", "no"]).default(""),
  pay_structure: z.enum(["", "base_salary", "base_plus_commission", "draw", "pure_commission", "unknown"]).default(""),
  pay_guaranteed: z.enum(["", "yes_full", "yes_partial", "no", "unknown"]).default(""),
  pay_covers_gap: z.enum(["", "fully", "partially", "not_at_all", "unknown"]).default(""),
  pay_hours: z.enum(["", "around_40", "moderate_oncall", "heavy_oncall", "unknown"]).default(""),
  fresh_posted_when: z.enum(["", "within_week", "one_two_weeks", "three_four_weeks", "over_month", "unknown"]).default(""),
  fresh_verified: z.enum(["", "today", "this_week", "not_checked", "closed"]).default(""),
  loc_distance: z.enum(["", "local", "in_region", "remote", "out_of_state"]).default(""),
  loc_work_style: z.enum(["", "hybrid", "onsite_reasonable", "onsite_heavy", "remote"]).default(""),
  loc_relocation: z.enum(["", "none_needed", "required_ok", "required_not_ok", "unknown"]).default(""),
  other_travel_pct: z.string().trim().max(40).default(""),
  other_oncall: z.string().trim().max(80).default(""),
  other_territory_size: z.string().trim().max(120).default(""),
  other_team_size: z.string().trim().max(80).default(""),
  other_hiring_manager_known: z.string().trim().max(200).default(""),
  other_deadline: z.string().trim().max(120).default(""),
  other_next_step: z.string().trim().max(500).default(""),
  other_deal_breakers: z.string().trim().max(1000).default(""),
  other_notes: z.string().trim().max(1000).default(""),
});
const emptyFitAnswers: z.infer<typeof fitAnswersSchema> = {
  role_type: "", role_lane_match: "", role_day_to_day: "",
  warm_knows_someone: "", warm_contact_type: "", warm_referral: "", warm_talked: "",
  pay_structure: "", pay_guaranteed: "", pay_covers_gap: "", pay_hours: "",
  fresh_posted_when: "", fresh_verified: "",
  loc_distance: "", loc_work_style: "", loc_relocation: "",
  other_travel_pct: "", other_oncall: "", other_territory_size: "", other_team_size: "",
  other_hiring_manager_known: "", other_deadline: "", other_next_step: "", other_deal_breakers: "", other_notes: "",
};
const applicationInput = z.object({
  lane: laneSchema,
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(180),
  location: z.string().trim().max(120).default(""),
  pay: z.string().trim().max(160).default(""),
  req_id: z.string().trim().max(80).default(""),
  stage: stageSchema.default("Leads"),
  notes: z.string().trim().max(3000).default(""),
  people: z.string().trim().max(5000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  source_url: z.string().trim().max(1000).default(""),
  employer_url: z.string().trim().max(1000).default(""),
  link_status: z.enum(["unchecked", "live", "dead"]).default("unchecked"),
});
const linkStatusSchema = z.enum(["unchecked", "live", "dead"]);
const applicationRow = applicationInput.extend({
  id: z.number(),
  employer_url: z.string(),
  link_status: linkStatusSchema,
  link_checked_at: z.string().nullable(),
  prep_status: prepStatusSchema,
  submit_url: z.string(),
  prep_notes: z.string(),
  prep_requested_at: z.string().nullable(),
  prep_updated_at: z.string().nullable(),
  fit_score: z.number().nullable(),
  fit_breakdown: fitBreakdownSchema,
  fit_notes: z.string(),
  fit_manual: z.boolean(),
  fit_answers: fitAnswersSchema,
  fit_source: fitSourceSchema,
  submitted_at: z.string().nullable(),
  submission_confirmation: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
const contactInput = z.object({
  person: z.string().trim().min(1).max(120),
  company_role: z.string().trim().max(200).default(""),
  channel: z.string().trim().max(160).default(""),
  last_contact: z.string().trim().max(500).default(""),
  next_touch: z.string().trim().max(500).default(""),
  notes: z.string().trim().max(2000).default(""),
});
const contactRow = contactInput.extend({ id: z.number(), created_at: z.string(), updated_at: z.string() });
const draftStatusSchema = z.enum(["draft", "approved", "sent", "dropped"]);
/**
 * One candidate recipient for a role's outreach draft. When the exact
 * regional manager for a role isn't straightforward to identify, a draft
 * carries a list of plausible people instead of stalling on one name; the user
 * taps a candidate and that person is filled into the message. Every field
 * here must be sourced (a real person, a real LinkedIn profile) — never
 * invented to fill the list.
 */
const candidateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  title: z.string().trim().max(200).default(""),
  note: z.string().trim().max(600).default(""),
  linkedin_url: z.string().trim().max(1000).default(""),
  honorific: z.string().trim().max(10).default(""),
});
const draftInput = z.object({
  application_id: z.number().int().positive().nullable().default(null),
  recipient: z.string().trim().min(1).max(160),
  channel: z.string().trim().max(80).default("LinkedIn"),
  purpose: z.string().trim().max(120).default("Follow-up"),
  body: z.string().trim().max(8000).default(""),
  recipient_read: z.string().trim().max(600).default(""),
  linkedin_url: z.string().trim().max(1000).default(""),
  employer_scope: z.string().trim().max(600).default(""),
  candidates: z.array(candidateSchema).max(12).optional(),
  selected_candidate: z.string().trim().max(160).optional(),
});
const draftRow = z.object({
  application_id: z.number().int().positive().nullable(),
  recipient: z.string(),
  channel: z.string(),
  purpose: z.string(),
  body: z.string(),
  recipient_read: z.string(),
  linkedin_url: z.string(),
  employer_scope: z.string(),
  candidates: z.array(candidateSchema),
  selected_candidate: z.string(),
  id: z.number(),
  status: draftStatusSchema,
  sent_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const settingsRow = z.object({
  auto_apply_enabled: z.boolean(),
  auto_apply_bridge_enabled: z.boolean(),
  auto_apply_companies: z.array(z.string()),
  auto_apply_role_types: z.array(z.string()),
  auto_apply_scope_notes: z.string(),
  auto_apply_states: z.array(z.string()),
});
const loginRequestRow = z.object({
  portal_key: z.string(),
  portal_name: z.string(),
  portal_url: z.string(),
  company: z.string(),
  blocker_type: z.string(),
  status: z.enum(["requested", "delivered", "done"]),
  requested_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
});
const okResponse = z.object({ ok: z.literal(true) });

function parseStringArray(value: string | null | undefined, fallback: string[]): string[] {
  if (!value) return [...fallback];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
      return cleaned.length > 0 ? cleaned : [...fallback];
    }
  } catch { /* fall through */ }
  return [...fallback];
}
function parseStringArrayAllowEmpty(value: string | null | undefined, fallback: string[]): string[] {
  if (value === null || value === undefined || value === "") return [...fallback];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim().toUpperCase());
    }
  } catch { /* fall through */ }
  return [...fallback];
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function parseBreakdown(value: string): z.infer<typeof fitBreakdownSchema> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      const p = parsed as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
      return { role: num(p.role), warm: num(p.warm), lane: num(p.lane), fresh: num(p.fresh), location: num(p.location) };
    }
  } catch { /* fall through */ }
  return { role: 0, warm: 0, lane: 0, fresh: 0, location: 0 };
}

function parseFitAnswers(value: string): z.infer<typeof fitAnswersSchema> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      const result = fitAnswersSchema.safeParse(parsed);
      if (result.success) return result.data;
      // Partial / legacy: merge over empty so missing keys don't break the UI
      const p = parsed as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...emptyFitAnswers };
      for (const key of Object.keys(emptyFitAnswers)) {
        if (typeof p[key] === "string") merged[key] = p[key];
      }
      const retry = fitAnswersSchema.safeParse(merged);
      if (retry.success) return retry.data;
    }
  } catch { /* fall through */ }
  return { ...emptyFitAnswers };
}

export function computeFitFromQuestionnaire(answers: z.infer<typeof fitAnswersSchema>): { score: number; breakdown: z.infer<typeof fitBreakdownSchema> } {
  // Role alignment /30 — type 10 + lane match 10 + day-to-day 10
  const roleTypePts: Record<string, number> = { associate: 10, css: 8, sales_rep: 5, other: 2, "": 3 };
  const roleLanePts: Record<string, number> = { exact: 10, adjacent: 6, different: 2, "": 3 };
  const roleDayPts: Record<string, number> = { very_close: 10, somewhat: 6, not_really: 2, "": 3 };
  const role = Math.min(30, (roleTypePts[answers.role_type] ?? 3) + (roleLanePts[answers.role_lane_match] ?? 3) + (roleDayPts[answers.role_day_to_day] ?? 3));

  // Warm path /25 — knows someone 8 + contact type 7 + referral 6 + talked 4
  const warmKnowsPts: Record<string, number> = { strong: 8, some: 4, none: 0, "": 0 };
  const warmTypePts: Record<string, number> = { hiring_manager: 7, team_rep: 6, recruiter: 5, other_employee: 3, none: 0, "": 0 };
  const warmRefPts: Record<string, number> = { yes: 6, maybe: 3, no: 0, "": 0 };
  const warmTalkedPts: Record<string, number> = { multiple: 4, once: 3, no: 0, "": 0 };
  const warm = Math.min(25, (warmKnowsPts[answers.warm_knows_someone] ?? 0) + (warmTypePts[answers.warm_contact_type] ?? 0) + (warmRefPts[answers.warm_referral] ?? 0) + (warmTalkedPts[answers.warm_talked] ?? 0));

  // Lane / pay /20 — structure 6 + guaranteed 5 + covers gap 5 + hours 4
  const payStructPts: Record<string, number> = { base_salary: 6, base_plus_commission: 5, draw: 3, pure_commission: 1, unknown: 2, "": 2 };
  const payGuarPts: Record<string, number> = { yes_full: 5, yes_partial: 3, no: 0, unknown: 2, "": 2 };
  const payGapPts: Record<string, number> = { fully: 5, partially: 3, not_at_all: 0, unknown: 2, "": 2 };
  const payHoursPts: Record<string, number> = { around_40: 4, moderate_oncall: 2, heavy_oncall: 0, unknown: 2, "": 2 };
  const lane = Math.min(20, (payStructPts[answers.pay_structure] ?? 2) + (payGuarPts[answers.pay_guaranteed] ?? 2) + (payGapPts[answers.pay_covers_gap] ?? 2) + (payHoursPts[answers.pay_hours] ?? 2));

  // Freshness /15 — posted 8 + verified 7
  const freshPostedPts: Record<string, number> = { within_week: 8, one_two_weeks: 6, three_four_weeks: 4, over_month: 2, unknown: 3, "": 3 };
  const freshVerPts: Record<string, number> = { today: 7, this_week: 5, not_checked: 2, closed: 0, "": 2 };
  const fresh = Math.min(15, (freshPostedPts[answers.fresh_posted_when] ?? 3) + (freshVerPts[answers.fresh_verified] ?? 2));

  // Location /10 — distance 5 + work style 3 + relocation 2
  const locDistPts: Record<string, number> = { local: 5, in_region: 4, remote: 3, out_of_state: 1, "": 2 };
  const locStylePts: Record<string, number> = { hybrid: 3, remote: 3, onsite_reasonable: 2, onsite_heavy: 0, "": 1 };
  const locReloPts: Record<string, number> = { none_needed: 2, required_ok: 1, required_not_ok: 0, unknown: 1, "": 1 };
  const location = Math.min(10, (locDistPts[answers.loc_distance] ?? 2) + (locStylePts[answers.loc_work_style] ?? 1) + (locReloPts[answers.loc_relocation] ?? 1));

  const breakdown = { role, warm, lane, fresh, location };
  return { score: role + warm + lane + fresh + location, breakdown };
}

type FitInput = {
  lane: "medical" | "bridge";
  role: string;
  location: string;
  pay: string;
  people: string;
  tags: string[];
  updatedAt: Date;
};

/**
 * Transparent 0-100 fit rubric (the same one shown in the dashboard legend):
 * role alignment 30, warm path 25, lane/pay fit 20, freshness 15, location 10.
 * Computed only from facts already on the card - no invented data.
 */
export function computeFit(input: FitInput): { score: number; breakdown: z.infer<typeof fitBreakdownSchema> } {
  const tags = input.tags.map((t) => t.toLowerCase());
  const roleText = input.role.toLowerCase();
  const locText = input.location.toLowerCase();
  const payText = input.pay.toLowerCase();

  // Role alignment /30
  let role = 10;
  if (tags.includes("associate-level") || /\bassociate\b/.test(roleText)) role = 24;
  else if (tags.includes("specialist") || /clinical (sales )?specialist/.test(roleText)) role = 20;
  else if (/territory manager|account manager|sales representative|sales rep\b/.test(roleText)) role = 16;
  else if (/\bsr\.?\b|senior/.test(roleText)) role = 8;
  // Template note: add a small bonus here for your own priority companies if you want one.
  role = Math.min(30, role);

  // Warm path /25
  let warm = 0;
  if (tags.includes("warm-intro")) warm = 25;
  else if (input.people.trim().length > 0) {
    // Calibrated against the sweep scores (2026-10-26 audit): a People field
    // naming a decision-maker (RSM / hiring manager / recruiter / director)
    // is a materially warmer path than a peer name alone, and the sweeps
    // score it ~20-22. A plain named contact stays at 15.
    warm = /manager|rsm|director|recruiter|hiring|vice president|\bvp\b/.test(input.people.toLowerCase()) ? 20 : 15;
  }

  // Lane / pay fit /20
  let lane = 8;
  if (input.lane === "medical") {
    lane = 14;
    if (payText.length > 0) lane = 17;
    if (tags.includes("verified-live")) lane += 3;
  } else {
    if (/per hour|\/hr|hourly/.test(payText)) lane = 20;
    else if (payText.length > 0) lane = 14;
    if (/commission only|pure commission|100% commission/.test(payText)) lane = 4;
  }
  lane = Math.min(20, lane);

  // Freshness /15 - based on when the card was last touched
  const ageDays = Math.max(0, (Date.now() - input.updatedAt.getTime()) / 86_400_000);
  let fresh = ageDays <= 7 ? 15 : ageDays <= 14 ? 11 : ageDays <= 30 ? 7 : 3;
  if (tags.includes("verified-live")) fresh = Math.max(fresh, 11);
  fresh = Math.min(15, fresh);

  // Location /10
  let location = 4;
  if (/los angeles|\bla\b|pasadena|southern california|so ?cal|inland empire|santa barbara|san fernando|orange county|ventura|long beach|huntington/.test(locText)) location = 10;
  else if (/california|\bca\b/.test(locText)) location = 8;
  else if (tags.includes("remote") || /remote/.test(locText)) location = 7;
  else if (locText.trim().length > 0 && !/tbd/.test(locText)) location = 2;

  const breakdown = { role, warm, lane, fresh, location };
  return { score: role + warm + lane + fresh + location, breakdown };
}

type AppRow = typeof schema.applications.$inferSelect;

function toApiApp(row: AppRow) {
  return {
    id: row.id, lane: row.lane, company: row.company, role: row.role, location: row.location,
    pay: row.pay, req_id: row.reqId, stage: row.stage, notes: row.notes, people: row.people,
    tags: parseTags(row.tags), source_url: row.sourceUrl,
    employer_url: row.employerUrl ?? "", link_status: (row.linkStatus === "live" || row.linkStatus === "dead" ? row.linkStatus : "unchecked") as "unchecked" | "live" | "dead",
    link_checked_at: row.linkCheckedAt ? row.linkCheckedAt.toISOString() : null,
    prep_status: row.prepStatus, submit_url: row.submitUrl, prep_notes: row.prepNotes,
    prep_requested_at: row.prepRequestedAt ? row.prepRequestedAt.toISOString() : null,
    prep_updated_at: row.prepUpdatedAt ? row.prepUpdatedAt.toISOString() : null,
    fit_score: row.fitScore, fit_breakdown: parseBreakdown(row.fitBreakdown), fit_notes: row.fitNotes,
    fit_manual: row.fitManual === 1,
    fit_answers: parseFitAnswers(row.fitAnswers ?? "{}"),
    fit_source: (row.fitSource === "manual" || row.fitSource === "questionnaire" || row.fitSource === "sweep" ? row.fitSource : "auto") as "auto" | "manual" | "questionnaire" | "sweep",
    submitted_at: row.submittedAt ? row.submittedAt.toISOString() : null,
    submission_confirmation: row.submissionConfirmation,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  };
}

type DraftRow = typeof schema.outreachDrafts.$inferSelect;
type Candidate = z.infer<typeof candidateSchema>;

function lastNameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
}

function honorificFromBody(body: string): string {
  return body.match(/^(?:Hello|Hi|Hey)\s+(Mr\.|Ms\.|Mrs\.|Dr\.)/m)?.[1] ?? "";
}

/** The one-person candidate list a legacy single-recipient draft implies. */
function synthesizedCandidate(row: { recipient: string; linkedinUrl: string | null; body: string }): Candidate {
  return {
    name: row.recipient,
    title: "",
    note: "",
    linkedin_url: row.linkedinUrl ?? "",
    honorific: honorificFromBody(row.body),
  };
}

function parseCandidates(raw: string | null | undefined, fallback: Candidate): Candidate[] {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned: Candidate[] = [];
        for (const entry of parsed) {
          const result = candidateSchema.safeParse(entry);
          if (result.success) cleaned.push(result.data);
        }
        if (cleaned.length > 0) return cleaned;
      }
    } catch { /* fall through to the synthesized single candidate */ }
  }
  return [fallback];
}

function candidatesForRow(row: DraftRow): Candidate[] {
  return parseCandidates(row.candidates, synthesizedCandidate(row));
}

function selectedNameForRow(row: DraftRow, candidates: Candidate[]): string {
  const stored = (row.selectedCandidate ?? "").trim();
  if (stored && candidates.some((c) => c.name === stored)) return stored;
  if (candidates.some((c) => c.name === row.recipient)) return row.recipient;
  return candidates[0]?.name ?? row.recipient;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fill a candidate into the message: the greeting's honorific + last name
 * switch to the new person (the user's style: "Hello Mr. Smith!"), and any
 * full-name or last-name references in the body follow. Only names are
 * rewritten — the rest of the approved wording is untouched.
 */
function fillBodyForCandidate(body: string, from: Candidate, to: Candidate): string {
  if (!body || from.name === to.name) return body;
  let next = body;
  next = next.replace(new RegExp(escapeRegExp(from.name), "g"), to.name);
  const fromLast = lastNameOf(from.name);
  const toLast = lastNameOf(to.name);
  if (fromLast && toLast && fromLast !== toLast) {
    // "Mr. Alpha" anywhere in the text (greeting or mid-message) becomes
    // the new person's honorific + last name before bare names are swapped.
    if (to.honorific) {
      next = next.replace(new RegExp(`(?:Mr\\.|Ms\\.|Mrs\\.|Dr\\.)\\s+${escapeRegExp(fromLast)}\\b`, "g"), `${to.honorific} ${toLast}`);
    }
    next = next.replace(new RegExp(`\\b${escapeRegExp(fromLast)}\\b`, "g"), toLast);
  }
  if (to.honorific) {
    next = next.replace(/^((?:Hello|Hi|Hey)\s+)(?:Mr\.|Ms\.|Mrs\.|Dr\.)/m, `$1${to.honorific}`);
  }
  return next;
}

function toApiDraft(row: DraftRow) {
  const candidates = candidatesForRow(row);
  return {
    id: row.id, application_id: row.applicationId, recipient: row.recipient, channel: row.channel,
    purpose: row.purpose, body: row.body, recipient_read: row.recipientRead,
    linkedin_url: row.linkedinUrl ?? "", employer_scope: row.employerScope ?? "",
    candidates,
    selected_candidate: selectedNameForRow(row, candidates),
    status: row.status,
    sent_at: row.sentAt ? row.sentAt.toISOString() : null,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  };
}

const STUCK_PREP_MS = 48 * 3_600_000;

export const Actions = {
  listTracker: defineAction({
    request: z.object({}),
    response: z.object({
      applications: z.array(applicationRow),
      contacts: z.array(contactRow),
      drafts: z.array(draftRow),
      settings: settingsRow,
      login_requests: z.array(loginRequestRow),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [apps, contacts, drafts, settingsRows, loginRows] = await Promise.all([
        db.select().from(schema.applications).orderBy(asc(schema.applications.id)),
        db.select().from(schema.contacts).orderBy(asc(schema.contacts.id)),
        db.select().from(schema.outreachDrafts).orderBy(asc(schema.outreachDrafts.id)),
        db.select().from(schema.trackerSettings),
        db.select().from(schema.loginRequests).orderBy(asc(schema.loginRequests.id)),
      ]);
      const settings = settingsRows.find((row) => row.id === 1);
      return {
        applications: apps.map(toApiApp),
        contacts: contacts.map((row) => ({
          id: row.id, person: row.person, company_role: row.companyRole, channel: row.channel,
          last_contact: row.lastContact, next_touch: row.nextTouch, notes: row.notes,
          created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
        })),
        drafts: drafts.map(toApiDraft),
        settings: {
          auto_apply_enabled: settings ? settings.autoApply === 1 : true,
          auto_apply_bridge_enabled: settings ? settings.autoApplyBridge === 1 : true,
          auto_apply_companies: parseStringArray(settings?.autoApplyCompanies, ["*"]),
          auto_apply_role_types: parseStringArray(settings?.autoApplyRoleTypes, ["*"]),
          auto_apply_scope_notes: settings?.autoApplyScopeNotes ?? "",
          auto_apply_states: parseStringArrayAllowEmpty(settings?.autoApplyStates, []),
        },
        login_requests: loginRows.map((row) => ({
          portal_key: row.portalKey,
          portal_name: row.portalName,
          portal_url: row.portalUrl,
          company: row.company,
          blocker_type: row.blockerType,
          status: (row.status === "delivered" || row.status === "done" ? row.status : "requested") as "requested" | "delivered" | "done",
          requested_at: row.requestedAt ? row.requestedAt.toISOString() : null,
          delivered_at: row.deliveredAt ? row.deliveredAt.toISOString() : null,
        })),
      };
    },
  }),

  createApplication: defineAction({
    request: applicationInput.extend({
      // The pipeline sweep may create a card already scored from people
      // evidence. Passing fit_score + fit_source "sweep" locks that score at
      // creation (single-writer lock) so daily maintenance never overwrites
      // it. A warm-path subscore above 0 must cite its evidence: the People
      // field, the warm_evidence argument, or the notes.
      fit_score: z.number().int().min(0).max(100).optional(),
      fit_breakdown: fitBreakdownSchema.optional(),
      fit_notes: z.string().trim().max(2000).optional(),
      fit_source: z.enum(["sweep", "manual"]).optional(),
      warm_evidence: z.string().trim().max(500).optional(),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const autoFit = computeFit({ lane: args.lane, role: args.role, location: args.location, pay: args.pay, people: args.people, tags: args.tags, updatedAt: new Date() });
      const locking = args.fit_score !== undefined && args.fit_source !== undefined;
      if (locking && args.fit_breakdown && args.fit_breakdown.warm > 0) {
        const evidence = args.people.trim() || (args.warm_evidence ?? "") || (args.notes.match(/warm path:\s*(.+)/i)?.[1] ?? "");
        if (!evidence.trim()) {
          throw new Error("A locked warm-path subscore above 0 must cite its evidence — name who the warm path is in the People field, the notes, or warm_evidence.");
        }
      }
      const fitNotes = locking
        ? [args.fit_notes ?? "", args.warm_evidence ? `Warm path: ${args.warm_evidence}` : ""].filter(Boolean).join(" ")
        : (args.fit_notes ?? "");
      const lockedScore = locking ? args.fit_score : undefined;
      const lockedBreakdown = locking ? args.fit_breakdown : undefined;
      const lockedSource = locking ? args.fit_source : undefined;
      const rows = await db.insert(schema.applications).values({
        lane: args.lane, company: args.company, role: args.role, location: args.location, pay: args.pay,
        reqId: args.req_id, stage: args.stage, notes: args.notes, people: args.people,
        tags: JSON.stringify(args.tags), sourceUrl: args.source_url,
        employerUrl: args.employer_url, linkStatus: args.link_status,
        linkCheckedAt: args.link_status !== "unchecked" ? new Date() : null,
        updatedAt: new Date(),
        fitScore: lockedScore ?? autoFit.score,
        fitBreakdown: JSON.stringify(lockedBreakdown ?? autoFit.breakdown),
        fitNotes,
        fitManual: lockedSource ? 1 : 0,
        fitSource: lockedSource ?? "auto",
      }).returning({ id: schema.applications.id });
      const inserted = rows[0];
      if (!inserted) throw new Error("Application could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateApplication: defineAction({
    request: applicationInput.extend({
      id: z.number().int().positive(),
      submit_url: z.string().trim().max(1000).optional(),
      prep_notes: z.string().trim().max(5000).optional(),
      prep_status: prepStatusSchema.optional(),
      fit_score: z.number().int().min(0).max(100).nullable().optional(),
      fit_notes: z.string().trim().max(2000).optional(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const fitFields: Record<string, unknown> = {};
      if (args.fit_score !== undefined) {
        // An explicit score typed in the edit form is a manual calibration:
        // keep it and stop the daily auto-score from overwriting it. Clearing
        // the field (null) hands scoring back to the rubric.
        // If the current score came from the questionnaire and the score
        // wasn't actually changed, preserve the questionnaire source.
        const existingRows = await db.select().from(schema.applications).where(eq(schema.applications.id, args.id));
        const existing = existingRows[0];
        const unchangedQuestionnaire = existing && existing.fitSource === "questionnaire" && existing.fitScore === args.fit_score && args.fit_score !== null;
        const unchangedSweep = existing && existing.fitSource === "sweep" && existing.fitScore === args.fit_score && args.fit_score !== null;
        const unchangedAuto = existing && existing.fitSource === "auto" && existing.fitScore === args.fit_score && args.fit_score !== null;
        if (unchangedAuto) {
          // The edit form round-trips the current score on every save. An
          // auto score that comes back unchanged is not a manual override:
          // leave all fit fields alone so daily re-scoring keeps working.
          // Only a score the user actually changed becomes a manual lock.
        } else if (args.fit_score === null) {
          fitFields.fitManual = 0;
          fitFields.fitSource = "auto";
          fitFields.fitScore = null;
          const fit = computeFit({ lane: args.lane, role: args.role, location: args.location, pay: args.pay, people: args.people, tags: args.tags, updatedAt: new Date() });
          fitFields.fitScore = fit.score;
          fitFields.fitBreakdown = JSON.stringify(fit.breakdown);
        } else if (unchangedQuestionnaire) {
          fitFields.fitManual = 1;
          fitFields.fitSource = "questionnaire";
          fitFields.fitScore = args.fit_score;
        } else if (unchangedSweep) {
          // An edit-form round-trip must not steal the sweep's lock or
          // relabel its score as the user's manual override.
          fitFields.fitManual = 1;
          fitFields.fitSource = "sweep";
          fitFields.fitScore = args.fit_score;
        } else {
          fitFields.fitManual = 1;
          fitFields.fitSource = "manual";
          fitFields.fitScore = args.fit_score;
        }
      }
      if (args.fit_notes !== undefined) fitFields.fitNotes = args.fit_notes;
      await db.update(schema.applications).set({
        lane: args.lane, company: args.company, role: args.role, location: args.location, pay: args.pay,
        reqId: args.req_id, stage: args.stage, notes: args.notes, people: args.people,
        tags: JSON.stringify(args.tags), sourceUrl: args.source_url,
        employerUrl: args.employer_url, linkStatus: args.link_status,
        linkCheckedAt: args.link_status !== "unchecked" ? new Date() : null,
        updatedAt: new Date(),
        ...(args.submit_url !== undefined ? { submitUrl: args.submit_url } : {}),
        ...(args.prep_notes !== undefined ? { prepNotes: args.prep_notes } : {}),
        ...(args.prep_status !== undefined ? { prepStatus: args.prep_status, prepUpdatedAt: new Date() } : {}),
        ...fitFields,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  saveFitQuestionnaire: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      answers: fitAnswersSchema,
      fit_notes: z.string().trim().max(2000).default(""),
    }),
    response: z.object({ ok: z.literal(true), fit_score: z.number(), fit_breakdown: fitBreakdownSchema }),
    async handler(ctx, args): Promise<{ ok: true; fit_score: number; fit_breakdown: z.infer<typeof fitBreakdownSchema> }> {
      const db = ctx.db<typeof schema>();
      const fit = computeFitFromQuestionnaire(args.answers);
      const now = new Date();
      await db.update(schema.applications).set({
        fitScore: fit.score,
        fitBreakdown: JSON.stringify(fit.breakdown),
        fitAnswers: JSON.stringify(args.answers),
        fitSource: "questionnaire",
        fitManual: 1,
        ...(args.fit_notes ? { fitNotes: args.fit_notes } : {}),
        updatedAt: now,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const, fit_score: fit.score, fit_breakdown: fit.breakdown };
    },
  }),

  clearFitQuestionnaire: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.applications).where(eq(schema.applications.id, args.id));
      const row = rows[0];
      if (!row) throw new Error("Application not found");
      const fit = computeFit({ lane: row.lane, role: row.role, location: row.location, pay: row.pay, people: row.people, tags: parseTags(row.tags), updatedAt: new Date() });
      const now = new Date();
      await db.update(schema.applications).set({
        fitScore: fit.score,
        fitBreakdown: JSON.stringify(fit.breakdown),
        fitAnswers: "{}",
        fitSource: "auto",
        fitManual: 0,
        updatedAt: now,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /**
   * The sweep's writer for fit scores (single-writer lock). The pipeline
   * sweep sets a score from people evidence; from then on the score is
   * LOCKED — daily maintenance never overwrites it, it only flags when the
   * rubric would land more than 5 points away. A warm-path subscore above 0
   * must cite its evidence (who the warm path is): the People field, the
   * card notes, or the warm_evidence argument, which is stored in the fit
   * notes as "Warm path: ..." so the citation travels with the score.
   * the user unlocks a card only by explicitly clearing the score in Edit or
   * clearing the questionnaire — automation never unlocks.
   */
  lockFitScore: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      fit_score: z.number().int().min(0).max(100),
      fit_breakdown: fitBreakdownSchema,
      fit_notes: z.string().trim().max(2000).default(""),
      warm_evidence: z.string().trim().max(500).default(""),
      source: z.enum(["sweep", "manual"]).default("sweep"),
    }),
    response: z.object({ ok: z.literal(true), fit_score: z.number(), fit_source: fitSourceSchema }),
    async handler(ctx, args): Promise<{ ok: true; fit_score: number; fit_source: z.infer<typeof fitSourceSchema> }> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.applications).where(eq(schema.applications.id, args.id));
      const row = rows[0];
      if (!row) throw new Error("Application not found");
      if (args.fit_breakdown.warm > 0) {
        const evidence = args.warm_evidence || warmEvidence({ people: row.people, tags: row.tags, fitNotes: args.fit_notes }) || (row.notes.match(/warm path:\s*(.+)/i)?.[1] ?? "");
        if (!evidence.trim()) {
          throw new Error("A locked warm-path subscore above 0 must cite its evidence — pass warm_evidence naming who the warm path is (it is stored in the fit notes), or fill in the card's People field first.");
        }
      }
      const total = args.fit_breakdown.role + args.fit_breakdown.warm + args.fit_breakdown.lane + args.fit_breakdown.fresh + args.fit_breakdown.location;
      if (total !== args.fit_score) {
        throw new Error(`Fit breakdown adds up to ${total}, not ${args.fit_score}. A locked score must match its breakdown so the card stays explainable.`);
      }
      const fitNotes = [args.fit_notes, args.warm_evidence ? `Warm path: ${args.warm_evidence}` : ""].filter(Boolean).join(" ");
      await db.update(schema.applications).set({
        fitScore: args.fit_score,
        fitBreakdown: JSON.stringify(args.fit_breakdown),
        ...(fitNotes ? { fitNotes } : {}),
        fitSource: args.source,
        fitManual: 1,
        updatedAt: new Date(),
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const, fit_score: args.fit_score, fit_source: args.source };
    },
  }),

  requestPrep: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.update(schema.applications).set({
        // Clear the previous attempt's notes so a fresh queue never shows a
        // stale "Blocked: ..." explanation from an earlier run.
        prepStatus: "requested", prepRequestedAt: now, prepUpdatedAt: now, prepNotes: "", updatedAt: now,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  resetPrep: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.update(schema.applications).set({
        prepStatus: "none", prepRequestedAt: null, prepUpdatedAt: now, prepNotes: "", updatedAt: now,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /**
   * Agent-side queue: every card waiting for prep, oldest first. The runner
   * reads settings on every call: when bridge (fitness) auto-apply is off,
   * bridge-lane cards are SKIPPED — left exactly as they are (still
   * "requested", never blocked, never submitted) — while medical-lane cards
   * continue normally. Turning bridge back on resumes them from the queue.
   */
  listPrepQueue: defineAction({
    request: z.object({}),
    response: z.object({ queue: z.array(applicationRow) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [apps, settingsRows] = await Promise.all([
        db.select().from(schema.applications).orderBy(asc(schema.applications.id)),
        db.select().from(schema.trackerSettings),
      ]);
      const settings = settingsRows.find((row) => row.id === 1);
      const bridgeEnabled = settings ? settings.autoApplyBridge === 1 : true;
      const queue = apps
        .filter((row) => row.prepStatus === "requested" || row.prepStatus === "in_progress")
        .filter((row) => bridgeEnabled || row.lane !== "bridge")
        .sort((a, b) => (a.prepRequestedAt?.getTime() ?? 0) - (b.prepRequestedAt?.getTime() ?? 0));
      return { queue: queue.map(toApiApp) };
    },
  }),

  claimPrep: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.update(schema.applications).set({
        prepStatus: "in_progress", prepUpdatedAt: now, updatedAt: now,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  completePrep: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      submit_url: z.string().trim().max(1000).default(""),
      prep_notes: z.string().trim().max(5000).default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.update(schema.applications).set({
        prepStatus: "done", prepUpdatedAt: now, updatedAt: now,
        stage: "Needs Submitting", submitUrl: args.submit_url, prepNotes: args.prep_notes,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  failPrep: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      prep_notes: z.string().trim().max(5000).default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.update(schema.applications).set({
        prepStatus: "blocked", prepUpdatedAt: now, updatedAt: now, prepNotes: args.prep_notes,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  moveApplication: defineAction({
    request: z.object({ id: z.number().int().positive(), stage: stageSchema }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.update(schema.applications).set({ stage: args.stage, updatedAt: new Date() }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /**
   * Record an employer-site verification for a card: the working employer
   * posting URL (checked on the employer's own careers site, not a job
   * board), whether it is LIVE or DEAD, and the check date (stamped now).
   * Used by the sweep / main agent after checking, and by the user in Edit.
   */
  setLinkVerification: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      employer_url: z.string().trim().max(1000).default(""),
      link_status: linkStatusSchema,
      also_set_source_url: z.boolean().default(false),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.update(schema.applications).set({
        employerUrl: args.employer_url,
        linkStatus: args.link_status,
        linkCheckedAt: args.link_status !== "unchecked" ? now : null,
        ...(args.also_set_source_url && args.employer_url ? { sourceUrl: args.employer_url } : {}),
        updatedAt: now,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteApplication: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.applications).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /**
   * Agent-side: record a completed submission under the user's full auto-apply
   * grant. Stores the employer's exact confirmation wording, stamps the
   * submission time, and moves the card to Applied. Refused while auto-apply
   * is paused in the tracker settings.
   */
  markSubmitted: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      confirmation: z.string().trim().max(2000).default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const settingsRows = await db.select().from(schema.trackerSettings);
      const settings = settingsRows.find((row) => row.id === 1);
      if (settings && settings.autoApply !== 1) {
        throw new Error("Auto-apply is paused in the tracker settings, so this submission was not recorded.");
      }
      if (settings && settings.autoApplyBridge !== 1) {
        const cardRows = await db.select().from(schema.applications).where(eq(schema.applications.id, args.id));
        if (cardRows[0]?.lane === "bridge") {
          throw new Error("Bridge (fitness) auto-apply is off in the tracker settings, so this bridge submission was not recorded. The card stays queued, untouched.");
        }
      }
      const now = new Date();
      await db.update(schema.applications).set({
        stage: "Applied", prepStatus: "done", prepUpdatedAt: now,
        submittedAt: now, submissionConfirmation: args.confirmation, updatedAt: now,
      }).where(eq(schema.applications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** the user's auto-apply grant switch + scope. Messaging approval is not togglable: drafts always need their exact-text approval. All fields are optional so a one-tap toggle, a chip change, or a scope-notes save each persist independently. "*" in companies / role types means Every company / All role types and is the default. */
  updateSettings: defineAction({
    request: z.object({
      auto_apply_enabled: z.boolean().optional(),
      auto_apply_bridge_enabled: z.boolean().optional(),
      auto_apply_companies: z.array(z.string().trim().min(1).max(160)).max(200).optional(),
      auto_apply_role_types: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      auto_apply_scope_notes: z.string().trim().max(4000).optional(),
      auto_apply_states: z.array(z.string().trim().min(2).max(2)).max(60).optional(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const existingRows = await db.select().from(schema.trackerSettings);
      const existing = existingRows.find((row) => row.id === 1);
      const next = {
        autoApply: args.auto_apply_enabled !== undefined ? (args.auto_apply_enabled ? 1 : 0) : (existing?.autoApply ?? 1),
        autoApplyBridge: args.auto_apply_bridge_enabled !== undefined ? (args.auto_apply_bridge_enabled ? 1 : 0) : (existing?.autoApplyBridge ?? 1),
        autoApplyCompanies: args.auto_apply_companies !== undefined ? JSON.stringify(args.auto_apply_companies) : (existing?.autoApplyCompanies ?? '["*"]'),
        autoApplyRoleTypes: args.auto_apply_role_types !== undefined ? JSON.stringify(args.auto_apply_role_types) : (existing?.autoApplyRoleTypes ?? '["*"]'),
        autoApplyScopeNotes: args.auto_apply_scope_notes !== undefined ? args.auto_apply_scope_notes : (existing?.autoApplyScopeNotes ?? ""),
        autoApplyStates: args.auto_apply_states !== undefined ? JSON.stringify(args.auto_apply_states.map((s) => s.toUpperCase())) : (existing?.autoApplyStates ?? '[]'),
        updatedAt: now,
      };
      if (existing) {
        await db.update(schema.trackerSettings).set(next).where(eq(schema.trackerSettings.id, 1));
      } else {
        await db.insert(schema.trackerSettings).values({ id: 1, ...next });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /**
   * "Save login" for one employer portal, from the Logins needed list. The
   * Secure Vault entry form is a native Muse chat card — it cannot render
   * inside this tracker — so this action (1) records the request durably
   * (the entry shows "Card requested" from then on) and (2) spawns an agent
   * task whose whole job is to deliver the vault entry card for this
   * portal's exact tenant URL into the user's main chat. The task
   * reports back through markLoginRequestDelivered once the card is sent.
   * If the spawn is unavailable the recorded request still stands and the
   * response says spawned: false, so a watcher can pick it up instead.
   */
  requestLoginSave: defineAction({
    request: z.object({
      portal_key: z.string().trim().min(1).max(300),
      portal_name: z.string().trim().max(200).default(""),
      portal_url: z.string().trim().max(1000).default(""),
      company: z.string().trim().max(160).default(""),
      blocker_type: z.string().trim().max(80).default(""),
      roles: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
    }),
    response: z.object({ ok: z.literal(true), spawned: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; spawned: boolean }> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const existingRows = await db.select().from(schema.loginRequests).where(eq(schema.loginRequests.portalKey, args.portal_key));
      const existing = existingRows[0];
      if (existing) {
        await db.update(schema.loginRequests).set({
          portalName: args.portal_name || existing.portalName,
          portalUrl: args.portal_url || existing.portalUrl,
          company: args.company || existing.company,
          blockerType: args.blocker_type || existing.blockerType,
          status: "requested",
          requestedAt: now,
          deliveredAt: null,
          updatedAt: now,
        }).where(eq(schema.loginRequests.id, existing.id));
      } else {
        await db.insert(schema.loginRequests).values({
          portalKey: args.portal_key,
          portalName: args.portal_name,
          portalUrl: args.portal_url,
          company: args.company,
          blockerType: args.blocker_type,
          status: "requested",
          requestedAt: now,
          updatedAt: now,
        });
      }
      let spawned = false;
      try {
        const rolesLine = args.roles.length > 0 ? ` It unblocks these application(s) in the Application Tracker: ${args.roles.join("; ")}.` : "";
        const result = await ctx.agent.spawnTask(
          `Deliver a Secure Vault credential-entry (secure-entry) card for the user to save their employer-portal login, and send it into the user's main chat.\n\nPortal: ${args.portal_name || args.company}\nCompany: ${args.company}\nExact portal URL the vault entry must point at (use this URL verbatim — for Workday employers this is the company's exact tenant URL, never the bare myworkdayjobs.com domain): ${args.portal_url || "(no URL on file — use the employer's own careers sign-in page for this company)"}\nBlocker: ${args.blocker_type || "sign-in required"}.${rolesLine}\n\nRules: each company's login is saved SEPARATELY in the vault, titled for that company/portal — never overwrite or reuse another company's entry. Send exactly ONE secure-entry card for this portal into that chat, with a one-line note naming the portal and the role(s) it unblocks. Do not ask for or handle the password in chat text; the card is the only collection path. When the card has been sent, call the Application Tracker's markLoginRequestDelivered action with portal_key "${args.portal_key}" to record delivery.`,
          { dedupeKey: `login-save:${args.portal_key}`, expectsAction: "markLoginRequestDelivered" },
        );
        spawned = result.ok === true;
      } catch {
        spawned = false;
      }
      ctx.invalidateQueries();
      return { ok: true as const, spawned };
    },
  }),

  /** The spawned delivery task reports back here once the vault card is in the user's chat. */
  markLoginRequestDelivered: defineAction({
    request: z.object({ portal_key: z.string().trim().min(1).max(300) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.update(schema.loginRequests).set({
        status: "delivered", deliveredAt: now, updatedAt: now,
      }).where(eq(schema.loginRequests.portalKey, args.portal_key));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /** the user clears a portal's login-save request once the login is saved (or no longer needed). */
  clearLoginRequest: defineAction({
    request: z.object({ portal_key: z.string().trim().min(1).max(300) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.update(schema.loginRequests).set({
        status: "done", updatedAt: now,
      }).where(eq(schema.loginRequests.portalKey, args.portal_key));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /**
   * Outreach drafts. your assistant (or the user) drafts here; nothing is ever sent by the
   * tracker. the user edits the exact text, approves it, copies it into the real
   * channel himself, then marks it sent. The status guard enforces that
   * order: a draft can only be marked sent from "approved".
   */
  createDraft: defineAction({
    request: draftInput,
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const candidates: Candidate[] = args.candidates && args.candidates.length > 0
        ? args.candidates
        : [synthesizedCandidate({ recipient: args.recipient, linkedinUrl: args.linkedin_url, body: args.body })];
      const selected = args.selected_candidate && candidates.some((c) => c.name === args.selected_candidate)
        ? args.selected_candidate
        : (candidates.find((c) => c.name === args.recipient)?.name ?? candidates[0]?.name ?? args.recipient);
      const selectedCandidate = candidates.find((c) => c.name === selected);
      const rows = await db.insert(schema.outreachDrafts).values({
        applicationId: args.application_id, recipient: selected, channel: args.channel,
        purpose: args.purpose, body: args.body, recipientRead: args.recipient_read,
        linkedinUrl: selectedCandidate?.linkedin_url || args.linkedin_url, employerScope: args.employer_scope,
        candidates: JSON.stringify(candidates), selectedCandidate: selected, updatedAt: new Date(),
      }).returning({ id: schema.outreachDrafts.id });
      const inserted = rows[0];
      if (!inserted) throw new Error("Draft could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateDraft: defineAction({
    request: draftInput.extend({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.id, args.id));
      const existing = rows[0];
      if (!existing) throw new Error("Draft not found");
      if (existing.status === "sent") throw new Error("A sent message can't be edited. Draft a new one instead.");
      // Editing the text after approval voids the approval: the exact words
      // the user signed off on are no longer the words in the box.
      const edited = existing.body !== args.body || existing.recipient !== args.recipient || existing.channel !== args.channel;
      // Never overwrite a non-empty saved LinkedIn URL with an empty value on
      // re-save — an editor round-trip that didn't touch the field must not
      // erase the manager's profile link.
      const nextLinkedinUrl = args.linkedin_url.trim() === "" && (existing.linkedinUrl ?? "").trim() !== "" ? existing.linkedinUrl : args.linkedin_url;
      // Candidate list: an explicit list wins. Without one, keep the stored
      // list and patch the entry for the current recipient so a rename or a
      // link edit in the form travels with that candidate.
      let nextCandidates = candidatesForRow(existing);
      if (args.candidates && args.candidates.length > 0) {
        nextCandidates = args.candidates;
      } else {
        nextCandidates = nextCandidates.map((c) => c.name === existing.recipient
          ? { ...c, name: args.recipient, linkedin_url: nextLinkedinUrl || c.linkedin_url }
          : c);
      }
      const nextSelected = args.selected_candidate && nextCandidates.some((c) => c.name === args.selected_candidate)
        ? args.selected_candidate
        : (nextCandidates.find((c) => c.name === args.recipient)?.name ?? nextCandidates[0]?.name ?? args.recipient);
      const selectedEntry = nextCandidates.find((c) => c.name === nextSelected);
      await db.update(schema.outreachDrafts).set({
        applicationId: args.application_id, recipient: args.recipient, channel: args.channel,
        purpose: args.purpose, body: args.body, recipientRead: args.recipient_read,
        linkedinUrl: selectedEntry?.linkedin_url || nextLinkedinUrl, employerScope: args.employer_scope,
        candidates: JSON.stringify(nextCandidates), selectedCandidate: nextSelected,
        ...(edited && existing.status === "approved" ? { status: "draft" as const } : {}),
        updatedAt: new Date(),
      }).where(eq(schema.outreachDrafts.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /**
   * Fill a candidate into the draft's message. The draft keeps ONE body;
   * selecting a candidate rewrites the greeting and name references for
   * that person, points the recipient + LinkedIn link at them, and — like
   * any text edit — sends an approved draft back to unapproved, because the
   * words the user signed off on were addressed to someone else. Nothing is
   * sent by this (or any) action: the user still copies and sends himself.
   */
  selectDraftCandidate: defineAction({
    request: z.object({ id: z.number().int().positive(), candidate_name: z.string().trim().min(1).max(160) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.id, args.id));
      const existing = rows[0];
      if (!existing) throw new Error("Draft not found");
      if (existing.status === "sent") throw new Error("This message was already sent — draft a new one for another candidate.");
      const candidates = candidatesForRow(existing);
      const target = candidates.find((c) => c.name === args.candidate_name);
      if (!target) throw new Error("That candidate is not on this draft's list.");
      const currentName = selectedNameForRow(existing, candidates);
      const current = candidates.find((c) => c.name === currentName) ?? synthesizedCandidate(existing);
      if (target.name === currentName) return { ok: true };
      const nextBody = fillBodyForCandidate(existing.body, current, target);
      const changed = nextBody !== existing.body || existing.recipient !== target.name;
      await db.update(schema.outreachDrafts).set({
        recipient: target.name,
        linkedinUrl: target.linkedin_url || existing.linkedinUrl,
        body: nextBody,
        selectedCandidate: target.name,
        ...(changed && existing.status === "approved" ? { status: "draft" as const, sentAt: null } : {}),
        updatedAt: new Date(),
      }).where(eq(schema.outreachDrafts.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setDraftStatus: defineAction({
    request: z.object({ id: z.number().int().positive(), status: draftStatusSchema }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.id, args.id));
      const existing = rows[0];
      if (!existing) throw new Error("Draft not found");
      if (args.status === "sent" && existing.status !== "approved") {
        throw new Error("Approve the exact text first — only an approved draft can be marked sent.");
      }
      const now = new Date();
      await db.update(schema.outreachDrafts).set({
        status: args.status,
        ...(args.status === "sent" ? { sentAt: now } : {}),
        ...(args.status === "draft" ? { sentAt: null } : {}),
        updatedAt: now,
      }).where(eq(schema.outreachDrafts.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteDraft: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.outreachDrafts).where(eq(schema.outreachDrafts.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /**
   * Daily maintenance (also run by the dashboard health button and the daily
   * cron): re-score every non-locked card with the published rubric — locked
   * scores (sweep, questionnaire, manual) are skipped under the single-writer
   * lock and only flagged in locked_divergences when the rubric disagrees by
   * more than 5 points — and
   * recover prep requests that sat unclaimed for 48h+ by marking them blocked
   * with an explanation so they never silently vanish again. Returns a plain
   * health report the UI renders.
   */
  dailyMaintenance: defineAction({
    request: z.object({}),
    response: z.object({
      ok: z.literal(true),
      ran_at: z.string(),
      scored: z.number(),
      recovered_preps: z.array(z.object({ id: z.number(), company: z.string(), role: z.string(), waiting_hours: z.number() })),
      archived_dead_leads: z.array(z.object({ id: z.number(), company: z.string(), role: z.string() })),
      refreshed_links: z.array(z.object({ id: z.number(), company: z.string(), role: z.string(), to_status: z.enum(["live", "dead"]) })),
      queued_preps: z.number(),
      needs_submitting: z.number(),
      needs_submitting_missing_link: z.array(z.object({ id: z.number(), company: z.string(), role: z.string() })),
      unscored: z.number(),
      total_active: z.number(),
      drafts_awaiting_approval: z.number(),
      drafts_approved_unsent: z.number(),
      duplicate_groups: z.array(z.object({ company: z.string(), role: z.string(), ids: z.array(z.number()) })),
      stale_leads: z.array(z.object({ id: z.number(), company: z.string(), role: z.string(), days: z.number() })),
      dead_leads: z.array(z.object({ id: z.number(), company: z.string(), role: z.string() })),
      sweep_mismatches: z.array(z.object({ id: z.number(), company: z.string(), role: z.string(), sweep_score: z.number(), current_score: z.number() })),
      locked_count: z.number(),
      skipped_locked: z.number(),
      locked_divergences: z.array(z.object({ id: z.number(), company: z.string(), role: z.string(), locked_score: z.number(), auto_score: z.number(), fit_source: fitSourceSchema, locked_warm: z.number(), auto_warm: z.number(), warm_evidence: z.string() })),
      inplay_warm_missing: z.array(z.object({ id: z.number(), company: z.string(), role: z.string() })),
      missing_posting_links: z.number(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const apps = await db.select().from(schema.applications).orderBy(asc(schema.applications.id));
      // Bridge-off means bridge cards waiting in the prep queue are being
      // deliberately skipped by the runner — they are not "stuck", so the
      // 48h auto-recovery below must never mark them blocked.
      const maintenanceSettingsRows = await db.select().from(schema.trackerSettings);
      const maintenanceSettings = maintenanceSettingsRows.find((row) => row.id === 1);
      const bridgeAutoApplyOff = maintenanceSettings ? maintenanceSettings.autoApplyBridge !== 1 : false;
      let scored = 0;
      let lockedCount = 0;
      let skippedLocked = 0;
      const lockedDivergences: { id: number; company: string; role: string; locked_score: number; auto_score: number; fit_source: z.infer<typeof fitSourceSchema>; locked_warm: number; auto_warm: number; warm_evidence: string }[] = [];
      const recovered: { id: number; company: string; role: string; waiting_hours: number }[] = [];
      const archivedDead: { id: number; company: string; role: string }[] = [];
      const refreshedLinks: { id: number; company: string; role: string; to_status: "live" | "dead" }[] = [];
      const missingLink: { id: number; company: string; role: string }[] = [];
      let queued = 0;
      let needsSubmitting = 0;

      for (const row of apps) {
        if (row.stage === "Closed/Rejected") continue;
        const updates: Partial<AppRow> = {};
        // AUTO-FIX (health check): refresh a stale link verdict from the
        // verification already recorded on the card (notes / tags) when
        // link_status was never stamped, then archive a Leads-stage card
        // whose posting is verified dead — the same fix the scheduled
        // weekly cleanup applies. Nothing else is auto-archived: duplicates
        // and blocked preps stay the user's call and are only reported.
        let effLinkStatus = row.linkStatus;
        if (row.linkStatus === "unchecked") {
          const text = `${row.notes} ${row.prepNotes}`;
          const rowTags = parseTags(row.tags).map((t) => t.toLowerCase());
          let derived: "live" | "dead" | null = null;
          if (rowTags.includes("dead") || /\bmarked dead\b|\bposting (is )?dead\b|DEAD\s*[—-]\s*checked/i.test(text)) derived = "dead";
          else if (/verified live/i.test(text)) derived = "live";
          if (derived) {
            updates.linkStatus = derived;
            updates.linkCheckedAt = now;
            effLinkStatus = derived;
            refreshedLinks.push({ id: row.id, company: row.company, role: row.role, to_status: derived });
          }
        }
        const blockedDeadPosting = row.prepStatus === "blocked" && /no longer accepting|posting is closed|no longer recruiting|listing is dead/i.test(row.prepNotes);
        if (row.stage === "Leads" && (effLinkStatus === "dead" || blockedDeadPosting)) {
          updates.stage = "Closed/Rejected";
          updates.notes = [row.notes, `Auto-archived by the system health check: this lead's posting was verified dead, so the card was moved to Closed/Rejected. Move it back to Leads if the posting ever comes back.`].filter((part) => part.trim() !== "").join("\n");
          archivedDead.push({ id: row.id, company: row.company, role: row.role });
          await db.update(schema.applications).set(updates).where(eq(schema.applications.id, row.id));
          continue;
        }
        // SINGLE-WRITER LOCK: locked scores (sweep / questionnaire / manual)
        // are never written here. The rubric score is computed read-only so
        // a divergence over 5 points can be flagged in the report — flagged,
        // never fixed by overwriting.
        const fit = computeFit({
          lane: row.lane, role: row.role, location: row.location, pay: row.pay,
          people: row.people, tags: parseTags(row.tags), updatedAt: row.updatedAt,
        });
        if (isFitLocked(row)) {
          lockedCount += 1;
          skippedLocked += 1;
          if (row.fitScore !== null && Math.abs(fit.score - row.fitScore) > 5) {
            const lockedBreakdown = parseBreakdown(row.fitBreakdown);
            lockedDivergences.push({
              id: row.id, company: row.company, role: row.role,
              locked_score: row.fitScore, auto_score: fit.score,
              fit_source: (row.fitSource === "manual" || row.fitSource === "questionnaire" || row.fitSource === "sweep" ? row.fitSource : "manual") as z.infer<typeof fitSourceSchema>,
              locked_warm: lockedBreakdown.warm, auto_warm: fit.breakdown.warm,
              warm_evidence: warmEvidence({ people: row.people, tags: row.tags, fitNotes: row.fitNotes }),
            });
          }
        } else if (row.fitScore !== fit.score || row.fitBreakdown !== JSON.stringify(fit.breakdown)) {
          updates.fitScore = fit.score;
          updates.fitBreakdown = JSON.stringify(fit.breakdown);
          scored += 1;
        }
        const prepSince = row.prepUpdatedAt ?? row.prepRequestedAt;
        if ((row.prepStatus === "requested" || row.prepStatus === "in_progress") && prepSince && !(bridgeAutoApplyOff && row.lane === "bridge")) {
          const waitingMs = now.getTime() - prepSince.getTime();
          if (waitingMs > STUCK_PREP_MS) {
            const waitingHours = Math.floor(waitingMs / 3_600_000);
            updates.prepStatus = "blocked";
            updates.prepUpdatedAt = now;
            updates.prepNotes = `Auto-recovered by the daily health check: this prep sat ${row.prepStatus === "requested" ? "queued" : "in progress"} for ${waitingHours} hours with no pickup, so it was marked blocked instead of silently stuck. Nothing was filled or submitted. Hit "Retry prep" to queue it again - the daily job sweep picks queued preps up from here.`;
            recovered.push({ id: row.id, company: row.company, role: row.role, waiting_hours: waitingHours });
          } else {
            queued += 1;
          }
        }
        if (row.stage === "Needs Submitting") {
          needsSubmitting += 1;
          if (!row.submitUrl.trim() && !(row.employerUrl ?? '').trim() && !row.sourceUrl.trim()) {
            missingLink.push({ id: row.id, company: row.company, role: row.role });
          }
        }
        if (Object.keys(updates).length > 0) {
          await db.update(schema.applications).set(updates).where(eq(schema.applications.id, row.id));
        }
      }

      const after = await db.select().from(schema.applications);
      const unscored = after.filter((r) => r.stage !== "Closed/Rejected" && r.fitScore === null).length;
      const totalActive = after.filter((r) => r.stage !== "Closed/Rejected").length;

      // Data-integrity pass (2026-10-26 audit): surface, never silently fix.
      // the user decides on duplicates and archives; scores he set are never touched.
      const activeRows = after.filter((r) => r.stage !== "Closed/Rejected");
      const dupMap = new Map<string, AppRow[]>();
      for (const row of activeRows) {
        // Cluster on company + role + req: two live cards for the same req
        // (or the same title with no req on either) are duplicate candidates.
        // The same title at different stages with different reqs is history.
        const key = `${row.company.toLowerCase()}|${row.role.toLowerCase()}|${row.reqId.trim().toLowerCase()}`;
        const list = dupMap.get(key) ?? [];
        list.push(row);
        dupMap.set(key, list);
      }
      const duplicateGroups = [...dupMap.values()]
        .filter((list) => list.length > 1)
        .map((list) => ({ company: list[0]!.company, role: list[0]!.role, ids: list.map((r) => r.id) }));
      const staleLeads = activeRows
        .filter((r) => r.stage === "Leads" && now.getTime() - r.updatedAt.getTime() > 14 * 86_400_000)
        .map((r) => ({ id: r.id, company: r.company, role: r.role, days: Math.floor((now.getTime() - r.updatedAt.getTime()) / 86_400_000) }));
      const deadLeads = activeRows
        .filter((r) => r.prepStatus === "blocked" && /no longer accepting|posting is closed|no longer recruiting|listing is dead/i.test(r.prepNotes))
        .map((r) => ({ id: r.id, company: r.company, role: r.role }));
      const sweepMismatches: { id: number; company: string; role: string; sweep_score: number; current_score: number }[] = [];
      for (const row of activeRows) {
        // Locked cards are included on purpose: if a locked score disagrees
        // with the sweep score recorded in its own notes, that divergence is
        // flagged here — the stored (locked) score is never rewritten.
        if (row.fitScore === null) continue;
        const match = row.notes.match(/FIT SCORE:\s*(\d{1,3})/i);
        if (match) {
          const sweepScore = Number(match[1]);
          if (Math.abs(sweepScore - row.fitScore) >= 5) {
            sweepMismatches.push({ id: row.id, company: row.company, role: row.role, sweep_score: sweepScore, current_score: row.fitScore });
          }
        }
      }
      const inplayWarmMissing = activeRows
        .filter((r) => (r.stage === "Applied" || r.stage === "Interviewing" || r.stage === "Offer") && !r.people.trim() && parseBreakdown(r.fitBreakdown).warm === 0)
        .map((r) => ({ id: r.id, company: r.company, role: r.role }));
      const missingPostingLinks = activeRows.filter((r) => r.stage === "Leads" && !r.sourceUrl.trim()).length;
      const allDrafts = await db.select().from(schema.outreachDrafts);
      const draftsAwaiting = allDrafts.filter((d) => d.status === "draft").length;
      const draftsApprovedUnsent = allDrafts.filter((d) => d.status === "approved").length;
      ctx.invalidateQueries();
      return {
        ok: true as const,
        ran_at: now.toISOString(),
        scored,
        recovered_preps: recovered,
        archived_dead_leads: archivedDead,
        refreshed_links: refreshedLinks,
        queued_preps: queued,
        needs_submitting: needsSubmitting,
        needs_submitting_missing_link: missingLink,
        unscored,
        total_active: totalActive,
        drafts_awaiting_approval: draftsAwaiting,
        drafts_approved_unsent: draftsApprovedUnsent,
        duplicate_groups: duplicateGroups,
        stale_leads: staleLeads,
        dead_leads: deadLeads,
        sweep_mismatches: sweepMismatches,
        locked_count: lockedCount,
        skipped_locked: skippedLocked,
        locked_divergences: lockedDivergences,
        inplay_warm_missing: inplayWarmMissing,
        missing_posting_links: missingPostingLinks,
      };
    },
  }),

  createContact: defineAction({
    request: contactInput,
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.insert(schema.contacts).values({
        person: args.person, companyRole: args.company_role, channel: args.channel,
        lastContact: args.last_contact, nextTouch: args.next_touch, notes: args.notes, updatedAt: new Date(),
      }).returning({ id: schema.contacts.id });
      const inserted = rows[0];
      if (!inserted) throw new Error("Contact could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateContact: defineAction({
    request: contactInput.extend({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.update(schema.contacts).set({
        person: args.person, companyRole: args.company_role, channel: args.channel,
        lastContact: args.last_contact, nextTouch: args.next_touch, notes: args.notes, updatedAt: new Date(),
      }).where(eq(schema.contacts.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteContact: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.contacts).where(eq(schema.contacts.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
  /**
   * Onboarding questionnaire. One profile row (id 1) holding every answer
   * as a JSON document, so the wizard can save progress step by step and
   * the user can resume where they left off. Finishing (completed: true)
   * is what turns the answers into the tracker's working profile: target
   * titles/lanes for fit scoring, states for the auto-apply scope, and
   * standing answers for application forms — all set by the user here,
   * never guessed.
   */
  getOnboarding: defineAction({
    request: z.object({}),
    response: z.object({
      data: z.record(z.string(), z.unknown()),
      current_step: z.number(),
      completed: z.boolean(),
      updated_at: z.string().nullable(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.onboardingProfiles);
      const row = rows.find((r) => r.id === 1);
      if (!row) return { data: {}, current_step: 0, completed: false, updated_at: null };
      let data: Record<string, unknown> = {};
      try { const parsed: unknown = JSON.parse(row.data); if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>; } catch { data = {}; }
      return { data, current_step: row.currentStep, completed: row.completed === 1, updated_at: row.updatedAt ? row.updatedAt.toISOString() : null };
    },
  }),

  saveOnboarding: defineAction({
    request: z.object({
      data: z.record(z.string(), z.unknown()),
      current_step: z.number().int().min(0).max(20),
      completed: z.boolean(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const serialized = JSON.stringify(args.data).slice(0, 500_000);
      const rows = await db.select().from(schema.onboardingProfiles);
      if (rows.some((r) => r.id === 1)) {
        await db.update(schema.onboardingProfiles).set({ data: serialized, currentStep: args.current_step, completed: args.completed ? 1 : 0, updatedAt: now }).where(eq(schema.onboardingProfiles.id, 1));
      } else {
        await db.insert(schema.onboardingProfiles).values({ id: 1, data: serialized, currentStep: args.current_step, completed: args.completed ? 1 : 0, updatedAt: now });
      }
      // Finishing onboarding also seeds the auto-apply state scope from the
      // locations step, so Settings and the profile never disagree.
      if (args.completed) {
        const states = (args.data as Record<string, unknown>)["states_on"];
        if (Array.isArray(states)) {
          const clean = states.filter((s): s is string => typeof s === "string").map((s) => s.toUpperCase()).slice(0, 60);
          const existing = await db.select().from(schema.trackerSettings);
          if (existing.some((r) => r.id === 1)) {
            await db.update(schema.trackerSettings).set({ autoApplyStates: JSON.stringify(clean), updatedAt: now }).where(eq(schema.trackerSettings.id, 1));
          } else {
            await db.insert(schema.trackerSettings).values({ id: 1, autoApplyStates: JSON.stringify(clean), updatedAt: now });
          }
        }
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
