import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { OnboardingView } from "./Onboarding";

type TrackerData = ApiResponse<typeof api, "listTracker">;
type Application = TrackerData["applications"][number];
type Contact = TrackerData["contacts"][number];
type Draft = TrackerData["drafts"][number];
type DraftStatus = Draft["status"];
type MaintenanceReport = ApiResponse<typeof api, "dailyMaintenance">;
type Stage = Application["stage"];
type Lane = Application["lane"];
type Tab = "onboarding" | "pipeline" | "secondary" | "logins" | "contacts" | "outreach" | "health" | "settings";
type BoardFilter = Stage | "All" | "InPlay" | "ActiveApplications";

/** The best posting link on a card: the employer's own careers posting wins
 * over a job-board (LinkedIn etc.) link whenever both are on file. */
function postingUrlFor(app: Application): string {
  return app.employer_url || app.source_url || "";
}
function postingKindFor(app: Application): "employer" | "board" | "" {
  if (app.employer_url) return "employer";
  if (app.source_url) return "board";
  return "";
}

/** the user's link rule: a card's link is always the employer's own careers
 * page, LinkedIn, or Indeed — never a third-party aggregator, mirror, or
 * agency site. Employer ATS portals (Paylocity, Taleo, Workday,
 * SuccessFactors) count as the employer's own route: they are the
 * employer's hosted application portal, not an aggregator. */
const AGGREGATOR_HOSTS = ["mediabistro.com", "ziprecruiter.com", "glassdoor.com", "simplyhired.com", "talent.com", "jobrapido.com", "adzuna.com", "jora.com", "neuvoo.com", "joblift.com", "whatjobs.com", "jobisjob.com"];
function isThirdPartyLink(app: Application): boolean {
  const url = postingUrlFor(app);
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return AGGREGATOR_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`));
  } catch {
    return false;
  }
}
type FitAnswers = Application["fit_answers"];
type FitSource = Application["fit_source"];

const ACTIVE_STAGES: Stage[] = ["Leads", "Needs Submitting", "Applied", "Interviewing", "Offer"];
const ALL_STAGES: Stage[] = ["Leads", "Needs Submitting", "Applied", "Interviewing", "Offer", "Closed/Rejected"];
const TAGS = ["entry-level", "warm-intro", "verified-live", "specialist", "remote", "priority-company"];
const STALE_MS = 14 * 86_400_000;
const STUCK_PREP_MS = 48 * 3_600_000;
const STAGE_PRIORITY: Record<Stage, number> = { "Needs Submitting": 0, Offer: 1, Interviewing: 2, Applied: 3, Leads: 4, "Closed/Rejected": 5 };
const EMPTY_FIT_ANSWERS: FitAnswers = {
  role_type: "", role_lane_match: "", role_day_to_day: "",
  warm_knows_someone: "", warm_contact_type: "", warm_referral: "", warm_talked: "",
  pay_structure: "", pay_guaranteed: "", pay_covers_gap: "", pay_hours: "",
  fresh_posted_when: "", fresh_verified: "",
  loc_distance: "", loc_work_style: "", loc_relocation: "",
  other_travel_pct: "", other_oncall: "", other_territory_size: "", other_team_size: "",
  other_hiring_manager_known: "", other_deadline: "", other_next_step: "", other_deal_breakers: "", other_notes: "",
};
const EMPTY_APP: Omit<Application, "id" | "created_at" | "updated_at"> = {
  lane: "primary", company: "", role: "", location: "", pay: "", req_id: "", stage: "Leads",
  notes: "", people: "", tags: [], source_url: "",
  employer_url: "", link_status: "unchecked", link_checked_at: null,
  prep_status: "none", submit_url: "", prep_notes: "", prep_requested_at: null, prep_updated_at: null,
  fit_score: null, fit_breakdown: { role: 0, warm: 0, lane: 0, fresh: 0, location: 0 }, fit_notes: "", fit_manual: false,
  fit_answers: { ...EMPTY_FIT_ANSWERS }, fit_source: "auto",
  submitted_at: null, submission_confirmation: "",
};
const EMPTY_DRAFT: Omit<Draft, "id" | "created_at" | "updated_at" | "sent_at" | "status"> = {
  application_id: null, recipient: "", channel: "LinkedIn", purpose: "Follow-up", body: "", recipient_read: "", linkedin_url: "", employer_scope: "",
  candidates: [], selected_candidate: "",
};
const ROLE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "associate", label: "Associate" },
  { value: "css", label: "Specialist" },
  { value: "sales_rep", label: "Full / senior role" },
  { value: "other", label: "Other" },
];
const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" }, { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" }, { code: "DC", name: "District of Columbia" },
];
const DEFAULT_STATES: string[] = []; // Set your states in Onboarding / Settings — the template ships with none selected.
const DRAFT_CHANNELS = ["LinkedIn", "Email", "Text", "Same channel as last time", "Other"];
const DRAFT_PURPOSES = ["Follow-up", "Recruiter reply", "Hiring manager follow-up", "Thank-you", "Check-in", "Interview follow-up", "Other"];
const EMPTY_CONTACT: Omit<Contact, "id" | "created_at" | "updated_at"> = {
  person: "", company_role: "", channel: "", last_contact: "", next_touch: "", notes: "",
};
const FIT_PARTS: { key: "role" | "warm" | "lane" | "fresh" | "location"; label: string; max: number }[] = [
  { key: "role", label: "Role alignment", max: 30 },
  { key: "warm", label: "Warm path", max: 25 },
  { key: "lane", label: "Lane / pay fit", max: 20 },
  { key: "fresh", label: "Freshness", max: 15 },
  { key: "location", label: "Location", max: 10 },
];

const FIT_ANSWER_LABELS: Record<string, string> = {
  associate: "Associate", css: "Specialist", sales_rep: "Full / senior role", other: "Other role type",
  exact: "Exact lane match", adjacent: "Adjacent lane", different: "Different lane",
  very_close: "Very close to what I want", somewhat: "Somewhat close", not_really: "Not really",
  strong: "Yes — strong connection", some: "Yes — someone", none: "No one",
  hiring_manager: "Hiring manager", team_rep: "Rep on the team", recruiter: "Recruiter", other_employee: "Other employee",
  yes: "Yes", maybe: "Maybe / hinted", no: "No",
  multiple: "Yes — multiple talks", once: "Yes — once",
  base_salary: "Base salary", base_plus_commission: "Base + commission", draw: "Draw against commission", pure_commission: "Pure commission", unknown: "Unknown",
  yes_full: "Yes — fully guaranteed", yes_partial: "Yes — partially",
  fully: "Fully covers it", partially: "Partially covers it", not_at_all: "Does not cover it",
  around_40: "~40-hour week", moderate_oncall: "Moderate on-call", heavy_oncall: "Heavy on-call",
  within_week: "Within the last week", one_two_weeks: "1–2 weeks ago", three_four_weeks: "3–4 weeks ago", over_month: "Over a month ago",
  today: "Yes — checked today", this_week: "Yes — checked this week", not_checked: "Not checked yet", closed: "Posting closed",
  local: "Local — near home", in_region: "Elsewhere in my region / state", remote: "Remote", out_of_state: "Out of state",
  hybrid: "Hybrid / flexible", onsite_reasonable: "On-site — reasonable", onsite_heavy: "On-site — 5 days / heavy",
  none_needed: "No relocation needed", required_ok: "Relocation required — I'm OK with it", required_not_ok: "Relocation required — not OK",
};

function fitAnswerLabel(value: string): string {
  if (!value) return "Not answered";
  return FIT_ANSWER_LABELS[value] ?? value;
}

function hasQuestionnaireAnswers(app: Application): boolean {
  const a = app.fit_answers;
  if (!a) return false;
  return Object.values(a).some((v) => typeof v === "string" && v.trim() !== "");
}

function fitSourceLabel(source: FitSource): string {
  if (source === "questionnaire") return "from your questionnaire";
  if (source === "manual") return "set by you";
  if (source === "sweep") return "set by the pipeline sweep";
  return "auto-scored";
}

function isFitLockedApp(app: Application): boolean {
  return app.fit_manual || app.fit_source !== "auto";
}

/** Who the warm path is, cited from the card itself: People first, then a
 * "Warm path:" citation in the fit notes / notes, then the warm-intro tag. */
function warmEvidenceFor(app: Application): string {
  if (app.people.trim()) return app.people.trim();
  const fromFitNotes = app.fit_notes.match(/warm path:\s*(.+)/i)?.[1]?.trim();
  if (fromFitNotes) return fromFitNotes;
  const fromNotes = app.notes.match(/warm path:\s*(.+)/i)?.[1]?.trim();
  if (fromNotes) return fromNotes;
  if (app.tags.map((t) => t.toLowerCase()).includes("warm-intro")) return "warm-intro tag on the card (no person named in the People field yet)";
  return "";
}

function Icon({ name, size = 18 }: { name: "plus" | "search" | "edit" | "trash" | "arrow" | "link" | "x" | "chevron" | "check" | "refresh" | "mail" | "copy" | "send"; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/></>,
    x: <><path d="m6 6 12 12M18 6 6 18"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    check: <path d="M20 6 9 17l-5-5"/>,
    refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    copy: <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function tagClass(tag: string) {
  return `tag tag-${slugify(tag)}`;
}

function tagLabel(tag: string) {
  return tag.replace(/-/g, " ");
}

function isStale(app: Application) {
  return app.stage === "Leads" && Date.now() - new Date(app.updated_at).getTime() > STALE_MS;
}

/** Prep notes often bury the actual to-do under prep history; when the notes
 * carry a "LEFT FOR YOU" section, that's the part you need to see. */
function whatsLeft(notes: string): string {
  const idx = notes.toUpperCase().indexOf("LEFT FOR YOU");
  if (idx < 0) return notes;
  return notes.slice(idx).replace(/^LEFT FOR YOU[:,]?\s*/i, "").trim();
}

function isDeadLead(app: Application): boolean {
  return app.prep_status === "blocked" && /no longer accepting|posting is closed|no longer recruiting|listing is dead/i.test(app.prep_notes);
}

/* ---------- Logins needed: blocked-for-login cards, grouped by portal ----------
 * A card belongs on this list when auto-apply parked it (prep_status blocked)
 * and the recorded reason is a company login/account problem — an account
 * that needs creating, a saved login that was rejected, or a sign-in wall.
 * The list is derived from live card data on every render, so entries appear
 * and disappear as cards get blocked or cleared; nothing here is hardcoded. */
type LoginBlockerType = "login_rejected" | "needs_account" | "sign_in_required";
type LoginRequest = TrackerData["login_requests"][number];

const LOGIN_BLOCKER_LABEL: Record<LoginBlockerType, string> = {
  login_rejected: "Saved login rejected",
  needs_account: "Needs account created",
  sign_in_required: "Sign-in required",
};

function classifyLoginBlocker(app: Application): LoginBlockerType | null {
  if (app.prep_status !== "blocked") return null;
  // The blocker reason lives in prep_notes; the general notes carry history
  // (dashboard checks, portal mentions) that must not false-positive a card
  // whose actual park is something else entirely.
  const text = app.prep_notes;
  if (!/log ?in|sign[- ]?in|account|password|credential|taleo|successfactors|workday|portal/i.test(text)) return null;
  if (isDeadLead(app)) return null;
  if (/login (was )?rejected|saved login|password (was )?(rejected|incorrect|invalid)|invalid (password|credentials|login)|wrong password|credentials (were )?(rejected|invalid)|sign[- ]?in (was )?rejected|rejected.*(login|password)/i.test(text)) return "login_rejected";
  if (/creat(e|ing) (an )?account|account creation|no account|needs? (an )?account|register|sign ?up|new account/i.test(text)) return "needs_account";
  return "sign_in_required";
}

const BOARD_HOSTS_FOR_PORTAL = ["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "simplyhired.com"];
function isBoardHost(host: string): boolean {
  return BOARD_HOSTS_FOR_PORTAL.some((h) => host === h || host.endsWith(`.${h}`));
}
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
/** Prep notes often name the exact portal tenant in prose ("the exact J&J
 * Workday tenant jj.wd5.myworkdayjobs.com/JJ") even when the only link on
 * the card is a LinkedIn posting. Pull that tenant address out — it is the
 * employer's real portal URL, never a reconstructed guess. */
function extractPortalUrlFromText(text: string): string {
  const match = text.match(/([a-z0-9-]+\.)+(myworkdayjobs\.com|taleo\.net|successfactors\.com|successfactors\.eu|icims\.com|greenhouse\.io|lever\.co|ultipro\.com|paylocity\.com|smartrecruiters\.com|ashbyhq\.com|workable\.com|jobvite\.com)(\/[^\s)<>"',]*)?/i);
  return match ? `https://${match[0].replace(/[.)]+$/, "")}` : "";
}

function portalSystemFor(app: Application, host: string): string {
  const hay = `${host} ${app.prep_notes} ${app.company}`.toLowerCase();
  if (hay.includes("myworkdayjobs") || hay.includes("workday")) return "Workday";
  if (hay.includes("taleo")) return "Taleo";
  if (hay.includes("successfactors") || hay.includes("sapsf") || hay.includes("sap success")) return "SuccessFactors";
  if (hay.includes("icims")) return "iCIMS";
  if (hay.includes("greenhouse")) return "Greenhouse";
  if (hay.includes("lever")) return "Lever";
  if (hay.includes("ultipro") || hay.includes("ukg")) return "UKG";
  if (hay.includes("paylocity")) return "Paylocity";
  if (hay.includes("adp")) return "ADP";
  if (hay.includes("smartrecruiters")) return "SmartRecruiters";
  if (hay.includes("ashbyhq")) return "Ashby";
  if (hay.includes("workable")) return "Workable";
  if (hay.includes("jobvite")) return "Jobvite";
  return host ? "Employer portal" : "Employer portal";
}

type LoginPortalGroup = {
  key: string;
  name: string;
  company: string;
  system: string;
  url: string;
  tenantUrl: string;
  blockers: LoginBlockerType[];
  apps: Application[];
};

function loginPortalGroups(apps: Application[]): LoginPortalGroup[] {
  const groups = new Map<string, LoginPortalGroup>();
  for (const app of apps) {
    const blocker = classifyLoginBlocker(app);
    if (!blocker) continue;
    // Portal URL: when the prep notes name the actual portal tenant (the
    // SuccessFactors / Workday / Taleo address where the account lives),
    // that tenant address IS the create-account destination and wins over
    // everything else. Otherwise the employer's own portal link on the
    // card (first non-job-board URL). A LinkedIn/Indeed link is never
    // presented as the portal's create-account page.
    const tenantUrl = extractPortalUrlFromText(app.prep_notes);
    const cardUrls = [app.submit_url, app.employer_url, app.source_url].filter((u) => u.trim() !== "");
    const cardUrl = cardUrls.find((u) => { const h = hostOf(u); return h !== "" && !isBoardHost(h); }) ?? "";
    const rawUrl = tenantUrl || cardUrl;
    const host = rawUrl ? hostOf(rawUrl) : "";
    const system = portalSystemFor(app, host);
    const companySlug = slugify(app.company) || "company";
    const key = host ? `${slugify(system)}:${host}` : `${slugify(system)}:${companySlug}`;
    const existing = groups.get(key);
    if (existing) {
      existing.apps.push(app);
      if (!existing.blockers.includes(blocker)) existing.blockers.push(blocker);
      if (tenantUrl && !existing.tenantUrl) existing.tenantUrl = tenantUrl;
      if (!existing.url && cardUrl) existing.url = cardUrl;
    } else {
      groups.set(key, {
        key,
        name: system === "Employer portal" ? `${app.company} portal` : `${app.company} — ${system}`,
        company: app.company,
        system,
        url: cardUrl,
        tenantUrl,
        blockers: [blocker],
        apps: [app],
      });
    }
  }
  for (const group of groups.values()) {
    if (group.tenantUrl) group.url = group.tenantUrl;
  }
  const severity: Record<LoginBlockerType, number> = { login_rejected: 0, needs_account: 1, sign_in_required: 2 };
  return [...groups.values()].sort((a, b) =>
    Math.min(...a.blockers.map((t) => severity[t])) - Math.min(...b.blockers.map((t) => severity[t]))
    || b.apps.length - a.apps.length
    || a.name.localeCompare(b.name));
}

function fitTier(score: number) {
  if (score >= 75) return "strong";
  if (score >= 55) return "good";
  if (score >= 40) return "fair";
  return "weak";
}

