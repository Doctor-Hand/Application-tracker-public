import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const applications = sqliteTable("applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lane: text("lane", { enum: ["primary", "secondary"] }).notNull(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  location: text("location").notNull().default(""),
  pay: text("pay").notNull().default(""),
  reqId: text("req_id").notNull().default(""),
  stage: text("stage", { enum: ["Leads", "Needs Submitting", "Applied", "Interviewing", "Offer", "Closed/Rejected"] }).notNull().default("Leads"),
  notes: text("notes").notNull().default(""),
  people: text("people").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  sourceUrl: text("source_url").notNull().default(""),
  employerUrl: text("employer_url").notNull().default(""),
  linkStatus: text("link_status", { enum: ["unchecked", "live", "dead"] }).notNull().default("unchecked"),
  linkCheckedAt: integer("link_checked_at", { mode: "timestamp_ms" }),
  prepStatus: text("prep_status", { enum: ["none", "requested", "in_progress", "done", "blocked"] }).notNull().default("none"),
  submitUrl: text("submit_url").notNull().default(""),
  prepNotes: text("prep_notes").notNull().default(""),
  prepRequestedAt: integer("prep_requested_at", { mode: "timestamp_ms" }),
  prepUpdatedAt: integer("prep_updated_at", { mode: "timestamp_ms" }),
  fitScore: integer("fit_score"),
  fitBreakdown: text("fit_breakdown").notNull().default("{}"),
  fitNotes: text("fit_notes").notNull().default(""),
  fitManual: integer("fit_manual").notNull().default(0),
  fitAnswers: text("fit_answers").notNull().default("{}"),
  fitSource: text("fit_source", { enum: ["auto", "manual", "questionnaire", "sweep"] }).notNull().default("auto"),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
  submissionConfirmation: text("submission_confirmation").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const outreachDrafts = sqliteTable("outreach_drafts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  applicationId: integer("application_id"),
  recipient: text("recipient").notNull(),
  channel: text("channel").notNull().default("LinkedIn"),
  purpose: text("purpose").notNull().default("Follow-up"),
  body: text("body").notNull().default(""),
  recipientRead: text("recipient_read").notNull().default(""),
  linkedinUrl: text("linkedin_url").notNull().default(""),
  employerScope: text("employer_scope").notNull().default(""),
  candidates: text("candidates").notNull().default("[]"),
  selectedCandidate: text("selected_candidate").notNull().default(""),
  status: text("status", { enum: ["draft", "approved", "sent", "dropped"] }).notNull().default("draft"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const trackerSettings = sqliteTable("tracker_settings", {
  id: integer("id").primaryKey(),
  autoApply: integer("auto_apply").notNull().default(1),
  autoApplySecondary: integer("auto_apply_secondary_enabled").notNull().default(1),
  autoApplyCompanies: text("auto_apply_companies").notNull().default('["*"]'),
  autoApplyRoleTypes: text("auto_apply_role_types").notNull().default('["*"]'),
  autoApplyScopeNotes: text("auto_apply_scope_notes").notNull().default(""),
  autoApplyStates: text("auto_apply_states").notNull().default('[]'),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

/**
 * A "Save login" request for one employer portal, recorded when the user taps
 * the button on the Logins needed list. The Secure Vault entry form itself
 * is a native Muse chat card and cannot render inside the tracker, so this
 * row is the durable record that a card was asked for (and, once the spawned
 * task reports back, that it was delivered into his Job Applications chat).
 * Keyed by portal_key — the same portal identity the Logins list groups
 * blocked cards by — so one request covers every card that portal unblocks.
 */
export const loginRequests = sqliteTable("login_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  portalKey: text("portal_key").notNull().unique(),
  portalName: text("portal_name").notNull().default(""),
  portalUrl: text("portal_url").notNull().default(""),
  company: text("company").notNull().default(""),
  blockerType: text("blocker_type").notNull().default(""),
  status: text("status", { enum: ["requested", "delivered", "done"] }).notNull().default("requested"),
  requestedAt: integer("requested_at", { mode: "timestamp_ms" }),
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  person: text("person").notNull(),
  companyRole: text("company_role").notNull().default(""),
  channel: text("channel").notNull().default(""),
  lastContact: text("last_contact").notNull().default(""),
  nextTouch: text("next_touch").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

/**
 * The onboarding questionnaire profile (single row, id 1). Answers are
 * stored as one JSON document in `data` so the questionnaire can grow
 * without a migration per question; `completed` flips when the user
 * finishes the review step. Resume text the user pastes/uploads lives in
 * the JSON too — it is the user's own data in their own database.
 */
export const onboardingProfiles = sqliteTable("onboarding_profiles", {
  id: integer("id").primaryKey(),
  data: text("data").notNull().default("{}"),
  currentStep: integer("current_step").notNull().default(0),
  completed: integer("completed").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
