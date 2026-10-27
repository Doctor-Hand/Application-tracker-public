-- Cleaned template migration: creates every tracker table with no seed data.
-- Consolidated into one migration for the public template so no personal
-- applications, contacts, notes, or settings from any real tracker are
-- included. Apply to a fresh SQLite database.
CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane TEXT NOT NULL CHECK (lane IN ('medical','bridge')),
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  pay TEXT NOT NULL DEFAULT '',
  req_id TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'Leads' CHECK (stage IN ('Leads','Needs Submitting','Applied','Interviewing','Offer','Closed/Rejected')),
  notes TEXT NOT NULL DEFAULT '',
  people TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  source_url TEXT NOT NULL DEFAULT '',
  employer_url TEXT NOT NULL DEFAULT '',
  link_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (link_status IN ('unchecked','live','dead')),
  link_checked_at INTEGER,
  prep_status TEXT NOT NULL DEFAULT 'none' CHECK (prep_status IN ('none','requested','in_progress','done','blocked')),
  submit_url TEXT NOT NULL DEFAULT '',
  prep_notes TEXT NOT NULL DEFAULT '',
  prep_requested_at INTEGER,
  prep_updated_at INTEGER,
  fit_score INTEGER,
  fit_breakdown TEXT NOT NULL DEFAULT '{}',
  fit_notes TEXT NOT NULL DEFAULT '',
  fit_manual INTEGER NOT NULL DEFAULT 0,
  fit_answers TEXT NOT NULL DEFAULT '{}',
  fit_source TEXT NOT NULL DEFAULT 'auto' CHECK (fit_source IN ('auto','manual','questionnaire','sweep')),
  submitted_at INTEGER,
  submission_confirmation TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  company_role TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  last_contact TEXT NOT NULL DEFAULT '',
  next_touch TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE outreach_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  application_id INTEGER,
  recipient TEXT NOT NULL,
  channel TEXT DEFAULT 'LinkedIn' NOT NULL,
  purpose TEXT DEFAULT 'Follow-up' NOT NULL,
  body TEXT DEFAULT '' NOT NULL,
  recipient_read TEXT DEFAULT '' NOT NULL,
  linkedin_url TEXT DEFAULT '' NOT NULL,
  employer_scope TEXT DEFAULT '' NOT NULL,
  candidates TEXT DEFAULT '[]' NOT NULL,
  selected_candidate TEXT DEFAULT '' NOT NULL,
  status TEXT DEFAULT 'draft' NOT NULL,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE tracker_settings (
  id INTEGER PRIMARY KEY NOT NULL,
  auto_apply INTEGER DEFAULT 1 NOT NULL,
  auto_apply_bridge_enabled INTEGER DEFAULT 1 NOT NULL,
  auto_apply_companies TEXT DEFAULT '["*"]' NOT NULL,
  auto_apply_role_types TEXT DEFAULT '["*"]' NOT NULL,
  auto_apply_scope_notes TEXT DEFAULT '' NOT NULL,
  auto_apply_states TEXT DEFAULT '[]' NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO tracker_settings (id, updated_at) VALUES (1, 0);
--> statement-breakpoint
CREATE TABLE login_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portal_key TEXT NOT NULL UNIQUE,
  portal_name TEXT NOT NULL DEFAULT '',
  portal_url TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  blocker_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','delivered','done')),
  requested_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE onboarding_profiles (
  id INTEGER PRIMARY KEY NOT NULL,
  data TEXT DEFAULT '{}' NOT NULL,
  current_step INTEGER DEFAULT 0 NOT NULL,
  completed INTEGER DEFAULT 0 NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