function rank(app: Application) {
  // Board order: highest fit first, unscored last.
  return -(app.fit_score ?? -1);
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function elapsedLabel(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function FitBadge({ app }: { app: Application }) {
  if (app.fit_score === null) return <span className="fit-badge fit-badge-none">Not scored yet</span>;
  const sourceHint = app.fit_source === "questionnaire" ? " (from your questionnaire — locked)" : app.fit_source === "sweep" ? " (set by the pipeline sweep — locked)" : app.fit_manual ? " (your calibrated score — locked)" : "";
  return (
    <span className={`fit-badge fit-${fitTier(app.fit_score)}`} title={`Fit ${app.fit_score}/100${sourceHint}`}>
      Fit {app.fit_score}<span className="fit-outof">/100</span>{isFitLockedApp(app) && <span className="fit-manual-dot" aria-label="Locked score — protected from auto-scoring">•</span>}{app.fit_source === "questionnaire" && <span className="fit-q-badge">Q</span>}{app.fit_source === "sweep" && <span className="fit-q-badge" aria-label="Sweep score">S</span>}
    </span>
  );
}

function QuestionnaireSummary({ app }: { app: Application }) {
  const a = app.fit_answers;
  if (!hasQuestionnaireAnswers(app)) return null;
  const rows: { label: string; value: string }[] = [];
  if (a.role_type) rows.push({ label: "Role type", value: fitAnswerLabel(a.role_type) });
  if (a.warm_knows_someone) rows.push({ label: "Warm path", value: `${fitAnswerLabel(a.warm_knows_someone)}${a.warm_contact_type ? ` · ${fitAnswerLabel(a.warm_contact_type)}` : ""}${a.warm_referral ? ` · referral: ${fitAnswerLabel(a.warm_referral)}` : ""}` });
  if (a.pay_structure) rows.push({ label: "Pay", value: `${fitAnswerLabel(a.pay_structure)}${a.pay_covers_gap ? ` · covers gap: ${fitAnswerLabel(a.pay_covers_gap)}` : ""}` });
  if (a.fresh_verified) rows.push({ label: "Verified live", value: fitAnswerLabel(a.fresh_verified) });
  if (a.loc_distance) rows.push({ label: "Location", value: fitAnswerLabel(a.loc_distance) });
  if (a.other_deal_breakers) rows.push({ label: "Deal-breakers", value: a.other_deal_breakers });
  if (a.other_next_step) rows.push({ label: "Next step", value: a.other_next_step });
  if (rows.length === 0) return null;
  return (
    <div className="fit-answers-summary">
      <p className="fit-answers-head">Your questionnaire answers</p>
      {rows.map((row) => (
        <p key={row.label} className="fit-answer-row"><strong>{row.label}:</strong> {row.value}</p>
      ))}
    </div>
  );
}

function FitBreakdown({ app, onQuestionnaire, onShowGuide }: { app: Application; onQuestionnaire?: (app: Application) => void; onShowGuide?: () => void }) {
  if (app.fit_score === null && app.stage === "Closed/Rejected") {
    return (
      <div className="fit-breakdown">
        <p className="fit-unscored">Closed — not scored. Fit scoring covers active cards only, so archived cards stay unscored on purpose.</p>
      </div>
    );
  }
  if (app.fit_score === null) {
    return (
      <div className="fit-breakdown">
        <p className="fit-unscored">No fit score yet. Run the health check (or wait for the daily run) and this card gets scored on the rubric — or answer the questionnaire and set the score from what you actually know.</p>
        <div className="fit-actions-row">
          {onQuestionnaire && <button type="button" className="fit-action-button" onClick={() => onQuestionnaire(app)}>Rate fit with questionnaire</button>}
          {onShowGuide && <button type="button" className="fit-action-button fit-action-secondary" onClick={onShowGuide}>How fit scoring works</button>}
        </div>
      </div>
    );
  }
  return (
    <div className="fit-breakdown">
      <p className="fit-breakdown-head">Fit {app.fit_score}/100 — {fitSourceLabel(app.fit_source)}{app.fit_source !== "auto" ? " · protected from auto-scoring" : ""}</p>
      {FIT_PARTS.map((part) => (
        <div key={part.key} className="fit-row">
          <span className="fit-row-label">{part.label}</span>
          <span className="fit-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (app.fit_breakdown[part.key] / part.max) * 100)}%` }}/></span>
          <span className="fit-row-value">{app.fit_breakdown[part.key]}/{part.max}</span>
        </div>
      ))}
      {app.fit_breakdown.warm > 0 ? (
        <p className="fit-warm-evidence"><strong>Warm path {app.fit_breakdown.warm}/25 — evidence:</strong> {warmEvidenceFor(app) || "no citation on this card yet — add who the warm path is in People or the fit notes so this subscore is explainable."}</p>
      ) : (
        <p className="fit-warm-gap"><strong>Warm path 0/25 — data gap, not a verdict.</strong> No warm-path evidence is on this card yet (the People field is empty and there&rsquo;s no warm-intro tag), so auto-scoring can&rsquo;t see a path in. It does <em>not</em> mean you don&rsquo;t have one — add who your contact is in People, or answer the questionnaire, and this subscore updates. Locked scores (sweep, questionnaire, yours) are never overwritten by the daily re-score.</p>
      )}
      {app.fit_notes && <p className="fit-notes"><strong>Calibration:</strong> {app.fit_notes}</p>}
      <QuestionnaireSummary app={app} />
      <div className="fit-actions-row">
        {onQuestionnaire && <button type="button" className="fit-action-button" onClick={() => onQuestionnaire(app)}>{hasQuestionnaireAnswers(app) ? "Edit questionnaire answers" : "Rate fit with questionnaire"}</button>}
        {onShowGuide && <button type="button" className="fit-action-button fit-action-secondary" onClick={onShowGuide}>Full fit guide</button>}
      </div>
    </div>
  );
}

function derivedLinkVerdict(app: Application): { status: "live" | "dead"; when: string } | null {
  if (app.link_status !== "unchecked") return null;
  const text = `${app.notes} ${app.prep_notes}`;
  const tags = app.tags.map((t) => t.toLowerCase());
  const isoDate = text.match(/(?:checked|verified)[^\d]*(20\d{2}-\d{2}-\d{2})/i)?.[1];
  const when = isoDate ? new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  if (tags.includes("dead") || /\bmarked dead\b|\bposting (is )?dead\b|DEAD\s*[—-]\s*checked/i.test(text)) return { status: "dead", when };
  if (/verified live/i.test(text)) return { status: "live", when };
  return null;
}

function LinkStatusBadge({ app }: { app: Application }) {
  if (app.stage === "Closed/Rejected") return null;
  if (isThirdPartyLink(app)) return <span className="link-badge link-dead" title="Link rule: cards link only to the employer's own careers page, LinkedIn, or Indeed">Third-party link — replace with employer / LinkedIn / Indeed</span>;
  const derived = derivedLinkVerdict(app);
  const effStatus = app.link_status !== "unchecked" ? app.link_status : derived?.status ?? "unchecked";
  const when = app.link_checked_at ? new Date(app.link_checked_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : derived?.when ?? "";
  if (effStatus === "live") return <span className="link-badge link-live" title={`Employer posting verified live${when ? ` on ${when}` : ""} — posting liveness only; for roles you applied to, application status is verified separately (e.g. the employer's applicant dashboard)`}>● Live{when ? ` · checked ${when}` : ""}</span>;
  if (effStatus === "dead") return <span className="link-badge link-dead" title={`Employer posting confirmed gone${when ? ` on ${when}` : ""}`}>● Posting dead{when ? ` · checked ${when}` : ""} — your call to archive</span>;
  if (!postingUrlFor(app)) return <span className="link-badge link-missing">No posting link — add one to verify</span>;
  return <span className="link-badge link-unchecked">Link on file · not yet verified on employer site</span>;
}

function CardBody({ app }: { app: Application }) {
  return (
    <>
      <div className="card-topline"><span className="company">{app.company}</span><span className="req">{app.req_id ? `#${app.req_id}` : ""}</span></div>
      <h3>{app.role}</h3>
      <p className="location">{app.location || "Location TBD"}</p>
      {app.pay && <p className="pay">{app.pay}</p>}
      {app.submitted_at && <p className="confirmed-line">Confirmed ✔️</p>}
      <div className="fit-line"><FitBadge app={app}/>{isStale(app) && <span className="stale-badge">stale — reverify</span>}</div>
      <div className="link-line"><LinkStatusBadge app={app}/></div>
      {app.tags.length > 0 && (
        <div className="tag-row">
          {app.tags.map((tag) => <span key={tag} className={tagClass(tag)}>{tagLabel(tag)}</span>)}
        </div>
      )}
    </>
  );
}

function PrepSection({ app, onResetPrep, onEdit }: {
  app: Application;
  onResetPrep: (id: number) => void;
  onEdit: (app: Application) => void;
}) {
  // A blocked prep reason must never hide just because the card moved stages.
  if (app.prep_status === "blocked" && app.stage !== "Leads" && app.stage !== "Needs Submitting" && app.stage !== "Closed/Rejected") {
    return (
      <div className="prep-blocked">
        <p className="prep-blocked-label">Parked — auto-apply hit a snag</p>
        <p className="prep-blocked-notes">{app.prep_notes || "No reason was recorded for this block. Open Edit to add what stopped it."}</p>
        <div className="prep-queue-actions">
          <button type="button" className="prep-cancel-button" onClick={() => onResetPrep(app.id)}>Dismiss</button>
        </div>
      </div>
    );
  }
  if (app.stage === "Needs Submitting") {
    const finishUrl = app.submit_url || app.employer_url || app.source_url;
    return (
      <div className="prep-submit-box">
        {app.prep_notes ? (
          <>
            <p className="prep-submit-label">What&rsquo;s left for you:</p>
            <p className="prep-submit-notes">{whatsLeft(app.prep_notes)}</p>
          </>
        ) : (
          <p className="prep-submit-notes">This one is parked here because a step needs you first (an account, a consent question, or an answer only you can give). Clear that step and your assistant submits it under your auto-apply grant, or open it and finish it yourself.</p>
        )}
        {(() => {
          const caveat = `${app.prep_notes} ${app.notes}`.match(/[^.]*I’m Interested[^.]*\./)?.[0]?.trim() ?? (`${app.prep_notes} ${app.notes}`.match(/[^.]*I'm Interested[^.]*\./)?.[0]?.trim() ?? "");
          return caveat ? <p className="prep-blocked-notes"><strong>Heads up:</strong> {caveat} An &ldquo;I&rsquo;m Interested&rdquo; click is never a submitted application.</p> : null;
        })()}
        {finishUrl ? (
          <a className="prep-submit-cta" href={finishUrl} target="_blank" rel="noreferrer">
            {app.submit_url ? "Open & finish application" : "Open posting to finish"} <Icon name="arrow" size={15}/>
          </a>
        ) : (
          <div className="prep-missing-link">
            <p><strong>No finish link on file.</strong> This card was moved to Needs Submitting without an application or posting link, so there&rsquo;s nothing to open. Add the link and this button comes back.</p>
            <button type="button" className="prep-retry-button" onClick={() => onEdit(app)}>Add the link</button>
          </div>
        )}
      </div>
    );
  }
  if (app.stage === "Leads" && app.tags.map((t) => t.toLowerCase()).includes("location-excluded")) {
    return <p className="autoapply-status">Location-excluded — outside your approved location set, so this card is never queued for prep or auto-apply. Not deleted; removing it is your call.</p>;
  }
  if (app.stage !== "Leads") return null;
  if (app.prep_status === "none") {
    // No manual prep button anymore: with auto-apply on, the daily sweep
    // queues passing leads itself (via the same requestPrep action). This
    // line is status only — what happens next, in health-panel language.
    return (
      <p className="autoapply-status">
        {app.link_status === "dead"
          ? "Auto-apply: not queued — this posting is marked dead. Archiving it is your call."
          : postingUrlFor(app)
            ? "Auto-apply: on — the daily sweep queues leads that pass the gates; nothing for you to tap here."
            : "Auto-apply: waiting on a posting link — add the employer posting link and the sweep can queue this lead."}
      </p>
    );
  }
  if (app.prep_status === "requested" || app.prep_status === "in_progress") {
    const since = app.prep_updated_at ?? app.prep_requested_at;
    const stuck = since ? Date.now() - new Date(since).getTime() > STUCK_PREP_MS : false;
    return (
      <div className={`prep-queue-box ${stuck ? "prep-queue-stuck" : ""}`}>
        <p className="prep-queue-status">
          {app.prep_status === "requested" ? "Auto-apply: queued" : "Auto-apply: in progress"}
          {since && <span> · queued {formatWhen(app.prep_requested_at ?? since)} ({elapsedLabel(since)})</span>}
        </p>
        {stuck ? (
          <p className="prep-queue-note">This has been waiting over 48 hours with no pickup — that&rsquo;s the stall you hit before. The daily health check flags it and recovers it automatically; no tap needed from you.</p>
        ) : (
          <p className="prep-queue-note">your assistant picks queued applications up on the daily sweep. If nothing moves in 48 hours, the health check flags it here instead of letting it sit silently.</p>
        )}
        <div className="prep-queue-actions">
          <button type="button" className="prep-cancel-button" onClick={() => onResetPrep(app.id)}>Cancel queued application</button>
        </div>
      </div>
    );
  }
  if (app.prep_status === "blocked") {
    return (
      <div className="prep-blocked">
        <p className="prep-blocked-label">{isDeadLead(app) ? "Parked — posting looks dead" : "Parked — needs a step only you can do"}</p>
        {app.prep_notes ? (
          <p className="prep-blocked-notes">{app.prep_notes}</p>
        ) : (
          <p className="prep-blocked-notes">No reason was recorded for this park — that&rsquo;s a tracking gap, not your move. Add the posting link in Edit if this card doesn&rsquo;t have one, or Dismiss if you&rsquo;ve already handled it another way.</p>
        )}
        {isDeadLead(app) && <p className="prep-blocked-notes"><strong>Your call:</strong> if the posting is really gone, move this card to Closed/Rejected to archive it — nothing archives itself.</p>}
        {/Prep my application/i.test(app.prep_notes) && <p className="prep-blocked-notes"><strong>Updated flow:</strong> there&rsquo;s no Prep button anymore — add the posting link in Edit and the daily sweep re-queues this card automatically.</p>}
        <div className="prep-queue-actions">
          <button type="button" className="prep-cancel-button" onClick={() => onResetPrep(app.id)}>Dismiss</button>
        </div>
      </div>
    );
  }
  if (app.prep_status === "done") {
    return <p className="autoapply-status">Auto-apply: prepped — see the card&rsquo;s stage for what&rsquo;s next.</p>;
  }
  return null;
}

function AppCard({ app, onEdit, onDelete, onMove, onResetPrep, onQuestionnaire, onShowGuide }: {
  app: Application;
  onEdit: (app: Application) => void;
  onDelete: (app: Application) => void;
  onMove: (id: number, stage: Stage) => void;
  onResetPrep: (id: number) => void;
  onQuestionnaire?: (app: Application) => void;
  onShowGuide?: () => void;
}) {
  const index = ALL_STAGES.indexOf(app.stage);
  return (
    <article
      className="job-card"
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/application-id", String(app.id))}
    >
      {postingUrlFor(app) && !isThirdPartyLink(app) ? (
        <a
          className="job-posting-link"
          href={postingUrlFor(app)}
          target="_blank"
          rel="noreferrer"
          draggable={false}
          aria-label={`Open ${app.company} ${app.role} job posting`}
        >
          <CardBody app={app} />
          <span className="posting-cta">{postingKindFor(app) === "employer" ? "Employer posting" : "View posting"} <Icon name="arrow" size={14}/></span>
        </a>
      ) : (
        <div className="job-posting-missing">
          <CardBody app={app} />
          <button type="button" className="missing-link-button" onClick={() => onEdit(app)}>{isThirdPartyLink(app) ? "Replace with employer / LinkedIn / Indeed link" : "Add posting link"}</button>
        </div>
      )}
      <PrepSection app={app} onResetPrep={onResetPrep} onEdit={onEdit}/>
      <details>
        <summary>Details &amp; fit</summary>
        <FitBreakdown app={app} onQuestionnaire={onQuestionnaire} onShowGuide={onShowGuide}/>
        {app.submitted_at && (
          <p className="submitted-line"><strong>Submitted {formatWhen(app.submitted_at)}</strong> — Confirmed ✔️</p>
        )}
        {app.notes && <p className="notes-text">{app.notes}</p>}
        {app.people && <p className="people"><strong>Connections:</strong> {app.people}</p>}
        {!app.notes && !app.people && <p className="notes-text">No notes yet — open the card to add context.</p>}
      </details>
      <div className="card-actions">
        <div className="move-actions">
          <button disabled={index <= 0} onClick={() => onMove(app.id, ALL_STAGES[index - 1] ?? app.stage)} aria-label={`Move ${app.company} backward`}><Icon name="chevron" size={16}/></button>
          <button disabled={index >= ALL_STAGES.length - 1} onClick={() => onMove(app.id, ALL_STAGES[index + 1] ?? app.stage)} aria-label={`Move ${app.company} forward`}><Icon name="arrow" size={16}/></button>
        </div>
        <div className="utility-actions">
          {postingUrlFor(app) && !isThirdPartyLink(app) && <a className="icon-button" href={postingUrlFor(app)} target="_blank" rel="noreferrer" aria-label={`Open source for ${app.company}`}><Icon name="link" size={16}/></a>}
          <button className="icon-button" onClick={() => onEdit(app)} aria-label={`Edit ${app.company}`}><Icon name="edit" size={16}/></button>
          <button className="icon-button danger" onClick={() => onDelete(app)} aria-label={`Delete ${app.company}`}><Icon name="trash" size={16}/></button>
        </div>
      </div>
    </article>
  );
}

function StageColumn({ stage, apps, onEdit, onDelete, onMove, onResetPrep, onQuestionnaire, onShowGuide }: {
  stage: Stage; apps: Application[]; onEdit: (app: Application) => void; onDelete: (app: Application) => void; onMove: (id: number, stage: Stage) => void; onResetPrep: (id: number) => void; onQuestionnaire?: (app: Application) => void; onShowGuide?: () => void;
}) {
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData("text/application-id"));
    if (Number.isFinite(id)) onMove(id, stage);
  }
  return (
    <section className={`stage-column stage-col-${slugify(stage)}`} onDragOver={(event) => event.preventDefault()} onDrop={drop} aria-label={`${stage} stage`}>
      <header><h2>{stage}</h2><span>{apps.length}</span></header>
      <div className="stage-stack">
        {apps.map((app) => <AppCard key={app.id} app={app} onEdit={onEdit} onDelete={onDelete} onMove={onMove} onResetPrep={onResetPrep} onQuestionnaire={onQuestionnaire} onShowGuide={onShowGuide}/>)}
        {apps.length === 0 && <div className="empty-column">Drop a card here</div>}
      </div>
    </section>
  );
}

function HealthPanel({ apps, contacts, drafts, report, running, onRun, onShowGuide }: {
  apps: Application[];
  contacts: Contact[];
  drafts: Draft[];
  report: MaintenanceReport | null;
  running: boolean;
  onRun: () => void;
  onShowGuide?: () => void;
}) {
  const draftsWaiting = drafts.filter((draft) => draft.status === "draft");
  const draftsApproved = drafts.filter((draft) => draft.status === "approved");
  const active = apps.filter((app) => app.stage !== "Closed/Rejected");
  const queued = active.filter((app) => app.prep_status === "requested" || app.prep_status === "in_progress");
  const stuck = queued.filter((app) => {
    const since = app.prep_updated_at ?? app.prep_requested_at;
    return since ? Date.now() - new Date(since).getTime() > STUCK_PREP_MS : false;
  });
  const blocked = active.filter((app) => app.prep_status === "blocked");
  const missingFinish = active.filter((app) => app.stage === "Needs Submitting" && !app.submit_url.trim() && !app.employer_url.trim() && !app.source_url.trim());
  const thirdPartyLinks = active.filter((app) => isThirdPartyLink(app));
  const linkDead = active.filter((app) => app.link_status === "dead");
  const linkUnchecked = active.filter((app) => app.link_status === "unchecked" && postingUrlFor(app));
  const unscored = active.filter((app) => app.fit_score === null);
  const dupGroups = (() => {
    const map = new Map<string, Application[]>();
    for (const app of active) {
      const key = `${app.company.toLowerCase()}|${app.role.toLowerCase()}|${app.req_id.trim().toLowerCase()}`;
      map.set(key, [...(map.get(key) ?? []), app]);
    }
    return [...map.values()].filter((list) => list.length > 1);
  })();
  const dupContactNames = (() => {
    const counts = new Map<string, number>();
    for (const contact of contacts) counts.set(contact.person.trim().toLowerCase(), (counts.get(contact.person.trim().toLowerCase()) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => contacts.find((c) => c.person.trim().toLowerCase() === name)?.person ?? name);
  })();
  const staleLeads = active.filter((app) => isStale(app));
  const deadPostingLeads = active.filter((app) => app.stage === "Leads" && (app.link_status === "dead" || isDeadLead(app)));
  const sweepDrift = active.filter((app) => {
    if (app.fit_score === null) return false;
    const match = app.notes.match(/FIT SCORE:\s*(\d{1,3})/i);
    return match ? Math.abs(Number(match[1]) - app.fit_score) >= 5 : false;
  }).map((app) => ({ app, sweep: Number(app.notes.match(/FIT SCORE:\s*(\d{1,3})/i)?.[1] ?? 0) }));
  const lockedApps = active.filter((app) => isFitLockedApp(app));
  const lockedDivergences = report?.locked_divergences ?? [];
  const inplayWarmMissing = active.filter((app) => (app.stage === "Applied" || app.stage === "Interviewing" || app.stage === "Offer") && !app.people.trim() && app.fit_breakdown.warm === 0);
  const leadsMissingPosting = active.filter((app) => app.stage === "Leads" && !app.source_url.trim());
  const blankContacts = contacts.filter((contact) => !contact.company_role.trim() && !contact.channel.trim());

  // NEEDS YOUR CALL — only items that genuinely require the user: a merge/delete
  // decision, a blocked step only he can clear, a missing link only he can
  // supply, or a draft only he can approve. Everything auto-fixable is fixed
  // by the check itself and never lands here.
  const needsCall: string[] = [];
  for (const group of dupGroups) {
    needsCall.push(`${group[0]?.company} — “${group[0]?.role}” is on ${group.length} cards (${group.map((a) => `#${a.id}`).join(", ")}). Your call: keep one card and delete or merge the spare — the check never deletes cards on its own.`);
  }
  for (const name of dupContactNames) {
    needsCall.push(`“${name}” appears twice in Key Contacts. Your call: keep one entry and delete the other.`);
  }
  // Blocked cards split by their recorded reason: dead postings are the
  // check's auto-archive case and missing-link parks resolve themselves once
  // a link lands on the card — neither is the user's call. Only a park whose
  // reason is genuinely theirs (a sign-in, an approval, a consent question, an
  // answer only he can give) lands in Needs your call, stated with the
  // card's actual reason.
  const blockedDead = blocked.filter((app) => isDeadLead(app));
  const blockedNoLink = blocked.filter((app) => !isDeadLead(app) && !postingUrlFor(app));
  const blockedUser = blocked.filter((app) => !isDeadLead(app) && postingUrlFor(app));
  for (const app of blockedUser) {
    const reason = app.prep_notes.replace(/^Blocked:\s*/i, "").split(/(?<=[.!])\s/)[0]?.trim() ?? "";
    const shortReason = reason.length > 170 ? reason.slice(0, 170).trimEnd() + "…" : reason;
    needsCall.push(`${app.company} (${app.role}) is parked${shortReason ? `: ${shortReason}` : " — the reason is on the card."} Your call: open the card and clear that step, or dismiss the park.`);
  }
  for (const app of missingFinish) {
    needsCall.push(`${app.company} (${app.role}) is in Needs Submitting with no application link, so it can't be finished. Your call: add the link on the card, or move the card back if you're not applying.`);
  }
  if (draftsWaiting.length > 0) {
    needsCall.push(`${draftsWaiting.length} outreach draft${draftsWaiting.length === 1 ? "" : "s"} (${draftsWaiting.map((d) => d.recipient).join(", ")}) waiting in the Outreach tab. Your call: approve the exact text there, edit it, or drop it — nothing sends without you.`);
  }

  // FOR INFORMATION — status lines only; no action implied or needed.
  const info: string[] = [];
  info.push(queued.length === 0
    ? "Prep queue is empty — nothing is waiting for auto-apply to pick up."
    : stuck.length > 0
      ? `${queued.length} prep${queued.length === 1 ? "" : "s"} queued; ${stuck.length} ha${stuck.length === 1 ? "s" : "ve"} been waiting over 48 hours — running the check un-sticks ${stuck.length === 1 ? "it" : "them"} automatically.`
      : `${queued.length} prep${queued.length === 1 ? "" : "s"} queued, all inside the 48-hour pickup window.`);
  info.push(unscored.length === 0
    ? `Fit scores: all ${active.length} active cards are scored out of 100.`
    : `Fit scores: ${unscored.length} active card${unscored.length === 1 ? "" : "s"} unscored — running the check scores ${unscored.length === 1 ? "it" : "them"} automatically.`);
  const blockedDeadBeyondLeads = blockedDead.filter((app) => app.stage !== "Leads");
  if (blockedDeadBeyondLeads.length > 0) info.push(`${blockedDeadBeyondLeads.map((a) => `${a.company} (${a.role})`).join("; ")} ${blockedDeadBeyondLeads.length === 1 ? "is" : "are"} parked on a dead posting past the lead stage — the check leaves ${blockedDeadBeyondLeads.length === 1 ? "it" : "them"} in place.`);
  if (blockedNoLink.length > 0) info.push(`${blockedNoLink.map((a) => `${a.company} (${a.role})`).join("; ")} ${blockedNoLink.length === 1 ? "is" : "are"} parked because no posting link is on file — once a link lands on the card, the sweep re-queues ${blockedNoLink.length === 1 ? "it" : "them"} automatically.`);
  if (deadPostingLeads.length > 0) info.push(`${deadPostingLeads.length} lead${deadPostingLeads.length === 1 ? "" : "s"} sitting on a verified-dead posting (${deadPostingLeads.map((a) => a.company).join(", ")}) — running the check archives ${deadPostingLeads.length === 1 ? "it" : "them"} to Closed/Rejected automatically.`);
  if (staleLeads.length > 0) info.push(`${staleLeads.length} lead${staleLeads.length === 1 ? "" : "s"} untouched for 14+ days (${staleLeads.slice(0, 6).map((a) => a.company).join(", ")}${staleLeads.length > 6 ? `, +${staleLeads.length - 6} more` : ""}) — each carries a “stale — reverify” badge on its card.`);
  if (leadsMissingPosting.length > 0) info.push(`${leadsMissingPosting.length} lead${leadsMissingPosting.length === 1 ? "" : "s"} ha${leadsMissingPosting.length === 1 ? "s" : "ve"} no posting link yet, so auto-apply can't queue ${leadsMissingPosting.length === 1 ? "it" : "them"} until a link lands on the card.`);
  info.push(thirdPartyLinks.length === 0 && linkDead.length === 0 && linkUnchecked.length === 0
    ? "Posting links: every active card follows the link rule and has been verified."
    : `Posting links: ${thirdPartyLinks.length} third-party aggregator link${thirdPartyLinks.length === 1 ? "" : "s"} on file, ${linkDead.length} posting${linkDead.length === 1 ? "" : "s"} marked dead, ${linkUnchecked.length} link${linkUnchecked.length === 1 ? "" : "s"} not yet verified on the employer site.`);
  if (sweepDrift.length > 0) info.push(`Score drift: ${sweepDrift.map(({ app, sweep }) => `${app.company} — sweep scored ${sweep}, tracker says ${app.fit_score}`).join("; ")}. Locked scores are never overwritten; the check only notes the gap.`);
  info.push(lockedApps.length === 0
    ? "Locked fit scores: none yet — scores set by the sweep, your questionnaire, or your manual override lock automatically and are never overwritten."
    : `Locked fit scores: ${lockedApps.length} on file (sweep, questionnaire, or your override). The check never overwrites them${lockedDivergences.length > 0 ? `; the last check flagged ${lockedDivergences.length} where the rubric disagrees by 5+ points (${lockedDivergences.map((d) => `${d.company} — locked ${d.locked_score} vs rubric ${d.auto_score}`).join("; ")}) — the locked score stands` : ""}.`);
  if (inplayWarmMissing.length > 0) info.push(`Warm path: ${inplayWarmMissing.map((a) => `${a.company} (${a.role})`).join("; ")} ${inplayWarmMissing.length === 1 ? "is" : "are"} in play with no contact named on the card, so auto-scoring can't see a path in — that's a data gap, not a verdict.`);
  if (blankContacts.length > 0) info.push(`Key contacts: ${blankContacts.map((c) => c.person).join(", ")} ${blankContacts.length === 1 ? "has" : "have"} no company/role or channel on file yet.`);
  if (draftsApproved.length > 0) info.push(`Outreach: ${draftsApproved.length} draft${draftsApproved.length === 1 ? "" : "s"} approved and ready for you to send from the Outreach tab whenever you choose.`);

  const fixedBits: string[] = [];
  if (report) {
    if (report.scored > 0) fixedBits.push(`re-scored ${report.scored} card${report.scored === 1 ? "" : "s"}`);
    if (report.archived_dead_leads.length > 0) fixedBits.push(`archived ${report.archived_dead_leads.length} dead lead${report.archived_dead_leads.length === 1 ? "" : "s"} (${report.archived_dead_leads.map((a) => a.company).join(", ")}) to Closed/Rejected`);
    if (report.recovered_preps.length > 0) fixedBits.push(`moved ${report.recovered_preps.length} stuck prep${report.recovered_preps.length === 1 ? "" : "s"} (waiting 48+ hours) into blocked with the reason recorded on the card (${report.recovered_preps.map((r) => `${r.company}, ${r.waiting_hours}h`).join("; ")})`);
    if (report.refreshed_links.length > 0) fixedBits.push(`refreshed ${report.refreshed_links.length} stale link status${report.refreshed_links.length === 1 ? "" : "es"} (${report.refreshed_links.map((r) => `${r.company} → ${r.to_status}`).join("; ")})`);
  }

  return (
    <section className="health-panel" aria-label="System health">
      <div className="health-head">
        <div>
          <p className="health-kicker">System health</p>
          <h2>Health check &amp; auto-fix</h2>
        </div>
      </div>
      <p className="health-intro">This check also runs automatically every morning on a schedule — this button just runs it right now. When it runs, it checks the whole board and fixes everything it safely can on its own. Whatever is left is split below into the few things that need your call and everything else, which is just for information.</p>
      <button type="button" className="health-run-button" onClick={onRun} disabled={running}>
        <Icon name="refresh" size={16}/> {running ? "Running system health check…" : "Run system health check"}
      </button>
      {report && (
        <div className="health-report" role="status">
          <p><strong>Last check {formatWhen(report.ran_at)} — what was checked:</strong> {report.total_active} active cards — fit scores, posting links, the prep queue, duplicates, and outreach drafts.</p>
          <p><strong>Fixed automatically:</strong> {fixedBits.length > 0 ? fixedBits.join("; ") + "." : "nothing needed fixing this time."}</p>
          <p><strong>What remains:</strong> {needsCall.length > 0 ? `${needsCall.length} item${needsCall.length === 1 ? "" : "s"} below need your call; everything else is listed for information.` : "nothing needs your call — the rest below is for information only."}</p>
          {report.needs_submitting_missing_link.length > 0 && (
            <p>Still missing a finish link: {report.needs_submitting_missing_link.map((m) => `${m.company} — ${m.role}`).join("; ")}.</p>
          )}
        </div>
      )}
      <h3 className="health-group-head">Needs your call{needsCall.length > 0 ? ` (${needsCall.length})` : ""}</h3>
      {needsCall.length === 0 ? (
        <p className="health-clear">Nothing needs your call right now — the check handles the rest itself.</p>
      ) : (
        <ul className="health-list">
          {needsCall.map((line, i) => (
            <li key={i} className="warn"><Icon name="x" size={14}/><span>{line}</span></li>
          ))}
        </ul>
      )}
      <h3 className="health-group-head">For information</h3>
      <ul className="health-list">
        {info.map((line, i) => (
          <li key={i}><Icon name="check" size={14}/><span>{line}</span></li>
        ))}
      </ul>
      <details className="fit-legend">
        <summary>How the fit score works — full instructions</summary>
        <div className="fit-guide-inline">
          <p><strong>What the score is:</strong> Every role gets a 0–100 fit score. 75+ is a strong fit, 55–74 is good, 40–54 is fair, under 40 is weak. It&rsquo;s a prioritization tool — not a prediction. It answers &ldquo;where should I spend my limited time first?&rdquo;</p>
          <p><strong>How cards sort:</strong> Inside each stage column, cards sort highest fit first. The &ldquo;Next up&rdquo; spotlight picks by stage urgency first (Needs Submitting, then Offer, Interviewing, Applied, Leads), then by fit score. A higher fit score literally moves a card up the board.</p>
          <h4>The 5 dimensions</h4>
          <ul>
            <li><strong>Role alignment — 30 pts.</strong> Is this the exact job you&rsquo;re targeting? Your exact target roles score highest, specialist roles next, then full / senior versions of the role. It also rewards matching your lane (elective vs trauma, J&amp;J family) and day-to-day work that&rsquo;s close to what you actually want to do.</li>
            <li><strong>Warm path — 25 pts.</strong> Do you have a real human path in? Knowing the hiring manager, a rep on the team, or a recruiter — and especially having someone who offered to refer you or forward your resume, or who you&rsquo;ve already talked to — is the single biggest lever in this job search. That&rsquo;s why it&rsquo;s weighted second-highest. Auto-scoring can miss this (it only sees tags and the People field), which is why the questionnaire exists.</li>
            <li><strong>Lane / pay fit — 20 pts.</strong> Does the money and the life work? Base salary beats draw, draw beats pure commission. Guaranteed pay matters, whether it covers your monthly nut and your move-out gap matters more, and a ~40-hour week scores higher than heavy on-call for your goals.</li>
            <li><strong>Freshness — 15 pts.</strong> Is this posting actually alive? Recently posted and verified-still-open on the employer board scores high. Stale, unchecked, or closed postings decay — you don&rsquo;t want to prep hard for a dead req.</li>
            <li><strong>Location — 10 pts.</strong> Where is the territory and what does it demand? Local roles score highest, elsewhere in your region next, remote after that. Heavy on-site or a relocation you don&rsquo;t want pulls it down.</li>
          </ul>
          <h4>Four ways a score gets set — one writer per score</h4>
          <ul>
            <li><strong>Auto-scored (default):</strong> The tracker reads what&rsquo;s on the card — role title, tags, People field, pay text, location, and how recently the card was touched — and applies the rubric above. The health check re-scores auto cards only. It&rsquo;s fast, but it underrates warm paths it can&rsquo;t see — a warm-path 0 from auto-scoring means no evidence is on the card, not that you have no path in.</li>
            <li><strong>Pipeline sweep (locked):</strong> When your assistant&rsquo;s daily sweep scores a card from people evidence — who your warm path actually is — that score is locked under the single-writer rule. Warm-path points must cite who the warm path is (People field or a &ldquo;Warm path:&rdquo; note). The check never overwrites a sweep score; if the rubric would land more than 5 points away, the divergence is noted above and the sweep score stands.</li>
            <li><strong>Questionnaire (recommended when you know more):</strong> Open any card → Details &amp; fit → &ldquo;Rate fit with questionnaire.&rdquo; Answer one short section per dimension plus a few other helpful questions (travel %, on-call, territory size, team size, hiring manager, deadline, next step, deal-breakers). Your answers compute the score + breakdown, both are saved on the card so the rating is explainable, and the score is protected — the check will <em>not</em> overwrite it.</li>
            <li><strong>Manual override + calibration note:</strong> Open the card → Edit → &ldquo;Your fit score&rdquo; + &ldquo;Fit calibration note.&rdquo; Type any 0–100 number and why. That number also sticks and is never overwritten by auto-scoring. Clear the field (leave it blank) to hand the card back to auto-scoring. Use the note to record the &ldquo;why&rdquo; — e.g. &ldquo;Warm path is real: Mike B forwarded my resume to Batista.&rdquo;</li>
          </ul>
          <p><strong>Which should you use?</strong> Let auto-scoring triage brand-new leads. As soon as you learn something the card can&rsquo;t show — a real contact, a pay detail, a verified posting — answer the questionnaire (2 minutes, most accurate) or drop a manual override with a note (10 seconds, fastest). Both protect the score.</p>
          {onShowGuide && <button type="button" className="fit-guide-open-button" onClick={onShowGuide}>Open the full fit guide</button>}
        </div>
      </details>
    </section>
  );
}

function CommandCenter({ apps, contactCount, draftsWaiting, onEdit, onShowDrafts, activeFilter, onFilter, onShowContacts, slim }: {
  apps: Application[]; contactCount: number; draftsWaiting: number; onEdit: (app: Application) => void; onShowDrafts: () => void;
  activeFilter: BoardFilter; onFilter: (filter: BoardFilter) => void; onShowContacts: () => void; slim?: boolean;
}) {
  const leads = apps.filter((app) => app.stage === "Leads").length;
  const needsSubmitting = apps.filter((app) => app.stage === "Needs Submitting").length;
  // "In Play" = every active card: Leads + Needs Submitting + Applied +
  // Interviewing + Offer — everything that is not Closed/Rejected.
  const inPlay = apps.filter((app) => app.stage !== "Closed/Rejected").length;
  const offers = apps.filter((app) => app.stage === "Offer").length;
  const nextUp = useMemo(() => {
    const active = apps.filter((app) => app.stage !== "Closed/Rejected");
    return [...active].sort((a, b) =>
      STAGE_PRIORITY[a.stage] - STAGE_PRIORITY[b.stage] || (b.fit_score ?? -1) - (a.fit_score ?? -1) || b.updated_at.localeCompare(a.updated_at),
    )[0];
  }, [apps]);
  const isNeedsSubmitting = nextUp?.stage === "Needs Submitting";
  const actionSource = isNeedsSubmitting && nextUp?.prep_notes.trim() ? whatsLeft(nextUp.prep_notes) : nextUp?.notes;
  const nextAction = actionSource?.trim()
    ? actionSource.trim().slice(0, 140) + (actionSource.trim().length > 140 ? "…" : "")
    : "";
  const finishUrl = nextUp ? (nextUp.submit_url || nextUp.employer_url || nextUp.source_url) : "";
  const chip = (filter: BoardFilter, count: number, label: string, alert = false) => (
    <button
      type="button"
      className={`stat-chip stat-chip-button ${alert ? "stat-chip-alert" : ""} ${activeFilter === filter ? "stat-chip-active" : ""}`}
      aria-pressed={activeFilter === filter}
      aria-label={`Filter board: ${label}, ${count} cards`}
      onClick={() => onFilter(activeFilter === filter ? "All" : filter)}
    ><strong>{count}</strong><span>{label}</span></button>
  );
  const statsRow = (
    <div className="cc-stats" role="list" aria-label="Pipeline stats — tap a box to filter the board">
      {chip("Needs Submitting", needsSubmitting, "Needs submitting", needsSubmitting > 0)}
      {chip("Leads", leads, "Active leads")}
      {chip("InPlay", inPlay, "In play")}
      {chip("Offer", offers, "Offers")}
      <button type="button" className="stat-chip stat-chip-button" onClick={onShowContacts} aria-label={`Open key contacts, ${contactCount} people`}><strong>{contactCount}</strong><span>Key contacts</span></button>
      <button type="button" className={`stat-chip stat-chip-button ${draftsWaiting > 0 ? "stat-chip-alert-soft" : ""}`} onClick={onShowDrafts} aria-label={`Open outreach drafts, ${draftsWaiting} awaiting approval`}><strong>{draftsWaiting}</strong><span>Drafts to approve</span></button>
    </div>
  );
  if (slim) {
    // Board view: one slim strip with the user's four headline numbers. The full
    // stats + Next Up summary lives on the Health tab so job cards open
    // front and center.
    const now = Date.now();
    const autoApplied = apps.filter((app) => app.prep_status === "done" && app.submission_confirmation.trim() !== "").length;
    const appliedLast24h = apps.filter((app) => {
      if (!app.submitted_at) return false;
      const t = new Date(app.submitted_at).getTime();
      return Number.isFinite(t) && t >= now - 86_400_000 && t <= now;
    }).length;
    const activeApplications = apps.filter((app) => app.stage === "Applied" || app.stage === "Interviewing" || app.stage === "Offer").length;
    return (
      <section className="command-center command-center-slim" aria-label="Headline numbers">
        <div className="top-stats" role="list" aria-label="Auto-applied, applied in the last 24 hours, active applications, and messages to review">
          <div className="stat-chip top-stat" role="listitem"><strong>{autoApplied}</strong><span>Auto-applied</span></div>
          <div className="stat-chip top-stat" role="listitem"><strong>{appliedLast24h}</strong><span>Applied · 24h</span></div>
          <button
            type="button"
            className={`stat-chip top-stat stat-chip-button ${activeFilter === "ActiveApplications" ? "stat-chip-active" : ""}`}
            aria-pressed={activeFilter === "ActiveApplications"}
            aria-label={`Filter board: Active applications, ${activeApplications} cards`}
            onClick={() => onFilter(activeFilter === "ActiveApplications" ? "All" : "ActiveApplications")}
          ><strong>{activeApplications}</strong><span>Active applications</span></button>
          <button
            type="button"
            className={`stat-chip top-stat stat-chip-button ${draftsWaiting > 0 ? "stat-chip-alert-soft" : ""}`}
            aria-label={`Open outreach drafts, ${draftsWaiting} messages to review`}
            onClick={onShowDrafts}
          ><strong>{draftsWaiting}</strong><span>Messages to review</span></button>
        </div>
      </section>
    );
  }
  return (
    <section className="command-center" aria-label="Command center">
      {statsRow}
      {nextUp ? (
        <article className="spotlight">
          <div className="spotlight-top">
            <span className="spotlight-label">Next up</span>
            <span className={`stage-pill stage-pill-${slugify(nextUp.stage)}`}>{nextUp.stage}</span>
          </div>
          <h2>{nextUp.company} — {nextUp.role}</h2>
          <p className="spotlight-meta">
            {nextUp.location || "Location TBD"}{nextUp.pay ? ` · ${nextUp.pay}` : ""}
          </p>
          <div className="fit-line"><FitBadge app={nextUp}/></div>
          {nextAction && <p className="spotlight-next"><strong>{isNeedsSubmitting ? "What's left:" : "Next action:"}</strong> {nextAction}</p>}
          <div className="spotlight-actions">
            {isNeedsSubmitting ? (
              finishUrl ? (
                <a className="spotlight-cta" href={finishUrl} target="_blank" rel="noreferrer">
                  {nextUp.submit_url ? "Open & finish application" : "Open posting to finish"} <Icon name="arrow" size={15}/>
                </a>
              ) : (
                <button type="button" className="spotlight-cta" onClick={() => onEdit(nextUp)}>
                  Add the finish link <Icon name="edit" size={15}/>
                </button>
              )
            ) : postingUrlFor(nextUp) ? (
              <a className="spotlight-cta" href={postingUrlFor(nextUp)} target="_blank" rel="noreferrer">
                {postingKindFor(nextUp) === "employer" ? "Employer posting" : "View posting"} <Icon name="arrow" size={15}/>
              </a>
            ) : null}
            <button type="button" className="spotlight-edit" onClick={() => onEdit(nextUp)}>
              <Icon name="edit" size={15}/> Open card
            </button>
          </div>
        </article>
      ) : (
        <article className="spotlight spotlight-empty">
          <span className="spotlight-label">Next up</span>
          <h2>Nothing in play yet</h2>
          <p className="spotlight-next">Add a lead or move one forward on the board and it will show up here as your next move.</p>
        </article>
      )}
    </section>
  );
}

function FitGuideModal({ onClose, onStartQuestionnaire }: { onClose: () => void; onStartQuestionnaire?: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet fit-guide-sheet" role="dialog" aria-modal="true" aria-label="Fit rating guide">
        <header><div><p>Fit rating</p><h2>How the fit score works</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close fit guide"><Icon name="x"/></button></header>
        <div className="fit-guide-body">
          <section>
            <h3>What the 0–100 score is</h3>
            <p>Every role gets one number from 0 to 100 that summarizes how well it fits what you&rsquo;re actually looking for. It&rsquo;s built from five dimensions that add up to 100. Higher is a better fit — not a guarantee, just a way to decide where to spend your time first.</p>
            <ul className="fit-tier-list">
              <li><strong>75–100 Strong:</strong> Prioritize this. Apply / prep first.</li>
              <li><strong>55–74 Good:</strong> Worth real effort.</li>
              <li><strong>40–54 Fair:</strong> Keep in play, but don&rsquo;t let it crowd out stronger fits.</li>
              <li><strong>0–39 Weak:</strong> Probably a reach, stale, or a poor life/pay fit. Re-check before investing.</li>
            </ul>
          </section>
          <section>
            <h3>The 5 dimensions</h3>
            <div className="fit-dim-card"><h4>1. Role alignment — 30 points</h4><p>Is this the exact kind of job you want? It looks at: the role type (your primary target role type scores highest, closely related specialist roles are also in-lane, and the full/senior version of the role is a step up), whether the specialty matches your lane and target companies, and whether the day-to-day is close to the work you actually want.</p></div>
            <div className="fit-dim-card"><h4>2. Warm path — 25 points</h4><p>Do you have a person, not just a portal? It counts whether you know anyone at the company or on the team, who they are (hiring manager is strongest, then a rep on the team, then a recruiter, then another employee), whether anyone offered to refer you or forward your resume, and whether you&rsquo;ve already talked to someone on the team. Cold applications are near-meaningless in this market — this dimension is weighted heavily on purpose. Auto-scoring often underrates it because it can only see tags like &ldquo;warm-intro&rdquo; and names typed in the People field. If a contact forwarded your resume or you&rsquo;ve talked to someone on the team, the questionnaire captures that and auto-scoring can&rsquo;t erase it.</p></div>
            <div className="fit-dim-card"><h4>3. Lane / pay fit — 20 points</h4><p>Does the offer structure work for your life? It distinguishes base salary vs base + commission vs draw vs pure commission, whether any pay is guaranteed, whether it covers your monthly essentials and your goals, and the hours — a sustainable week scores higher than heavy on-call if health and free time are deciding factors for you. For secondary jobs, guaranteed hourly pay is what matters most; pure commission scores low.</p></div>
            <div className="fit-dim-card"><h4>4. Freshness — 15 points</h4><p>Is the posting real and still open? When it was posted matters, and whether you (or your assistant) verified it&rsquo;s still accepting applications on the employer&rsquo;s own board matters more. A verified-live posting keeps its score; an unchecked or month-old posting decays.</p></div>
            <div className="fit-dim-card"><h4>5. Location — 10 points</h4><p>Where is the territory, how far is it, and what does it require day to day? Local roles score highest, elsewhere in your region next, remote after that. It also factors work style (hybrid / flexible vs 5 days on-site) and whether relocation is required — and whether you&rsquo;re actually OK with relocating.</p></div>
          </section>
          <section>
            <h3>How scoring works — four ways, one writer per score</h3>
            <ol>
              <li><strong>Auto-scored:</strong> The tracker reads the card itself — title keywords, tags, People field, pay text, location text, and recency — and applies the rubric. The daily health check re-scores every auto card. Fast triage for new leads, but blind to anything not written on the card — a warm-path 0 here means the evidence isn&rsquo;t on the card, not that you have no path in.</li>
              <li><strong>Pipeline sweep:</strong> The daily sweep scores from people evidence — the actual humans attached to the role — and locks that score. A warm-path subscore from the sweep must cite who the warm path is (People field or a &ldquo;Warm path:&rdquo; note), so the number is always explainable.</li>
              <li><strong>Questionnaire:</strong> You answer ~16 quick questions (one short section per dimension) plus other helpful context. The answers are converted to points per dimension using the same 30 / 25 / 20 / 15 / 10 caps, summed to 0–100, and saved with the full breakdown <em>and</em> the answers themselves on the card — so anyone can see exactly why the score is what it is. This counts as a user score.</li>
              <li><strong>Manual override:</strong> You type a number directly in Edit → &ldquo;Your fit score&rdquo; and add a calibration note explaining why. Fastest when you just know a score is wrong.</li>
            </ol>
            <p><strong>Protection rule — the single-writer lock:</strong> A locked score has exactly one writer. Sweep scores (set from people evidence, with the warm path cited by name), questionnaire scores, and manual overrides are all locked: the daily auto-scoring <em>never</em> overwrites them. It may only flag a divergence in the health panel when the rubric would land more than 5 points away — flagged, never fixed by overwriting. Only auto-scored cards get re-scored daily. To return a card to auto-scoring, clear the manual score field in Edit, or clear the questionnaire from the questionnaire form.</p>
          </section>
          <section>
            <h3>How cards sort by it</h3>
            <p>Within each stage column (Leads, Needs Submitting, Applied, Interviewing, Offer), cards are ordered highest fit first, unscored last. The Command Center &ldquo;Next up&rdquo; spotlight first sorts by stage urgency — Needs Submitting needs you first, then Offer, Interviewing, Applied, Leads — and breaks ties by fit score, then by most recently updated. So raising a card&rsquo;s fit score genuinely raises its priority everywhere.</p>
          </section>
          <section>
            <h3>Manual override + calibration note — step by step</h3>
            <ol>
              <li>Open a card → Edit (pencil icon).</li>
              <li>Find &ldquo;Your fit score (0–100)&rdquo; and type your number.</li>
              <li>In &ldquo;Fit calibration note,&rdquo; write the reason in one line — the note shows under the breakdown on the card.</li>
              <li>Save. The badge gets a dot and the breakdown head says &ldquo;set by you — protected from auto-scoring.&rdquo;</li>
              <li>To undo: edit again, clear the score field to blank, and save. The card returns to auto-scoring on the next health check (or immediately, with a fresh rubric score).</li>
            </ol>
          </section>
          <section>
            <h3>The questionnaire — step by step</h3>
            <ol>
              <li>Open any card → expand &ldquo;Details &amp; fit&rdquo; → tap &ldquo;Rate fit with questionnaire.&rdquo;</li>
              <li>Answer each section honestly from what you know right now. Leave a question blank if you don&rsquo;t know — blanks score conservatively, they don&rsquo;t punish you to zero.</li>
              <li>The &ldquo;Other helpful&rdquo; section (travel %, on-call rotation, territory / account size, team size, known hiring manager, application deadline, next step, deal-breakers) doesn&rsquo;t change the number directly — it&rsquo;s saved on the card so the context isn&rsquo;t lost, and deal-breakers surface in the breakdown summary.</li>
              <li>Tap &ldquo;Save questionnaire &amp; set my fit score.&rdquo; Check the card: the badge, total, and per-dimension bars should match your answers.</li>
              <li>You can re-answer anytime — &ldquo;Edit questionnaire answers&rdquo; on the card reopens it with your previous answers pre-filled.</li>
            </ol>
            {onStartQuestionnaire && <p className="fit-guide-cta-row"><button type="button" className="primary-button" onClick={onStartQuestionnaire}>Got it — close guide</button></p>}
          </section>
        </div>
        <footer><button type="button" className="text-button" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}

function FitQuestionnaireModal({ app, onClose, onSave, onClear, saving }: {
  app: Application;
  onClose: () => void;
  onSave: (appId: number, answers: FitAnswers, fitNotes: string) => void;
  onClear: (appId: number) => void;
  saving: boolean;
}) {
  const [answers, setAnswers] = useState<FitAnswers>(() => ({ ...EMPTY_FIT_ANSWERS, ...app.fit_answers }));
  const [fitNotes, setFitNotes] = useState(app.fit_notes ?? "");
  const [confirmClear, setConfirmClear] = useState(false);
  function set<K extends keyof FitAnswers>(key: K, value: FitAnswers[K]) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(app.id, answers, fitNotes.trim());
  }
  // Live preview using the same point maps as the server
  const preview = useMemo(() => {
    const role = Math.min(30, ({ associate: 10, css: 8, sales_rep: 5, other: 2, "": 3 } as Record<string, number>)[answers.role_type]! + ({ exact: 10, adjacent: 6, different: 2, "": 3 } as Record<string, number>)[answers.role_lane_match]! + ({ very_close: 10, somewhat: 6, not_really: 2, "": 3 } as Record<string, number>)[answers.role_day_to_day]!);
    const warm = Math.min(25, ({ strong: 8, some: 4, none: 0, "": 0 } as Record<string, number>)[answers.warm_knows_someone]! + ({ hiring_manager: 7, team_rep: 6, recruiter: 5, other_employee: 3, none: 0, "": 0 } as Record<string, number>)[answers.warm_contact_type]! + ({ yes: 6, maybe: 3, no: 0, "": 0 } as Record<string, number>)[answers.warm_referral]! + ({ multiple: 4, once: 3, no: 0, "": 0 } as Record<string, number>)[answers.warm_talked]!);
    const lane = Math.min(20, ({ base_salary: 6, base_plus_commission: 5, draw: 3, pure_commission: 1, unknown: 2, "": 2 } as Record<string, number>)[answers.pay_structure]! + ({ yes_full: 5, yes_partial: 3, no: 0, unknown: 2, "": 2 } as Record<string, number>)[answers.pay_guaranteed]! + ({ fully: 5, partially: 3, not_at_all: 0, unknown: 2, "": 2 } as Record<string, number>)[answers.pay_covers_gap]! + ({ around_40: 4, moderate_oncall: 2, heavy_oncall: 0, unknown: 2, "": 2 } as Record<string, number>)[answers.pay_hours]!);
    const fresh = Math.min(15, ({ within_week: 8, one_two_weeks: 6, three_four_weeks: 4, over_month: 2, unknown: 3, "": 3 } as Record<string, number>)[answers.fresh_posted_when]! + ({ today: 7, this_week: 5, not_checked: 2, closed: 0, "": 2 } as Record<string, number>)[answers.fresh_verified]!);
    const location = Math.min(10, ({ local: 5, in_region: 4, remote: 3, out_of_state: 1, "": 2 } as Record<string, number>)[answers.loc_distance]! + ({ hybrid: 3, remote: 3, onsite_reasonable: 2, onsite_heavy: 0, "": 1 } as Record<string, number>)[answers.loc_work_style]! + ({ none_needed: 2, required_ok: 1, required_not_ok: 0, unknown: 1, "": 1 } as Record<string, number>)[answers.loc_relocation]!);
    return { role, warm, lane, fresh, location, total: role + warm + lane + fresh + location };
  }, [answers]);
  const sel = (label: string, key: keyof FitAnswers, options: { value: string; label: string }[], help?: string) => (
    <label>{label}<select aria-label={label} value={String(answers[key] ?? "")} onChange={(e) => set(key, e.target.value as FitAnswers[typeof key])}><option value="">— Not answered —</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{help ? <span className="field-help">{help}</span> : null}</label>
  );
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="sheet questionnaire-sheet" onSubmit={submit}>
        <header><div><p>Fit questionnaire</p><h2>{app.company} — {app.role}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close questionnaire"><Icon name="x"/></button></header>
        <p className="questionnaire-intro">Answer from what you actually know about this role. Your answers set the fit score + breakdown and are saved on the card so the rating is explainable. This score is protected — the daily auto-score won&rsquo;t overwrite it. Leave anything you don&rsquo;t know blank.</p>
        <div className="questionnaire-preview" role="status" aria-label="Live fit score preview">
          <strong>Live preview: {preview.total}/100</strong>
          <span>Role {preview.role}/30 · Warm {preview.warm}/25 · Lane/pay {preview.lane}/20 · Fresh {preview.fresh}/15 · Location {preview.location}/10</span>
        </div>

        <fieldset className="q-section"><legend>Role alignment — 30 pts</legend>
          <div className="form-grid">
            {sel("What type of role is this, exactly?", "role_type", [{ value: "associate", label: "Associate" }, { value: "css", label: "Specialist" }, { value: "sales_rep", label: "Sales rep / territory rep" }, { value: "other", label: "Other" }])}
            {sel("Does it match your target lane?", "role_lane_match", [{ value: "exact", label: "Exact match — my lane" }, { value: "adjacent", label: "Adjacent — related specialty / company" }, { value: "different", label: "Different lane" }], "Elective vs trauma, company family, specialty.")}
            {sel("Is the day-to-day close to what you want?", "role_day_to_day", [{ value: "very_close", label: "Very close to what I want" }, { value: "somewhat", label: "Somewhat close" }, { value: "not_really", label: "Not really" }])}
          </div>
        </fieldset>

        <fieldset className="q-section"><legend>Warm path — 25 pts</legend>
          <div className="form-grid">
            {sel("Do you know anyone at this company or on this team?", "warm_knows_someone", [{ value: "strong", label: "Yes — strong connection" }, { value: "some", label: "Yes — someone" }, { value: "none", label: "No one" }])}
            {sel("Who is your best contact there?", "warm_contact_type", [{ value: "hiring_manager", label: "Hiring manager" }, { value: "team_rep", label: "Rep on the team" }, { value: "recruiter", label: "Recruiter" }, { value: "other_employee", label: "Other employee" }, { value: "none", label: "None" }])}
            {sel("Has anyone offered to refer you or forward your resume?", "warm_referral", [{ value: "yes", label: "Yes" }, { value: "maybe", label: "Maybe / hinted at it" }, { value: "no", label: "No" }])}
            {sel("Have you already talked to someone on the team?", "warm_talked", [{ value: "multiple", label: "Yes — multiple conversations" }, { value: "once", label: "Yes — once" }, { value: "no", label: "No" }])}
          </div>
        </fieldset>

        <fieldset className="q-section"><legend>Lane / pay — 20 pts</legend>
          <div className="form-grid">
            {sel("How is pay structured?", "pay_structure", [{ value: "base_salary", label: "Base salary" }, { value: "base_plus_commission", label: "Base + commission" }, { value: "draw", label: "Draw against commission" }, { value: "pure_commission", label: "Pure commission" }, { value: "unknown", label: "Unknown" }])}
            {sel("Is any pay guaranteed?", "pay_guaranteed", [{ value: "yes_full", label: "Yes — fully guaranteed base" }, { value: "yes_partial", label: "Yes — partially guaranteed" }, { value: "no", label: "No guaranteed pay" }, { value: "unknown", label: "Unknown" }])}
            {sel("Does it cover your monthly nut / move-out gap?", "pay_covers_gap", [{ value: "fully", label: "Fully covers it" }, { value: "partially", label: "Partially covers it" }, { value: "not_at_all", label: "Does not cover it" }, { value: "unknown", label: "Unknown" }])}
            {sel("What are the hours like?", "pay_hours", [{ value: "around_40", label: "~40-hour week" }, { value: "moderate_oncall", label: "Moderate on-call" }, { value: "heavy_oncall", label: "Heavy on-call / little sleep" }, { value: "unknown", label: "Unknown" }])}
          </div>
        </fieldset>

        <fieldset className="q-section"><legend>Freshness — 15 pts</legend>
          <div className="form-grid">
            {sel("When was it posted?", "fresh_posted_when", [{ value: "within_week", label: "Within the last week" }, { value: "one_two_weeks", label: "1–2 weeks ago" }, { value: "three_four_weeks", label: "3–4 weeks ago" }, { value: "over_month", label: "Over a month ago" }, { value: "unknown", label: "Unknown" }])}
            {sel("Verified still accepting applications on the employer board?", "fresh_verified", [{ value: "today", label: "Yes — checked today" }, { value: "this_week", label: "Yes — checked this week" }, { value: "not_checked", label: "Not checked yet" }, { value: "closed", label: "Posting is closed" }])}
          </div>
        </fieldset>

        <fieldset className="q-section"><legend>Location — 10 pts</legend>
          <div className="form-grid">
            {sel("Territory / distance?", "loc_distance", [{ value: "local", label: "Local — near home" }, { value: "in_region", label: "Elsewhere in my region / state" }, { value: "remote", label: "Remote" }, { value: "out_of_state", label: "Out of state" }])}
            {sel("On-site / hybrid?", "loc_work_style", [{ value: "hybrid", label: "Hybrid / flexible" }, { value: "remote", label: "Remote" }, { value: "onsite_reasonable", label: "On-site — reasonable" }, { value: "onsite_heavy", label: "On-site — 5 days / heavy" }])}
            {sel("Relocation required?", "loc_relocation", [{ value: "none_needed", label: "No relocation needed" }, { value: "required_ok", label: "Required — I'm OK with it" }, { value: "required_not_ok", label: "Required — not OK for me" }, { value: "unknown", label: "Unknown" }])}
          </div>
        </fieldset>

        <fieldset className="q-section"><legend>Other helpful — saved, doesn&rsquo;t change the number</legend>
          <div className="form-grid">
            <label>Travel %<input value={answers.other_travel_pct} onChange={(e) => set("other_travel_pct", e.target.value)} placeholder="e.g. 20%, local only, overnight weekly"/></label>
            <label>On-call rotation<input value={answers.other_oncall} onChange={(e) => set("other_oncall", e.target.value)} placeholder="e.g. 1 weekend in 4"/></label>
            <label>Territory / account size<input value={answers.other_territory_size} onChange={(e) => set("other_territory_size", e.target.value)} placeholder="e.g. 12 hospitals, LA metro"/></label>
            <label>Team size<input value={answers.other_team_size} onChange={(e) => set("other_team_size", e.target.value)} placeholder="e.g. team of 4 + 1 manager"/></label>
            <label>Known hiring manager<input value={answers.other_hiring_manager_known} onChange={(e) => set("other_hiring_manager_known", e.target.value)} placeholder="Name, if you know it"/></label>
            <label>Application deadline<input value={answers.other_deadline} onChange={(e) => set("other_deadline", e.target.value)} placeholder="Date or 'rolling'"/></label>
            <label className="wide">Next step — is it known?<input value={answers.other_next_step} onChange={(e) => set("other_next_step", e.target.value)} placeholder="e.g. Recruiter screen Tue, then RM call"/></label>
            <label className="wide">Any deal-breakers?<textarea rows={2} value={answers.other_deal_breakers} onChange={(e) => set("other_deal_breakers", e.target.value)} placeholder="e.g. pure commission with no draw, 5 days on-site, license required…"/></label>
            <label className="wide">Anything else about fit<textarea rows={2} value={answers.other_notes} onChange={(e) => set("other_notes", e.target.value)} placeholder="Context that explains this score…"/></label>
            <label className="wide">Calibration note (shows on the card)<input value={fitNotes} onChange={(e) => setFitNotes(e.target.value)} placeholder="One line: why this score is right…"/></label>
          </div>
        </fieldset>

        {hasQuestionnaireAnswers(app) && (
          <div className="q-clear-row">
            {!confirmClear ? (
              <button type="button" className="text-button" onClick={() => setConfirmClear(true)}>Clear questionnaire &amp; return to auto-scoring</button>
            ) : (
              <span className="q-clear-confirm">Clear your answers and hand this card back to auto-scoring? <button type="button" className="prep-retry-button" onClick={() => onClear(app.id)}>Yes, clear it</button> <button type="button" className="text-button" onClick={() => setConfirmClear(false)}>Keep my answers</button></span>
            )}
          </div>
        )}
        <footer><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : `Save questionnaire — set fit to ${preview.total}`}</button></footer>
      </form>
    </div>
  );
}

function ApplicationModal({ initial, lane, onClose, onSave, saving }: {
  initial: Application | null; lane: Lane; onClose: () => void; onSave: (value: Omit<Application, "created_at" | "updated_at">) => void; saving: boolean;
}) {
  const [form, setForm] = useState<Omit<Application, "created_at" | "updated_at">>(() => initial ?? { ...EMPTY_APP, id: 0, lane });
  const [tagText, setTagText] = useState(initial?.tags.join(", ") ?? "");
  const [fitText, setFitText] = useState(initial?.fit_score !== null && initial?.fit_score !== undefined ? String(initial.fit_score) : "");
  function submit(event: FormEvent) {
    event.preventDefault();
    const tags = tagText.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    const parsedFit = fitText.trim() === "" ? null : Math.max(0, Math.min(100, Math.round(Number(fitText))));
    onSave({ ...form, tags: Array.from(new Set(tags)), fit_score: Number.isNaN(parsedFit) ? form.fit_score : parsedFit });
  }
  const editing = initial !== null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="sheet" onSubmit={submit}>
        <header><div><p>{initial ? "Edit opportunity" : "Quick add"}</p><h2>{initial ? initial.company : lane === "primary" ? "New primary lead" : "New secondary job"}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close form"><Icon name="x"/></button></header>
        <div className="form-grid">
          <label>Company<input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}/></label>
          <label>Role<input required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}/></label>
          <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}/></label>
          <label>Pay<input value={form.pay} onChange={(e) => setForm({ ...form, pay: e.target.value })}/></label>
          <label>Req / job ID<input value={form.req_id} onChange={(e) => setForm({ ...form, req_id: e.target.value })}/></label>
          <label>Stage<select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as Stage })}>{ALL_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
          <label className="wide">Tags<input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="associate-level, warm-intro"/><span className="field-help">Comma-separated. Common: {TAGS.join(", ")}</span></label>
          <label className="wide">Notes<textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></label>
          <label className="wide">People / connection angles<textarea rows={3} value={form.people} onChange={(e) => setForm({ ...form, people: e.target.value })}/></label>
          <label className="wide">Posting URL (LinkedIn / Indeed listing)<input type="url" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} placeholder="https://www.linkedin.com/jobs/view/…"/><span className="field-help">Link rule: only the employer&rsquo;s own careers page, LinkedIn, or Indeed — never an aggregator, mirror, or agency site.</span></label>
          <label className="wide">Employer careers URL<input type="url" value={form.employer_url} onChange={(e) => setForm({ ...form, employer_url: e.target.value })} placeholder="https://careers.company.com/…"/><span className="field-help">The posting on the employer&rsquo;s own careers site (their ATS portal counts). When both are filled, the card links here first.</span></label>
          <label>Posting verified<select value={form.link_status} onChange={(e) => setForm({ ...form, link_status: e.target.value as Application["link_status"] })}><option value="unchecked">Not checked yet</option><option value="live">Live — verified on employer site</option><option value="dead">Dead — posting gone</option></select><span className="field-help">{form.link_checked_at ? `Last checked ${formatWhen(form.link_checked_at)}.` : "Saving Live or Dead stamps today as the check date."}</span></label>
          {editing && (
            <>
              <label className="wide">Finish / application URL<input type="url" value={form.submit_url} onChange={(e) => setForm({ ...form, submit_url: e.target.value })} placeholder="The in-progress application link for Needs Submitting"/><span className="field-help">This is the link the red &ldquo;Open &amp; finish&rdquo; button opens. Without it (or a posting URL), Needs Submitting can&rsquo;t work.</span></label>
              <label>Your fit score (0–100)<input inputMode="numeric" value={fitText} onChange={(e) => setFitText(e.target.value)} placeholder={form.fit_score !== null ? String(form.fit_score) : "Auto"}/><span className="field-help">Leave blank to hand scoring back to the rubric. A number you type sticks — daily auto-scoring won&rsquo;t overwrite it.</span></label>
              <label>Fit calibration note<input value={form.fit_notes} onChange={(e) => setForm({ ...form, fit_notes: e.target.value })} placeholder="Why the score should be higher/lower…"/></label>
              <label className="wide">Prep notes<textarea rows={3} value={form.prep_notes} onChange={(e) => setForm({ ...form, prep_notes: e.target.value })} placeholder="What's left for you on a prepped application…"/></label>
              {initial?.submitted_at && (
                <p className="wide submitted-line"><strong>Submitted {formatWhen(initial.submitted_at)}</strong> by your assistant under your auto-apply grant. Confirmed ✔️</p>
              )}
            </>
          )}
        </div>
        <footer><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save opportunity"}</button></footer>
      </form>
    </div>
  );
}

