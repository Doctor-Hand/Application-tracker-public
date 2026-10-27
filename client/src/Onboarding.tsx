import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Onboarding questionnaire — the first-run wizard for a fresh copy of this
 * template. It starts with the user's resume, then email connection and
 * job-alert setup, then everything the tracker needs to personalize fit
 * scoring, lead sweeps, and application answers: targets, locations, pay,
 * experience, standing answers, network, and automation preferences.
 *
 * Everything is optional except a name and one target title, progress is
 * saved after every step (see getOnboarding / saveOnboarding), and no
 * answer is ever guessed — fields the user leaves blank stay blank.
 */

type Profile = Record<string, unknown>;

const str = (p: Profile, k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
const bool = (p: Profile, k: string) => p[k] === true;
const list = (p: Profile, k: string) => (Array.isArray(p[k]) ? (p[k] as string[]) : []);

const STEPS = [
  "Resume",
  "Connect email",
  "Job alerts",
  "About you",
  "Targets",
  "Locations",
  "Pay",
  "Experience",
  "Standing answers",
  "Network",
  "Automation",
  "Review & finish",
] as const;

const US_STATE_CODES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

const KEY_FIELDS: Array<[string, string]> = [
  ["resume_file_name", "Resume uploaded (or text pasted below)"],
  ["full_name", "Your name"],
  ["target_titles", "At least one target job title"],
  ["email_provider", "Email provider chosen"],
  ["linkedin_alerts_status", "LinkedIn job alerts checked"],
  ["indeed_alerts_status", "Indeed job alerts checked"],
  ["home_base", "Home base location"],
  ["target_total", "Target compensation"],
];

export function OnboardingView() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["onboarding"], queryFn: () => api.getOnboarding({}) });
  const [profile, setProfile] = useState<Profile>({});
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (query.data && !loaded) {
      setProfile(query.data.data as Profile);
      setStep(Math.min(query.data.current_step, STEPS.length - 1));
      setFinished(query.data.completed);
      setLoaded(true);
    }
  }, [query.data, loaded]);

  const set = (k: string, v: unknown) => setProfile((p) => ({ ...p, [k]: v }));

  const completion = useMemo(() => {
    const done = KEY_FIELDS.filter(([k]) => str(profile, k).trim() !== "").length;
    return Math.round((done / KEY_FIELDS.length) * 100);
  }, [profile]);

  async function save(nextStep: number, complete: boolean) {
    setSaving(true);
    try {
      await api.saveOnboarding({ data: profile, current_step: nextStep, completed: complete });
      await queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      await queryClient.invalidateQueries({ queryKey: ["tracker"] });
      setSavedNote(complete ? "Onboarding complete — your answers now drive this tracker." : "Progress saved.");
      if (complete) setFinished(true);
    } finally {
      setSaving(false);
    }
  }

  function onResumeFile(file: File | null) {
    if (!file) return;
    set("resume_file_name", file.name);
    set("resume_file_size", String(file.size));
    if (/text|markdown/.test(file.type) || /\.(txt|md)$/i.test(file.name)) {
      file.text().then((text) => set("resume_text", text.slice(0, 200_000))).catch(() => {});
    }
  }

  const Text = ({ k, label, placeholder, type }: { k: string; label: string; placeholder?: string; type?: string }) => (
    <label>{label}<input type={type ?? "text"} value={str(profile, k)} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} /></label>
  );
  const Area = ({ k, label, placeholder, rows }: { k: string; label: string; placeholder?: string; rows?: number }) => (
    <label className="wide">{label}<textarea rows={rows ?? 3} value={str(profile, k)} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} /></label>
  );
  const Select = ({ k, label, options }: { k: string; label: string; options: Array<[string, string]> }) => (
    <label>{label}<select value={str(profile, k)} onChange={(e) => set(k, e.target.value)}>
      <option value="">Choose…</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select></label>
  );
  const Check = ({ k, label }: { k: string; label: string }) => (
    <label className="onboarding-check"><input type="checkbox" checked={bool(profile, k)} onChange={(e) => set(k, e.target.checked)} /> {label}</label>
  );

  if (query.isLoading || !loaded) return <section className="settings-view"><p className="empty-state">Loading your onboarding…</p></section>;

  return (
    <section className="settings-view onboarding" aria-label="Onboarding questionnaire">
      <div className="settings-head">
        <h2>{finished ? "Your profile" : "Start here — onboarding"}</h2>
        <p>
          Twelve short steps, resume first. Your answers personalize the fit score, the lead sweep, and your
          standing application answers. Progress saves as you go, everything can be edited later, and nothing
          here leaves your own tracker database. {completion}% of the key fields are filled in.
        </p>
        <div className="onboarding-progress" role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${completion}%` }} />
        </div>
        {savedNote && <p className="settings-current">{savedNote}</p>}
      </div>

      <nav className="onboarding-steps" aria-label="Onboarding steps">
        {STEPS.map((name, i) => (
          <button key={name} type="button" className={i === step ? "active" : ""} onClick={() => setStep(i)}>
            {i + 1}. {name}
          </button>
        ))}
      </nav>

      <div className="settings-card">
        {step === 0 && (
          <div className="form-grid">
            <p className="settings-desc wide">Upload your resume first — the rest of the questionnaire pre-fills from it where it can. PDF/DOCX: the file name is saved here; paste the resume text underneath so the tracker can actually use it. Text files (.txt/.md) are read automatically.</p>
            <label className="wide">Resume file
              <input type="file" accept=".pdf,.doc,.docx,.txt,.md" onChange={(e) => onResumeFile(e.target.files?.[0] ?? null)} />
            </label>
            {str(profile, "resume_file_name") && <p className="settings-current wide">On file: {str(profile, "resume_file_name")}{str(profile, "resume_text") ? ` — ${str(profile, "resume_text").length.toLocaleString()} characters of text available` : " — paste the text below"}</p>}
            <Area k="resume_text" label="Resume text (paste if you uploaded a PDF/DOCX)" rows={8} placeholder="Paste your full resume text here…" />
            <Text k="headline" label="Headline" placeholder="The one line under your name, e.g. 'Aspiring surgical sales rep — 5 yrs clinical support'" />
            <Text k="linkedin_profile_url" label="LinkedIn profile URL" placeholder="https://www.linkedin.com/in/…" type="url" />
            <Text k="portfolio_url" label="Portfolio / website URL (optional)" type="url" />
          </div>
        )}

        {step === 1 && (
          <div className="form-grid">
            <p className="settings-desc wide">Your assistant finds leads, interview invites, and decisions in your inbox — but only what you allow. Connecting the account itself happens in your assistant's connector settings; this step records your choices so there's a written record of what was agreed.</p>
            <Select k="email_provider" label="Email provider" options={[["gmail", "Gmail"], ["outlook", "Outlook"], ["icloud", "iCloud"], ["other", "Other"], ["none", "Not yet — I don't want email connected"]]} />
            <Select k="email_connected" label="Is it connected to your assistant?" options={[["yes", "Yes — connected"], ["not_yet", "Not yet"], ["later", "I'll do it later"]]} />
            <Select k="email_scan_frequency" label="How often may it scan?" options={[["daily", "Daily"], ["twice_daily", "Twice a day"], ["weekly", "Weekly"], ["manual", "Only when I ask"]]} />
            <div className="wide">
              <Check k="scan_job_alerts" label="Job-alert emails (LinkedIn, Indeed, boards)" />
              <Check k="scan_interview_invites" label="Interview invitations and scheduling mail" />
              <Check k="scan_decisions" label="Decisions and rejections" />
              <Check k="scan_recruiter_mail" label="Recruiter messages" />
              <Check k="email_label_setup" label="I've set up a label/filter for job-search mail" />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="form-grid">
            <p className="settings-desc wide">The sweep is only as good as the alerts feeding it. On LinkedIn: Jobs → Job alerts → create one alert per target title + location, email frequency <strong>Daily</strong>. On Indeed: Job Alerts → add the same titles + locations, daily emails on.</p>
            <Select k="linkedin_alerts_status" label="LinkedIn job-alert emails" options={[["set_up", "Set up"], ["not_yet", "Not yet"], ["help", "Help me set them up"]]} />
            <Select k="linkedin_alert_frequency" label="LinkedIn alert frequency" options={[["daily", "Daily"], ["weekly", "Weekly"], ["off", "Off"]]} />
            <Text k="linkedin_alert_titles" label="LinkedIn alert titles" placeholder="Comma-separated, e.g. Associate Sales Rep, Territory Manager" />
            <Text k="linkedin_alert_locations" label="LinkedIn alert locations" placeholder="Comma-separated cities or 'Remote'" />
            <Select k="indeed_alerts_status" label="Indeed job-alert emails" options={[["set_up", "Set up"], ["not_yet", "Not yet"], ["help", "Help me set them up"]]} />
            <Select k="indeed_alert_frequency" label="Indeed alert frequency" options={[["daily", "Daily"], ["weekly", "Weekly"], ["off", "Off"]]} />
            <Text k="indeed_alert_titles" label="Indeed alert titles" placeholder="Same titles as LinkedIn, ideally" />
            <Text k="indeed_alert_locations" label="Indeed alert locations" placeholder="Comma-separated cities or 'Remote'" />
            <Area k="company_alerts" label="Company career-page alerts you've switched on" placeholder="One per line — company + the page where you subscribed" />
            <Area k="other_boards" label="Other boards / sources for your field" placeholder="Field-specific boards, associations, newsletters — one per line, with alert status" />
          </div>
        )}

        {step === 3 && (
          <div className="form-grid">
            <Text k="full_name" label="Full name" />
            <Text k="preferred_name" label="What should your assistant call you?" />
            <Text k="home_base" label="Home base (city, state)" placeholder="e.g. Austin, TX" />
            <Text k="timezone" label="Timezone" placeholder="e.g. America/Chicago" />
            <Text k="phone" label="Phone (optional — stored only in your database)" type="tel" />
            <div className="wide"><Check k="form_address_opt_in" label="Store the address I use on application forms (opt-in — forms only, never shared)" /></div>
            {bool(profile, "form_address_opt_in") && <Area k="form_address" label="Form address" rows={2} />}
          </div>
        )}

        {step === 4 && (
          <div className="form-grid">
            <Text k="primary_lane" label="Primary lane (your words)" placeholder="e.g. medical sales, product design, skilled trades" />
            <Area k="target_titles" label="Target job titles — the exact titles that count as a match" rows={3} placeholder="One per line" />
            <Text k="seniority_target" label="Seniority target" placeholder="e.g. associate / entry-level, mid-level, senior" />
            <Text k="bridge_lane" label="Bridge lane (income while you search — optional)" placeholder="e.g. fitness coaching, freelance design" />
            <Area k="bridge_titles" label="Bridge-lane titles" rows={2} placeholder="One per line" />
            <Area k="dream_companies" label="Dream / priority companies" rows={2} placeholder="One per line" />
            <Area k="avoid_companies" label="Companies to avoid" rows={2} placeholder="One per line" />
            <Area k="deal_breakers" label="Hard deal-breakers" rows={2} placeholder="e.g. pure commission, >50% travel, relocation" />
          </div>
        )}

        {step === 5 && (
          <div className="form-grid">
            <p className="settings-desc wide">Tap the states you'd accept work in — finishing onboarding copies these into your auto-apply scope in Settings.</p>
            <div className="wide onboarding-states">
              {US_STATE_CODES.map((code) => {
                const on = list(profile, "states_on").includes(code);
                return <button key={code} type="button" className={on ? "scope-chip active" : "scope-chip"} onClick={() => set("states_on", on ? list(profile, "states_on").filter((s) => s !== code) : [...list(profile, "states_on"), code])}>{code}</button>;
              })}
            </div>
            <Select k="remote_pref" label="Work style" options={[["any", "Any"], ["remote", "Remote only"], ["hybrid", "Hybrid"], ["onsite", "On-site"]]} />
            <Select k="relocate" label="Willing to relocate?" options={[["yes", "Yes"], ["no", "No"], ["right_role", "For the right role"]]} />
            <Text k="travel_max" label="Maximum travel" placeholder="e.g. 25%, overnight weekly, none" />
            <Text k="commute_radius" label="Commute radius" placeholder="e.g. 45 minutes / 30 miles" />
            <Select k="on_call_ok" label="On-call tolerance" options={[["yes", "Fine with it"], ["some", "Some"], ["no", "No on-call"]]} />
          </div>
        )}

        {step === 6 && (
          <div className="form-grid">
            <Text k="target_total" label="Target total compensation" placeholder="e.g. $90,000/yr" />
            <Text k="min_base" label="Minimum base you'd accept" placeholder="e.g. $65,000/yr" />
            <Text k="min_total" label="Minimum total you'd accept" placeholder="e.g. $75,000/yr" />
            <Area k="pay_notes" label="Pay notes" rows={3} placeholder="e.g. No pure-commission roles. Car allowance matters. Hourly bridge work must be guaranteed, not commission-only." />
          </div>
        )}

        {step === 7 && (
          <div className="form-grid">
            <p className="settings-desc wide">Pre-fill this from your resume in step 1, then fix what's wrong — fit scoring and form answers draw on it.</p>
            <Text k="years_experience" label="Years of aligned experience" placeholder="e.g. 6 years (2 in the field, 4 adjacent)" />
            <Area k="top_skills" label="Top skills" rows={3} placeholder="Comma-separated" />
            <Area k="education_summary" label="Education" rows={3} placeholder="School — degree, field (one per line)" />
            <Area k="certifications" label="Certifications / licenses" rows={2} placeholder="One per line" />
            <Text k="languages" label="Languages" placeholder="Comma-separated" />
          </div>
        )}

        {step === 8 && (
          <div className="form-grid">
            <p className="settings-desc wide">The questions almost every application asks. Answer once, here — never guessed later. Anything you leave blank parks that application for your answer instead of inventing one.</p>
            <Select k="work_authorized" label="Authorized to work in your country?" options={[["yes", "Yes"], ["no", "No"]]} />
            <Select k="sponsorship_needed" label="Will you need sponsorship?" options={[["no", "No"], ["yes", "Yes"]]} />
            <Select k="drivers_license" label="Valid driver's license (if the role needs one)?" options={[["yes", "Yes"], ["no", "No"], ["na", "Not applicable"]]} />
            <Text k="shift_availability" label="Shift availability" placeholder="e.g. any/all, weekdays only, no overnights" />
            <Text k="start_availability" label="Earliest start" placeholder="e.g. immediately, two weeks' notice" />
            <Select k="restrictive_covenant" label="Bound by a non-compete / restrictive covenant?" options={[["no", "No"], ["yes", "Yes"], ["unsure", "Not sure"]]} />
            <div className="wide">
              <Check k="self_id_opt_in" label="Store my self-ID / EEO answers for forms (optional, explicit opt-in — they live only in my database and I can delete them any time)" />
            </div>
            {bool(profile, "self_id_opt_in") && <Area k="self_id_notes" label="Self-ID answers (exactly as you want them entered)" rows={3} />}
          </div>
        )}

        {step === 9 && (
          <div className="form-grid">
            <p className="settings-desc wide">Cold applications are the weakest path in — this step captures your warm one. The people themselves belong in the Key Contacts tab; here it's the strategy.</p>
            <Area k="warm_network_notes" label="Who already knows you at target companies?" rows={4} placeholder="Name — company — how you know them (one per line). Add them as contacts too." />
            <Select k="referral_happy" label="Happy to ask for referrals / intros?" options={[["yes", "Yes"], ["selective", "Selectively"], ["no", "Not yet"]]} />
            <Text k="weekly_outreach_target" label="Weekly outreach target" placeholder="e.g. 2 check-ins a week" />
          </div>
        )}

        {step === 10 && (
          <div className="form-grid">
            <Select k="approval_mode" label="How should applications be submitted?" options={[["draft_only", "Draft/prep only — I submit everything myself"], ["approve_each", "Prepare each one — I approve, then it submits"], ["auto_gates", "Auto-submit roles that pass my fit gates with every required field known; park anything blocked"]]} />
            <Select k="sweep_frequency" label="Lead sweep frequency" options={[["daily", "Daily"], ["weekdays", "Weekdays"], ["weekly", "Weekly"], ["manual", "Only when I ask"]]} />
            <Text k="checkin_day" label="Weekly check-in day" placeholder="e.g. Sunday evening" />
            <div className="wide">
              <Check k="outreach_ack" label="I understand: outreach is draft-only. Nothing is ever sent without my exact-text approval — I copy and send it myself." />
            </div>
          </div>
        )}

        {step === 11 && (
          <div className="form-grid">
            <p className="settings-desc wide">Your data lives in your own copy of this tracker's database. The template never publishes or shares it. Export a backup before you make big changes, and never commit your real database, resume, or contacts to a public repo.</p>
            <div className="wide">
              <h3 className="settings-title">Still missing</h3>
              {KEY_FIELDS.filter(([k]) => str(profile, k).trim() === "").length === 0
                ? <p className="settings-current">All key fields are filled in.</p>
                : <ul>{KEY_FIELDS.filter(([k]) => str(profile, k).trim() === "").map(([, label]) => <li key={label}>{label}</li>)}</ul>}
            </div>
            <div className="wide">
              <Check k="storage_ack" label="I understand my answers and resume text are stored in my own tracker database, and I can edit or delete them at any time." />
              <Check k="backup_ack" label="I'll keep my own backup/export of my tracker data." />
            </div>
            <p className="settings-current wide">Finishing copies your selected states into the Settings auto-apply scope and marks your profile complete. You can reopen any step at any time.</p>
          </div>
        )}

        <div className="onboarding-nav">
          <button type="button" disabled={step === 0 || saving} onClick={() => { const n = step - 1; setStep(n); void save(n, false); }}>Back</button>
          {step < STEPS.length - 1 ? (
            <button type="button" disabled={saving} onClick={() => { const n = step + 1; setStep(n); void save(n, false); }}>{saving ? "Saving…" : "Save & continue"}</button>
          ) : (
            <button type="button" disabled={saving || !bool(profile, "storage_ack") || !bool(profile, "outreach_ack")} onClick={() => void save(step, true)}>
              {saving ? "Saving…" : finished ? "Save profile" : "Finish onboarding"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