function ContactModal({ initial, onClose, onSave, saving }: {
  initial: Contact | null; onClose: () => void; onSave: (value: Omit<Contact, "created_at" | "updated_at">) => void; saving: boolean;
}) {
  const [form, setForm] = useState<Omit<Contact, "created_at" | "updated_at">>(() => initial ?? { ...EMPTY_CONTACT, id: 0 });
  function submit(event: FormEvent) { event.preventDefault(); onSave(form); }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="sheet contact-sheet" onSubmit={submit}>
        <header><div><p>{initial ? "Edit contact" : "New contact"}</p><h2>{initial?.person || "Add relationship"}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close contact form"><Icon name="x"/></button></header>
        <div className="form-grid">
          <label>Person<input required value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })}/></label>
          <label>Company + role<input value={form.company_role} onChange={(e) => setForm({ ...form, company_role: e.target.value })}/></label>
          <label>Channel<input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}/></label>
          <label>Last contact<input value={form.last_contact} onChange={(e) => setForm({ ...form, last_contact: e.target.value })}/></label>
          <label className="wide">Next touch<input value={form.next_touch} onChange={(e) => setForm({ ...form, next_touch: e.target.value })}/></label>
          <label className="wide">Notes<textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}/></label>
        </div>
        <footer><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save contact"}</button></footer>
      </form>
    </div>
  );
}

function ContactCard({ contact, duplicate, onEdit, onDelete, onDraft }: { contact: Contact; duplicate?: boolean; onEdit: (contact: Contact) => void; onDelete: (contact: Contact) => void; onDraft: (contact: Contact) => void }) {
  return (
    <article className="contact-card">
      <div className="contact-main">
        <p className="contact-name">{contact.person}{contact.next_touch.trim() && <span className="touch-badge">Needs a touch</span>}{duplicate && <span className="dup-badge" title="Another contact card uses this exact name — merge or delete the spare if they're the same person">Possible duplicate</span>}</p>
        <p>{contact.company_role || "Role not added"}</p><span>{contact.channel || "Channel not added"}</span>
      </div>
      <div className="contact-history"><div><span>LAST CONTACT</span><p>{contact.last_contact || "—"}</p></div><div><span>NEXT TOUCH</span><p>{contact.next_touch || "—"}</p></div></div>
      <div className="contact-buttons"><button className="icon-button" onClick={() => onDraft(contact)} aria-label={`Draft a message to ${contact.person}`}><Icon name="mail" size={16}/></button><button className="icon-button" onClick={() => onEdit(contact)} aria-label={`Edit ${contact.person}`}><Icon name="edit" size={16}/></button><button className="icon-button danger" onClick={() => onDelete(contact)} aria-label={`Delete ${contact.person}`}><Icon name="trash" size={16}/></button></div>
    </article>
  );
}

const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  draft: "Awaiting your approval",
  approved: "Approved — ready to send",
  sent: "Sent",
  dropped: "Dropped",
};

function DraftCard({ draft, appLabel, copied, onEdit, onDelete, onStatus, onCopy, onSelectCandidate }: {
  draft: Draft;
  appLabel: string;
  copied: boolean;
  onEdit: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
  onStatus: (draft: Draft, status: DraftStatus) => void;
  onCopy: (draft: Draft) => void;
  onSelectCandidate: (draft: Draft, candidateName: string) => void;
}) {
  const scopeLabel = draft.employer_scope?.trim() || appLabel;
  const candidates = draft.candidates ?? [];
  const selectedName = draft.selected_candidate || draft.recipient;
  const multiCandidate = candidates.length > 1;
  return (
    <article className={`draft-card draft-status-${draft.status}`}>
      <div className="draft-top">
        <div>
          <p className="draft-recipient">{draft.recipient}</p>
          <p className="draft-meta">{draft.channel} · {draft.purpose}{appLabel ? ` · ${appLabel}` : ""}</p>
          {scopeLabel && <p className="draft-meta draft-scope">For: {scopeLabel}</p>}
        </div>
        <span className={`draft-pill draft-pill-${draft.status}`}>{DRAFT_STATUS_LABEL[draft.status]}</span>
      </div>
      {multiCandidate ? (
        <div className="candidate-block">
          <p className="candidate-head">Could be one of these people — tap a name and the message below fills in for them:</p>
          <div className="candidate-list" role="group" aria-label={`Candidate recipients for ${scopeLabel || draft.purpose}`}>
            {candidates.map((candidate) => {
              const isSelected = candidate.name === selectedName;
              return (
                <div key={candidate.name} className={`candidate-row ${isSelected ? "candidate-selected" : ""}`}>
                  <button
                    type="button"
                    className="candidate-chip"
                    aria-pressed={isSelected}
                    aria-label={`Fill the message for ${candidate.name}`}
                    onClick={() => onSelectCandidate(draft, candidate.name)}
                  >
                    {isSelected && <Icon name="check" size={13}/>} {candidate.name}
                  </button>
                  {candidate.linkedin_url?.trim() ? (
                    <a className="candidate-linkedin" href={candidate.linkedin_url} target="_blank" rel="noreferrer" aria-label={`Open LinkedIn profile for ${candidate.name}`}>
                      <Icon name="link" size={13}/> LinkedIn
                    </a>
                  ) : (
                    <span className="candidate-linkedin-missing">No LinkedIn link yet</span>
                  )}
                  {(candidate.title || candidate.note) && (
                    <p className="candidate-note">{[candidate.title, candidate.note].filter(Boolean).join(" — ")}</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="candidate-hint">The message, approval, and copy button all follow the name you&rsquo;ve tapped. Switching names on an approved draft sends it back for a fresh approval, so you always sign off on the exact words for that exact person.</p>
        </div>
      ) : (
        <div className="draft-linkedin-row">
          {draft.linkedin_url?.trim() ? (
            <a className="draft-linkedin-link" href={draft.linkedin_url} target="_blank" rel="noreferrer" aria-label={`Open LinkedIn profile for ${draft.recipient}`}>
              <Icon name="link" size={14}/> LinkedIn profile
            </a>
          ) : (
            <>
              <span className="draft-linkedin-missing">LinkedIn not added yet</span>
              <button type="button" className="draft-linkedin-add" onClick={() => onEdit(draft)}>Add LinkedIn link</button>
            </>
          )}
        </div>
      )}
      {draft.recipient_read && <p className="draft-read"><strong>Read on them:</strong> {draft.recipient_read}</p>}
      <p className="draft-body">{draft.body || "(no text yet — open Edit and write it)"}</p>
      <p className="draft-when">
        {draft.status === "sent" && draft.sent_at ? `You sent this ${formatWhen(draft.sent_at)}.` : `Drafted ${formatWhen(draft.created_at)}${draft.updated_at !== draft.created_at ? ` · edited ${formatWhen(draft.updated_at)}` : ""}.`}
      </p>
      <div className="draft-actions">
        {draft.status === "draft" && (
          <>
            <button type="button" className="draft-approve" onClick={() => onStatus(draft, "approved")}><Icon name="check" size={15}/> Approve exact text</button>
            <button type="button" className="draft-secondary" onClick={() => onEdit(draft)}><Icon name="edit" size={15}/> Edit</button>
            <button type="button" className="draft-secondary" onClick={() => onStatus(draft, "dropped")}>Drop it</button>
          </>
        )}
        {draft.status === "approved" && (
          <>
            <button type="button" className="draft-approve" onClick={() => onCopy(draft)}><Icon name="copy" size={15}/> {copied ? "Copied — paste it in " + draft.channel : "Copy approved text"}</button>
            <button type="button" className="draft-secondary" onClick={() => onStatus(draft, "sent")}><Icon name="send" size={15}/> Mark as sent</button>
            <button type="button" className="draft-secondary" onClick={() => onEdit(draft)}><Icon name="edit" size={15}/> Edit (un-approves)</button>
            <button type="button" className="draft-secondary" onClick={() => onStatus(draft, "dropped")}>Drop it</button>
          </>
        )}
        {draft.status === "sent" && (
          <button type="button" className="draft-secondary" onClick={() => onCopy(draft)}><Icon name="copy" size={15}/> {copied ? "Copied" : "Copy text"}</button>
        )}
        {draft.status === "dropped" && (
          <button type="button" className="draft-secondary" onClick={() => onStatus(draft, "draft")}>Restore as draft</button>
        )}
        <button type="button" className="icon-button danger draft-delete" onClick={() => onDelete(draft)} aria-label={`Delete draft to ${draft.recipient}`}><Icon name="trash" size={15}/></button>
      </div>
    </article>
  );
}

function DraftModal({ initial, applications, onClose, onSave, saving }: {
  initial: Draft | null;
  applications: Application[];
  onClose: () => void;
  onSave: (value: Omit<Draft, "created_at" | "updated_at" | "sent_at" | "status">) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Omit<Draft, "created_at" | "updated_at" | "sent_at" | "status">>(() =>
    initial ?? { ...EMPTY_DRAFT, id: 0 },
  );
  function submit(event: FormEvent) { event.preventDefault(); onSave(form); }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="sheet" onSubmit={submit}>
        <header><div><p>{initial ? "Edit draft" : "New draft"}</p><h2>{initial ? `To ${initial.recipient}` : "Draft a message"}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close draft form"><Icon name="x"/></button></header>
        <p className="draft-modal-note">your assistant never sends these. You edit the exact words here, approve them, copy them into LinkedIn, email, or text yourself, then mark the draft sent. Editing an approved draft sends it back to unapproved, so the words you send are always the words you signed off on.</p>
        <div className="form-grid">
          <label>Recipient<input required value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} placeholder="e.g. Alex Smith — Hiring Manager"/></label>
          <label>Channel<select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>{DRAFT_CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select></label>
          <label>Purpose<select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>{DRAFT_PURPOSES.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></label>
          <label>Linked application<select value={form.application_id === null ? "" : String(form.application_id)} onChange={(e) => setForm({ ...form, application_id: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Not linked</option>{applications.map((app) => <option key={app.id} value={app.id}>{app.company} — {app.role}</option>)}</select><span className="field-help">Link this draft to the exact role it is for — e.g. the Denver role for its regional manager.</span></label>
          <label className="wide">LinkedIn profile URL<input type="url" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })} placeholder="https://www.linkedin.com/in/…"/><span className="field-help">The person&rsquo;s LinkedIn, shown as a clickable link on the draft card — kept outside the message text. Leave blank on a re-save and a link already on file is kept.</span></label>
          <label className="wide">Employer / role scope<input value={form.employer_scope} onChange={(e) => setForm({ ...form, employer_scope: e.target.value })} placeholder="e.g. Example Corp — Specialist role, Example City (REQ-001) · Manager for this role"/><span className="field-help">Company + role context for this draft, when it isn&rsquo;t obvious from the linked application.</span></label>
          <div className="wide candidate-editor">
            <p className="candidate-editor-head">Candidate recipients for this role</p>
            <p className="field-help">When the exact regional manager isn&rsquo;t certain, list the plausible people here — each with their title, a territory/confidence note, and their LinkedIn. On the card, tapping a name fills that person into the message. One person is fine when the match is confident.</p>
            {(form.candidates ?? []).map((candidate, idx) => (
              <div key={idx} className="candidate-editor-row">
                <label>Candidate name<input value={candidate.name} onChange={(e) => setForm({ ...form, candidates: (form.candidates ?? []).map((c, i) => i === idx ? { ...c, name: e.target.value } : c) })} placeholder="e.g. Alex Smith" aria-label={`Candidate ${idx + 1} name`}/></label>
                <label>Title<input value={candidate.title} onChange={(e) => setForm({ ...form, candidates: (form.candidates ?? []).map((c, i) => i === idx ? { ...c, title: e.target.value } : c) })} placeholder="e.g. Regional Manager, North Region" aria-label={`Candidate ${idx + 1} title`}/></label>
                <label>Greeting as<select value={candidate.honorific} onChange={(e) => setForm({ ...form, candidates: (form.candidates ?? []).map((c, i) => i === idx ? { ...c, honorific: e.target.value } : c) })} aria-label={`Candidate ${idx + 1} greeting honorific`}><option value="">No honorific</option><option value="Mr.">Mr.</option><option value="Ms.">Ms.</option><option value="Mrs.">Mrs.</option><option value="Dr.">Dr.</option></select></label>
                <label>LinkedIn URL<input type="url" value={candidate.linkedin_url} onChange={(e) => setForm({ ...form, candidates: (form.candidates ?? []).map((c, i) => i === idx ? { ...c, linkedin_url: e.target.value } : c) })} placeholder="https://www.linkedin.com/in/…" aria-label={`Candidate ${idx + 1} LinkedIn URL`}/></label>
                <label className="candidate-editor-note">Territory / confidence note<input value={candidate.note} onChange={(e) => setForm({ ...form, candidates: (form.candidates ?? []).map((c, i) => i === idx ? { ...c, note: e.target.value } : c) })} placeholder="e.g. Best guess — territory unconfirmed" aria-label={`Candidate ${idx + 1} note`}/></label>
                <button type="button" className="draft-secondary candidate-remove" onClick={() => setForm({ ...form, candidates: (form.candidates ?? []).filter((_, i) => i !== idx) })} aria-label={`Remove candidate ${candidate.name || idx + 1}`}>Remove</button>
              </div>
            ))}
            <button type="button" className="draft-secondary" onClick={() => setForm({ ...form, candidates: [...(form.candidates ?? []), { name: "", title: "", note: "", linkedin_url: "", honorific: "" }] })}><Icon name="plus" size={14}/> Add a candidate</button>
          </div>
          <label className="wide">One-line read on the recipient<input value={form.recipient_read} onChange={(e) => setForm({ ...form, recipient_read: e.target.value })} placeholder="Who they are, where things stand, timing notes…"/></label>
          <label className="wide">Message<textarea rows={9} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="The exact words, ready to send…"/></label>
        </div>
        <footer><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save draft"}</button></footer>
      </form>
    </div>
  );
}

function OutreachView({ drafts, applications, copiedId, onNewDraft, onEditDraft, onDeleteDraft, onDraftStatus, onCopyDraft, onSelectCandidate }: {
  drafts: Draft[];
  applications: Application[];
  copiedId: number | null;
  onNewDraft: () => void;
  onEditDraft: (draft: Draft) => void;
  onDeleteDraft: (draft: Draft) => void;
  onDraftStatus: (draft: Draft, status: DraftStatus) => void;
  onCopyDraft: (draft: Draft) => void;
  onSelectCandidate: (draft: Draft, candidateName: string) => void;
}) {
  const appById = useMemo(() => new Map(applications.map((app) => [app.id, app])), [applications]);
  const labelFor = (draft: Draft) => {
    const app = draft.application_id !== null ? appById.get(draft.application_id) : undefined;
    return app ? `${app.company} — ${app.role}` : "";
  };
  const groups: { status: DraftStatus; title: string; hint: string }[] = [
    { status: "draft", title: "Waiting on your approval", hint: "Read it, edit the words if you want, then approve the exact text." },
    { status: "approved", title: "Approved — ready for you to send", hint: "Copy the approved text into the channel, send it there, then mark it sent here so the log stays exact." },
    { status: "sent", title: "Sent", hint: "Messages you approved and sent, with the date." },
    { status: "dropped", title: "Dropped", hint: "Drafts you passed on. Restore one if you change your mind." },
  ];
  return (
    <section className="outreach" aria-label="Outreach drafts">
      <div className="policy-banner policy-banner-single">
        <div className="policy-item">
          <p className="policy-title">Per-role regional managers — person, LinkedIn, draft</p>
          <p>For each role you apply to, the regional manager for that territory belongs here: their name, their LinkedIn as a clickable link on the card, and a short draft in your style underneath. When the exact manager isn&rsquo;t certain, the card lists the candidate people instead — tap a name and the message fills in for that person, with every candidate&rsquo;s LinkedIn right there. Auto-apply controls live in Settings now — this tab is only for people and messages.</p>
          <button type="button" className="draft-approve" onClick={onNewDraft}><Icon name="plus" size={15}/> New draft</button>
        </div>
        <div className="policy-item">
          <p className="policy-title">Messages: your approval, always</p>
          <p>your assistant drafts follow-ups, recruiter replies, and check-ins here, with a one-line read on the recipient. Nothing goes to LinkedIn or anywhere else until you approve the exact text, and you send it yourself from the approved copy. Editing an approved draft un-approves it.</p>
        </div>
      </div>
      {groups.map((group) => {
        // Waiting-on-approval renders first (it is the first group), and
        // inside every group the newest draft comes first — what needs
        // the user's decision is always the first thing on this tab.
        const items = drafts
          .filter((draft) => draft.status === group.status)
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
        if (items.length === 0 && group.status !== "draft") return null;
        return (
          <div key={group.status} className="draft-group">
            <div className="draft-group-head"><h3>{group.title}</h3><span>{items.length}</span></div>
            <p className="draft-group-hint">{group.hint}</p>
            {items.map((draft) => (
              <DraftCard key={draft.id} draft={draft} appLabel={labelFor(draft)} copied={copiedId === draft.id} onEdit={onEditDraft} onDelete={onDeleteDraft} onStatus={onDraftStatus} onCopy={onCopyDraft} onSelectCandidate={onSelectCandidate}/>
            ))}
            {items.length === 0 && <p className="empty-state">No drafts waiting. When your assistant drafts a follow-up or a reply, it lands here for your approval instead of being sent.</p>}
          </div>
        );
      })}
    </section>
  );
}

function LoginsView({ applications, loginRequests, requestingKey, onSaveLogin, onClearRequest, onOpenCard }: {
  applications: Application[];
  loginRequests: LoginRequest[];
  requestingKey: string | null;
  onSaveLogin: (group: LoginPortalGroup) => void;
  onClearRequest: (portalKey: string) => void;
  onOpenCard: (app: Application) => void;
}) {
  const groups = useMemo(() => loginPortalGroups(applications), [applications]);
  const requestFor = (key: string) => loginRequests.find((r) => r.portal_key === key && r.status !== "done");
  const totalCards = groups.reduce((n, g) => n + g.apps.length, 0);
  return (
    <section className="logins-view" aria-label="Logins needed">
      <div className="settings-head">
        <h2>Logins needed</h2>
        <p>Every application parked because a company portal needs <em>you</em> first — an account created or a login saved — grouped by portal, so one login unblocks everything behind it. This list is built live from the blocked cards: clear a card&rsquo;s block (or save the login and dismiss it) and its portal drops off here.</p>
      </div>
      <div className="settings-card login-howto">
        <p className="settings-title">How the two buttons work</p>
        <p className="settings-desc"><strong>Create account</strong> opens the employer&rsquo;s own sign-in / account page (the exact portal address on file — for Workday employers, their exact tenant page). <strong>Save login</strong> can&rsquo;t open the vault form inside the tracker — the Secure Vault entry form is a Muse chat card — so tapping it records the request here and sends that card into your Job Applications chat, pointed at this portal&rsquo;s exact address, titled for this company alone. Each company&rsquo;s password stays saved separately; no portal ever overwrites another&rsquo;s.</p>
      </div>
      {groups.length === 0 ? (
        <p className="empty-state">Nothing is stuck on a login right now. When auto-apply parks a card because a portal needs an account or a sign-in, it shows up here automatically.</p>
      ) : (
        <>
          <p className="logins-summary" role="status">{groups.length} portal{groups.length === 1 ? "" : "s"} blocking {totalCards} application{totalCards === 1 ? "" : "s"}</p>
          <div className="logins-list">
            {groups.map((group) => {
              const request = requestFor(group.key);
              const requesting = requestingKey === group.key;
              return (
                <article key={group.key} className="login-card">
                  <div className="login-card-top">
                    <div>
                      <p className="login-portal-name">{group.name}</p>
                      <p className="login-portal-meta">{group.system}{group.url ? ` · ${(() => { try { return new URL(group.url).hostname.replace(/^www\./, ""); } catch { return ""; } })()}` : " · no portal link on file yet"}</p>
                    </div>
                    <div className="login-blocker-chips">
                      {group.blockers.map((b) => <span key={b} className={`login-blocker-chip login-blocker-${b}`}>{LOGIN_BLOCKER_LABEL[b]}</span>)}
                    </div>
                  </div>
                  <p className="login-unblocks-label">Unblocks {group.apps.length} application{group.apps.length === 1 ? "" : "s"}:</p>
                  <ul className="login-unblocks">
                    {group.apps.map((app) => (
                      <li key={app.id}>
                        <button type="button" className="login-role-link" onClick={() => onOpenCard(app)} aria-label={`Open card for ${app.company} ${app.role}`}>
                          {app.role}
                        </button>
                        <span className="login-role-meta">{app.company}{app.req_id ? ` · #${app.req_id}` : ""}{app.location ? ` · ${app.location}` : ""} · {LOGIN_BLOCKER_LABEL[classifyLoginBlocker(app) ?? "sign_in_required"]}</span>
                      </li>
                    ))}
                  </ul>
                  {request && (
                    <p className="login-requested" role="status">
                      {request.status === "delivered"
                        ? `Vault card sent to your Job Applications chat${request.delivered_at ? ` ${formatWhen(request.delivered_at)}` : ""} — open the chat and save the login there.`
                        : `Card requested${request.requested_at ? ` ${formatWhen(request.requested_at)}` : ""} — the vault entry card is on its way to your Job Applications chat.`}
                    </p>
                  )}
                  <div className="login-actions">
                    {group.url ? (
                      <a className="login-create-button" href={group.url} target="_blank" rel="noreferrer" aria-label={`Create account or sign in at ${group.name}`}>
                        Create account <Icon name="arrow" size={15}/>
                      </a>
                    ) : (
                      <span className="login-no-url">No portal link on file — open a card above and add its posting or application link, and this button appears.</span>
                    )}
                    {request ? (
                      <button type="button" className="login-clear-button" onClick={() => onClearRequest(group.key)} aria-label={`Clear the login-save request for ${group.name}`}>
                        <Icon name="check" size={15}/> {request.status === "delivered" ? "Card sent — clear" : "Card requested — clear"}
                      </button>
                    ) : (
                      <button type="button" className="login-save-button" disabled={requesting} onClick={() => onSaveLogin(group)} aria-label={`Save login for ${group.name} — sends the secure vault card to your chat`}>
                        {requesting ? "Requesting card…" : "Save login"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

type TrackerSettings = TrackerData["settings"];

function SettingsView({ settings, applications, onUpdate }: {
  settings: TrackerSettings;
  applications: Application[];
  onUpdate: (partial: Partial<{ auto_apply_enabled: boolean; auto_apply_secondary_enabled: boolean; auto_apply_companies: string[]; auto_apply_role_types: string[]; auto_apply_states: string[]; auto_apply_scope_notes: string }>) => void;
}) {
  const [scopeDraft, setScopeDraft] = useState(settings.auto_apply_scope_notes ?? "");
  const [scopeSaved, setScopeSaved] = useState(false);
  // Keep the textarea in sync when settings load / refresh, without clobbering typing that hasn't been saved yet if it matches server.
  const companies = useMemo(() => {
    const set = new Map<string, string>();
    for (const app of applications) { const c = app.company.trim(); if (c) set.set(c.toLowerCase(), c); }
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [applications]);
  const selectedCompanies = settings.auto_apply_companies ?? ["*"];
  const everyCompany = selectedCompanies.includes("*");
  const selectedRoles = settings.auto_apply_role_types ?? ["*"];
  const allRoles = selectedRoles.includes("*");
  const selectedStates = settings.auto_apply_states ?? [...DEFAULT_STATES];

  function toggleCompany(company: string) {
    if (everyCompany) { onUpdate({ auto_apply_companies: [company] }); return; }
    const has = selectedCompanies.includes(company);
    const next = has ? selectedCompanies.filter((c) => c !== company) : [...selectedCompanies, company];
    onUpdate({ auto_apply_companies: next });
  }
  function toggleRole(value: string) {
    if (allRoles) { onUpdate({ auto_apply_role_types: [value] }); return; }
    const has = selectedRoles.includes(value);
    const next = has ? selectedRoles.filter((r) => r !== value) : [...selectedRoles, value];
    onUpdate({ auto_apply_role_types: next });
  }
  function toggleState(code: string) {
    const has = selectedStates.includes(code);
    const next = has ? selectedStates.filter((s) => s !== code) : [...selectedStates, code];
    onUpdate({ auto_apply_states: next });
  }
  function saveScope() {
    onUpdate({ auto_apply_scope_notes: scopeDraft.trim() });
    setScopeSaved(true);
    window.setTimeout(() => setScopeSaved(false), 2500);
  }
  return (
    <section className="settings-view" aria-label="Settings">
      <div className="settings-head">
        <h2>Settings</h2>
        <p>Control what auto-apply is allowed to do. Changes save with one tap and are read by the sweep and prep runner. Messaging approval stays in Outreach — nothing here sends a message.</p>
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <p className="settings-title">Automatic applications</p>
            <p className="settings-desc">{settings.auto_apply_enabled ? "On — your assistant submits roles that pass the scope below and records the employer's confirmation on the card. Parked steps (account creation, consent, EEO answers you haven't provided) still stop for you." : "Off — paused. your assistant will prep and park applications but won't submit anything until you turn this back on."}</p>
          </div>
          <button type="button" role="switch" aria-checked={settings.auto_apply_enabled} aria-label="Automatic applications" className={`toggle-switch ${settings.auto_apply_enabled ? "toggle-on" : ""}`} onClick={() => onUpdate({ auto_apply_enabled: !settings.auto_apply_enabled })}>
            <span className="toggle-knob" />
            <span className="toggle-label">{settings.auto_apply_enabled ? "ON" : "OFF"}</span>
          </button>
        </div>
        <button type="button" className="settings-onetap" onClick={() => onUpdate({ auto_apply_enabled: !settings.auto_apply_enabled })} aria-label={settings.auto_apply_enabled ? "Turn off automatic applications" : "Turn on automatic applications"}>
          {settings.auto_apply_enabled ? "Turn off auto-apply" : "Turn on auto-apply"}
        </button>
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <p className="settings-title">Secondary-lane job applications</p>
            <p className="settings-desc">{settings.auto_apply_secondary_enabled ? "On — secondary-lane jobs (the secondary board) are queued and submitted under the same scope below, alongside primary-lane roles." : "Off — secondary-lane applications are paused on their own. Queued secondary-lane cards are skipped and left exactly as they are — never blocked, never submitted — while primary-lane applications continue normally. Turn it back on and the queued secondary cards resume."}</p>
          </div>
          <button type="button" role="switch" aria-checked={settings.auto_apply_secondary_enabled} aria-label="Secondary-lane job applications" className={`toggle-switch ${settings.auto_apply_secondary_enabled ? "toggle-on" : ""}`} onClick={() => onUpdate({ auto_apply_secondary_enabled: !settings.auto_apply_secondary_enabled })}>
            <span className="toggle-knob" />
            <span className="toggle-label">{settings.auto_apply_secondary_enabled ? "ON" : "OFF"}</span>
          </button>
        </div>
        <button type="button" className="settings-onetap" onClick={() => onUpdate({ auto_apply_secondary_enabled: !settings.auto_apply_secondary_enabled })} aria-label={settings.auto_apply_secondary_enabled ? "Turn off secondary-lane job applications" : "Turn on secondary-lane job applications"}>
          {settings.auto_apply_secondary_enabled ? "Turn off secondary applications" : "Turn on secondary applications"}
        </button>
        <p className="settings-current">Separate from the main auto-apply switch above and from the company / role-type / state scope below — this one controls the secondary lane only.</p>
      </div>

      <div className="settings-card">
        <p className="settings-title">Companies</p>
        <p className="settings-desc">Tap “Every company” for all, or tap individual companies to limit auto-apply to just those. One tap saves.</p>
        <div className="chip-row" role="group" aria-label="Auto-apply companies">
          <button type="button" className={`scope-chip ${everyCompany ? "scope-chip-active" : ""}`} aria-pressed={everyCompany} onClick={() => onUpdate({ auto_apply_companies: ["*"] })}>Every company</button>
          {companies.map((company) => {
            const active = !everyCompany && selectedCompanies.includes(company);
            return <button key={company} type="button" className={`scope-chip ${active ? "scope-chip-active" : ""}`} aria-pressed={active} aria-label={`Auto-apply to ${company}`} onClick={() => toggleCompany(company)}>{company}</button>;
          })}
          {companies.length === 0 && <span className="settings-empty">No companies on the board yet — “Every company” covers new ones as they’re added.</span>}
        </div>
        {!everyCompany && selectedCompanies.length === 0 && <p className="settings-warn">No companies selected — auto-apply won’t submit anywhere until you pick at least one or “Every company.”</p>}
        <p className="settings-current">Current: {everyCompany ? "Every company" : selectedCompanies.length ? selectedCompanies.join(", ") : "None"}</p>
      </div>

      <div className="settings-card">
        <p className="settings-title">Role types</p>
        <p className="settings-desc">Tap “All role types” for all, or tap individual types to limit auto-apply. One tap saves.</p>
        <div className="chip-row" role="group" aria-label="Auto-apply role types">
          <button type="button" className={`scope-chip ${allRoles ? "scope-chip-active" : ""}`} aria-pressed={allRoles} onClick={() => onUpdate({ auto_apply_role_types: ["*"] })}>All role types</button>
          {ROLE_TYPE_OPTIONS.map((opt) => {
            const active = !allRoles && selectedRoles.includes(opt.value);
            return <button key={opt.value} type="button" className={`scope-chip ${active ? "scope-chip-active" : ""}`} aria-pressed={active} aria-label={`Auto-apply role type ${opt.label}`} onClick={() => toggleRole(opt.value)}>{opt.label}</button>;
          })}
        </div>
        <p className="settings-current">Current: {allRoles ? "All role types" : selectedRoles.length ? selectedRoles.map((v) => ROLE_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v).join(", ") : "None"}</p>
      </div>

      <div className="settings-card">
        <p className="settings-title">States — where applications go</p>
        <p className="settings-desc">Turn individual states on or off. Only roles in ON states get queued and submitted. Your approved states start ON; everything else starts OFF. One tap saves.</p>
        <div className="chip-row settings-quick-row">
          <button type="button" className="scope-chip" onClick={() => onUpdate({ auto_apply_states: [] })} aria-label="Clear selected states">Clear states</button>
          <button type="button" className="scope-chip" onClick={() => onUpdate({ auto_apply_states: US_STATES.map((s) => s.code) })} aria-label="Turn on all states">All states on</button>
          <button type="button" className="scope-chip" onClick={() => onUpdate({ auto_apply_states: [] })} aria-label="Turn off all states">All states off</button>
        </div>
        <div className="state-grid" role="group" aria-label="Auto-apply states">
          {US_STATES.map((st) => {
            const on = selectedStates.includes(st.code);
            return (
              <button key={st.code} type="button" role="switch" aria-checked={on} aria-label={`${st.name} (${st.code}) applications ${on ? "on" : "off"}`} className={`state-toggle ${on ? "state-on" : ""}`} onClick={() => toggleState(st.code)}>
                <span className="state-code">{st.code}</span>
                <span className="state-name">{st.name}</span>
                <span className="state-state">{on ? "ON" : "OFF"}</span>
              </button>
            );
          })}
        </div>
        <p className="settings-current">On now ({selectedStates.length}): {selectedStates.length ? [...selectedStates].sort().join(", ") : "none — auto-apply won’t submit anywhere"}</p>
      </div>

      <div className="settings-card">
        <p className="settings-title">Scope notes — anything else</p>
        <p className="settings-desc">Free-text rules for auto-apply that don’t fit the buttons above — a territory, a division, pay floor, companies to avoid, anything. Type, save, or clear it right here.</p>
        <label className="settings-scope-label">Auto-apply scope notes
          <textarea rows={5} value={scopeDraft} onChange={(e) => { setScopeDraft(e.target.value); setScopeSaved(false); }} placeholder="e.g. My target companies first. My target titles only. No pure-commission secondary jobs. My home region plus remote…" aria-label="Auto-apply scope notes" />
        </label>
        <div className="settings-scope-actions">
          <button type="button" className="primary-button settings-save" onClick={saveScope}>Save scope notes</button>
          <button type="button" className="draft-secondary" onClick={() => { setScopeDraft(""); onUpdate({ auto_apply_scope_notes: "" }); }} aria-label="Clear scope notes">Clear</button>
          {scopeSaved && <span role="status" className="settings-saved">Saved</span>}
        </div>
        {settings.auto_apply_scope_notes && scopeDraft !== settings.auto_apply_scope_notes && <p className="settings-warn">Unsaved edits — tap “Save scope notes” to store them.</p>}
      </div>
    </section>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const tracker = useQuery({ queryKey: ["tracker"], queryFn: () => api.listTracker({}) });
  const [tab, setTab] = useState<Tab>("pipeline");
  const [search, setSearch] = useState("");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("All");
  const [tagFilter, setTagFilter] = useState("All");
  const [editingApp, setEditingApp] = useState<Application | null | undefined>(undefined);
  const [editingContact, setEditingContact] = useState<Contact | null | undefined>(undefined);
  const [editingDraft, setEditingDraft] = useState<Draft | null | undefined>(undefined);
  const [questionnaireApp, setQuestionnaireApp] = useState<Application | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [requestingLoginKey, setRequestingLoginKey] = useState<string | null>(null);

  const currentLane: Lane = tab === "secondary" ? "secondary" : "primary";

  const laneApps = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (tracker.data?.applications ?? []).filter((app) => app.lane === currentLane)
      .filter((app) => tagFilter === "All" || app.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase()))
      .filter((app) => !query || `${app.company} ${app.role} ${app.location} ${app.req_id} ${app.notes} ${app.tags.join(" ")}`.toLowerCase().includes(query))
      .sort((a, b) => rank(a) - rank(b) || a.company.localeCompare(b.company));
  }, [tracker.data, currentLane, search, tagFilter]);

  const boardApps = useMemo(
    () => {
      if (boardFilter === "All") return laneApps;
      if (boardFilter === "InPlay") return laneApps.filter((app) => app.stage !== "Closed/Rejected");
      if (boardFilter === "ActiveApplications") return laneApps.filter((app) => app.stage === "Applied" || app.stage === "Interviewing" || app.stage === "Offer");
      return laneApps.filter((app) => app.stage === boardFilter);
    },
    [laneApps, boardFilter],
  );
  const visibleStages: Stage[] = boardFilter === "All" || boardFilter === "InPlay"
    ? ACTIVE_STAGES
    : boardFilter === "ActiveApplications" ? ["Applied", "Interviewing", "Offer"]
    : ACTIVE_STAGES.includes(boardFilter as Stage) ? [boardFilter as Stage] : ACTIVE_STAGES;
  const archiveApps = useMemo(() => laneApps.filter((app) => app.stage === "Closed/Rejected"), [laneApps]);
  const archiveVisible = archiveOpen || boardFilter === "Closed/Rejected";

  async function refresh() { await queryClient.invalidateQueries({ queryKey: ["tracker"] }); }
  async function moveApplication(id: number, stage: Stage) {
    setError("");
    try { await api.moveApplication({ id, stage }); await refresh(); } catch { setError("That card could not be moved. Try again."); }
  }
  async function resetPrep(id: number) {
    setError("");
    try { await api.resetPrep({ id }); await refresh(); } catch { setError("That prep request could not be cleared. Try again."); }
  }
  async function runHealthCheck() {
    setChecking(true); setError("");
    try {
      const result = await api.dailyMaintenance({});
      setReport(result);
      await refresh();
    } catch { setError("The health check could not run. Try again."); } finally { setChecking(false); }
  }
  async function saveApplication(value: Omit<Application, "created_at" | "updated_at">) {
    setSaving(true); setError("");
    try {
      const payload = { lane: value.lane, company: value.company, role: value.role, location: value.location, pay: value.pay, req_id: value.req_id, stage: value.stage, notes: value.notes, people: value.people, tags: value.tags, source_url: value.source_url, employer_url: value.employer_url, link_status: value.link_status };
      if (value.id > 0) {
        await api.updateApplication({
          id: value.id, ...payload,
          submit_url: value.submit_url, prep_notes: value.prep_notes,
          fit_score: value.fit_score, fit_notes: value.fit_notes,
        });
      } else {
        await api.createApplication(payload);
      }
      setEditingApp(undefined); await refresh();
    } catch { setError("The opportunity could not be saved. Check the fields and try again."); } finally { setSaving(false); }
  }
  async function deleteApplication(app: Application) {
    setError("");
    try { await api.deleteApplication({ id: app.id }); await refresh(); } catch { setError("The opportunity could not be deleted."); }
  }
  async function saveContact(value: Omit<Contact, "created_at" | "updated_at">) {
    setSaving(true); setError("");
    try {
      const payload = { person: value.person, company_role: value.company_role, channel: value.channel, last_contact: value.last_contact, next_touch: value.next_touch, notes: value.notes };
      if (value.id > 0) await api.updateContact({ id: value.id, ...payload }); else await api.createContact(payload);
      setEditingContact(undefined); await refresh();
    } catch { setError("The contact could not be saved. Check the fields and try again."); } finally { setSaving(false); }
  }
  async function deleteContact(contact: Contact) {
    setError("");
    try { await api.deleteContact({ id: contact.id }); await refresh(); } catch { setError("The contact could not be deleted."); }
  }
  async function saveDraft(value: Omit<Draft, "created_at" | "updated_at" | "sent_at" | "status">) {
    setSaving(true); setError("");
    try {
      const payload = { application_id: value.application_id, recipient: value.recipient, channel: value.channel, purpose: value.purpose, body: value.body, recipient_read: value.recipient_read, linkedin_url: value.linkedin_url ?? "", employer_scope: value.employer_scope ?? "", candidates: (value.candidates ?? []).filter((c) => c.name.trim() !== ""), selected_candidate: value.selected_candidate ?? "" };
      if (value.id > 0) await api.updateDraft({ id: value.id, ...payload }); else await api.createDraft(payload);
      setEditingDraft(undefined); await refresh();
    } catch { setError("The draft could not be saved. Check the fields and try again."); } finally { setSaving(false); }
  }
  async function deleteDraft(draft: Draft) {
    setError("");
    try { await api.deleteDraft({ id: draft.id }); await refresh(); } catch { setError("The draft could not be deleted."); }
  }
  async function setDraftStatus(draft: Draft, status: DraftStatus) {
    setError("");
    try { await api.setDraftStatus({ id: draft.id, status }); await refresh(); }
    catch { setError(status === "sent" ? "Only an approved draft can be marked sent. Approve the exact text first." : "That draft could not be updated. Try again."); }
  }
  async function selectDraftCandidate(draft: Draft, candidateName: string) {
    if (candidateName === (draft.selected_candidate || draft.recipient)) return;
    setError("");
    try { await api.selectDraftCandidate({ id: draft.id, candidate_name: candidateName }); await refresh(); }
    catch { setError("That candidate could not be filled into the message. Try again."); }
  }
  async function copyDraft(draft: Draft) {
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopiedId(draft.id);
      window.setTimeout(() => setCopiedId((current) => (current === draft.id ? null : current)), 4000);
    } catch { setError("Copy did not work here. Open Edit and copy the text manually."); }
  }
  async function updateSettings(partial: Partial<{ auto_apply_enabled: boolean; auto_apply_secondary_enabled: boolean; auto_apply_companies: string[]; auto_apply_role_types: string[]; auto_apply_states: string[]; auto_apply_scope_notes: string }>) {
    setError("");
    try { await api.updateSettings(partial); await refresh(); }
    catch { setError("That setting could not be saved. Try again."); }
  }

  async function requestLoginSave(group: LoginPortalGroup) {
    setError("");
    setRequestingLoginKey(group.key);
    try {
      const primary = group.blockers[0] ?? "sign_in_required";
      await api.requestLoginSave({
        portal_key: group.key,
        portal_name: group.name,
        portal_url: group.url,
        company: group.company,
        blocker_type: LOGIN_BLOCKER_LABEL[primary],
        roles: group.apps.map((app) => `${app.company} — ${app.role}${app.req_id ? ` (#${app.req_id})` : ""}`),
      });
      await refresh();
    } catch { setError("That login-save request could not be recorded. Try again."); } finally { setRequestingLoginKey(null); }
  }
  async function clearLoginRequest(portalKey: string) {
    setError("");
    try { await api.clearLoginRequest({ portal_key: portalKey }); await refresh(); }
    catch { setError("That request could not be cleared. Try again."); }
  }
  function openLoginCard(app: Application) {
    setTab(app.lane === "secondary" ? "secondary" : "pipeline");
    setEditingApp(app);
  }

  async function saveQuestionnaire(appId: number, answers: FitAnswers, fitNotes: string) {
    setSaving(true); setError("");
    try {
      await api.saveFitQuestionnaire({ id: appId, answers, fit_notes: fitNotes });
      setQuestionnaireApp(null);
      await refresh();
    } catch { setError("The questionnaire could not be saved. Try again."); } finally { setSaving(false); }
  }
  async function clearQuestionnaire(appId: number) {
    setSaving(true); setError("");
    try {
      await api.clearFitQuestionnaire({ id: appId });
      setQuestionnaireApp(null);
      await refresh();
    } catch { setError("The questionnaire could not be cleared. Try again."); } finally { setSaving(false); }
  }
  function draftForContact(contact: Contact) {
    setEditingDraft({
      ...EMPTY_DRAFT, id: 0, status: "draft", sent_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      recipient: contact.person,
      channel: DRAFT_CHANNELS.includes(contact.channel) ? contact.channel : "LinkedIn",
      recipient_read: [contact.company_role, contact.next_touch ? `Next touch: ${contact.next_touch}` : ""].filter(Boolean).join(" · "),
    });
    setTab("outreach");
  }

  if (tracker.isPending) return <div className="loading"><span/><p>Loading pipeline…</p></div>;
  if (tracker.error) return <div className="load-error"><h2>Pipeline unavailable</h2><p>We could not load the tracker.</p><button onClick={() => tracker.refetch()}>Try again</button></div>;
  const allContacts = tracker.data?.contacts ?? [];
  const contacts = allContacts
    .filter((contact) => !search.trim() || `${contact.person} ${contact.company_role} ${contact.channel} ${contact.next_touch}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.next_touch.trim())) - Number(Boolean(a.next_touch.trim())));
  const commandApps = (tracker.data?.applications ?? []).filter((app) => app.lane === currentLane);
  const allApps = tracker.data?.applications ?? [];
  const allDrafts = tracker.data?.drafts ?? [];
  const draftsWaitingCount = allDrafts.filter((draft) => draft.status === "draft").length;
  const visibleDrafts = allDrafts.filter((draft) => !search.trim() || `${draft.recipient} ${draft.channel} ${draft.purpose} ${draft.body} ${(draft.candidates ?? []).map((c) => `${c.name} ${c.title}`).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const loginGroups = loginPortalGroups(allApps);
  const loginBlockedCount = loginGroups.reduce((n, g) => n + g.apps.length, 0);

  return (
    <div className="app-shell">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main>
        <div className="workspace-head">
          <nav className="tabs" aria-label="Tracker views">
            <button className={tab === "onboarding" ? "active" : ""} onClick={() => setTab("onboarding")}>Onboarding</button>
            <button className={tab === "pipeline" ? "active" : ""} onClick={() => setTab("pipeline")}>Pipeline <span>{tracker.data?.applications.filter((a) => a.lane === "primary").length}</span></button>
            <button className={tab === "secondary" ? "active" : ""} onClick={() => setTab("secondary")}>Secondary Jobs <span>{tracker.data?.applications.filter((a) => a.lane === "secondary").length}</span></button>
            <button className={tab === "logins" ? "active" : ""} onClick={() => setTab("logins")}>Logins <span>{loginBlockedCount}</span></button>
            <button className={tab === "contacts" ? "active" : ""} onClick={() => setTab("contacts")}>Key Contacts <span>{tracker.data?.contacts.length}</span></button>
            <button className={tab === "outreach" ? "active" : ""} onClick={() => setTab("outreach")}>Outreach <span>{draftsWaitingCount}</span></button>
            <button className={tab === "health" ? "active" : ""} onClick={() => setTab("health")}>Health</button>
            <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings</button>
          </nav>
          {tab !== "settings" && tab !== "health" && tab !== "logins" && tab !== "onboarding" && <button className="add-button" onClick={() => tab === "contacts" ? setEditingContact(null) : tab === "outreach" ? setEditingDraft(null) : setEditingApp(null)}><Icon name="plus"/> {tab === "contacts" ? "Add contact" : tab === "outreach" ? "New draft" : "Quick add"}</button>}
        </div>

        {(tab === "pipeline" || tab === "secondary") && (
          <CommandCenter slim apps={commandApps} contactCount={allContacts.length} draftsWaiting={draftsWaitingCount} onEdit={setEditingApp} onShowDrafts={() => setTab("outreach")} activeFilter={boardFilter} onFilter={(filter) => { setBoardFilter(filter); setTab(currentLane === "secondary" ? "secondary" : "pipeline"); }} onShowContacts={() => setTab("contacts")} />
        )}

        {tab !== "settings" && tab !== "health" && tab !== "logins" && tab !== "onboarding" && (
        <section className="controls" aria-label="Search and filters">
          <label className="search-field"><Icon name="search"/><span className="sr-only">Search tracker</span><input aria-label="Search tracker" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === "contacts" ? "Search people or company" : tab === "outreach" ? "Search drafts by person or text" : "Search company, role, req…"}/></label>
          {tab !== "contacts" && tab !== "outreach" && <><label><span className="sr-only">Filter by stage</span><select aria-label="Filter by stage" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value as BoardFilter)}><option value="All">All stages</option><option value="InPlay">In Play (all active)</option><option value="ActiveApplications">Active applications (Applied / Interviewing / Offer)</option>{ALL_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label><label><span className="sr-only">Filter by tag</span><select aria-label="Filter by tag" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}><option>All</option>{TAGS.map((tag) => <option key={tag}>{tag}</option>)}</select></label></>}
        </section>
        )}
        {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error"><Icon name="x" size={14}/></button></div>}

        {tab === "onboarding" ? (
          <OnboardingView />
        ) : tab === "health" ? (
          <div className="health-view">
            <CommandCenter apps={commandApps} contactCount={allContacts.length} draftsWaiting={draftsWaitingCount} onEdit={setEditingApp} onShowDrafts={() => setTab("outreach")} activeFilter={boardFilter} onFilter={(filter) => { setBoardFilter(filter); setTab(currentLane === "secondary" ? "secondary" : "pipeline"); }} onShowContacts={() => setTab("contacts")} />
            <HealthPanel apps={allApps} contacts={allContacts} drafts={allDrafts} report={report} running={checking} onRun={runHealthCheck} onShowGuide={() => setGuideOpen(true)} />
          </div>
        ) : tab === "settings" ? (
          <SettingsView
            settings={tracker.data?.settings ?? { auto_apply_enabled: true, auto_apply_secondary_enabled: true, auto_apply_companies: ["*"], auto_apply_role_types: ["*"], auto_apply_scope_notes: "", auto_apply_states: [...DEFAULT_STATES] }}
            applications={allApps}
            onUpdate={updateSettings}
          />
        ) : tab === "logins" ? (
          <LoginsView
            applications={allApps}
            loginRequests={tracker.data?.login_requests ?? []}
            requestingKey={requestingLoginKey}
            onSaveLogin={requestLoginSave}
            onClearRequest={clearLoginRequest}
            onOpenCard={openLoginCard}
          />
        ) : tab === "outreach" ? (
          <OutreachView
            drafts={visibleDrafts}
            applications={allApps}
            copiedId={copiedId}
            onNewDraft={() => setEditingDraft(null)}
            onEditDraft={setEditingDraft}
            onDeleteDraft={deleteDraft}
            onDraftStatus={setDraftStatus}
            onCopyDraft={copyDraft}
            onSelectCandidate={selectDraftCandidate}
          />
        ) : tab === "contacts" ? (
          <section className="contacts-list" aria-label="Key contacts">
            <div className="contacts-heading"><div><p>RELATIONSHIPS ARE THE LEVER</p><h2>Who needs a touch next?</h2></div><span>{contacts.length} people</span></div>
            {contacts.map((contact) => <ContactCard key={contact.id} contact={contact} duplicate={allContacts.filter((c) => c.person.trim().toLowerCase() === contact.person.trim().toLowerCase()).length > 1} onEdit={setEditingContact} onDelete={deleteContact} onDraft={draftForContact}/>)}
            {contacts.length === 0 && <p className="empty-state">No contacts match this search.</p>}
          </section>
        ) : (
          <>
            {boardFilter !== "All" && (
              <div className="filter-bar" role="status">
                <span>Showing: <strong>{boardFilter === "InPlay" ? "In Play — all active cards" : boardFilter === "ActiveApplications" ? "Active applications — Applied, Interviewing, Offer" : boardFilter}</strong> · {boardApps.length} card{boardApps.length === 1 ? "" : "s"}</span>
                <button type="button" className="filter-clear" onClick={() => setBoardFilter("All")}>Show all</button>
              </div>
            )}
            <section className={`board ${tab === "secondary" ? "secondary-board" : ""} ${visibleStages.length === 1 ? "board-single" : ""}`} aria-label={tab === "secondary" ? "Secondary jobs board" : "Job pipeline"}>
              {visibleStages.map((stage) => <StageColumn key={stage} stage={stage} apps={boardApps.filter((app) => app.stage === stage)} onEdit={setEditingApp} onDelete={deleteApplication} onMove={moveApplication} onResetPrep={resetPrep} onQuestionnaire={setQuestionnaireApp} onShowGuide={() => setGuideOpen(true)}/>)}
            </section>
            <section className="archive" aria-label="Archive of closed and rejected applications">
              <button type="button" className="archive-toggle" aria-expanded={archiveVisible} onClick={() => setArchiveOpen((value) => !value)}>
                <span className="archive-toggle-label">Archive · Closed / Rejected</span>
                <span className="archive-count">{archiveApps.length}</span>
                <span className={`archive-chevron ${archiveVisible ? "open" : ""}`}><Icon name="chevron" size={16}/></span>
              </button>
              {archiveVisible && (
                <div className="archive-list">
                  {archiveApps.map((app) => <AppCard key={app.id} app={app} onEdit={setEditingApp} onDelete={deleteApplication} onMove={moveApplication} onResetPrep={resetPrep} onQuestionnaire={setQuestionnaireApp} onShowGuide={() => setGuideOpen(true)}/>)}
                  {archiveApps.length === 0 && <p className="empty-state">Nothing archived here yet.</p>}
                </div>
              )}
            </section>
          </>
        )}
      </main>
      {editingApp !== undefined && <ApplicationModal initial={editingApp} lane={currentLane} onClose={() => setEditingApp(undefined)} onSave={saveApplication} saving={saving}/>}
      {editingContact !== undefined && <ContactModal initial={editingContact} onClose={() => setEditingContact(undefined)} onSave={saveContact} saving={saving}/>}
      {editingDraft !== undefined && <DraftModal initial={editingDraft} applications={allApps} onClose={() => setEditingDraft(undefined)} onSave={saveDraft} saving={saving}/>}
      {questionnaireApp && <FitQuestionnaireModal app={questionnaireApp} onClose={() => setQuestionnaireApp(null)} onSave={saveQuestionnaire} onClear={clearQuestionnaire} saving={saving}/>}
      {guideOpen && <FitGuideModal onClose={() => setGuideOpen(false)} onStartQuestionnaire={() => setGuideOpen(false)}/>}
    </div>
  );
}
