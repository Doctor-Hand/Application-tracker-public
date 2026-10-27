-- Optional fictional example rows. Do NOT use this as a migration for real data.
-- Replace the values with your own applications and contacts.
INSERT INTO applications (lane, company, role, location, pay, req_id, stage, notes, people, tags, source_url, created_at, updated_at)
VALUES ('primary', 'Example Corp', 'Example Role', 'Example City, CA', '', 'EXAMPLE-001', 'Leads', 'Fictional example only.', 'Example Contact - hiring manager', '["associate-level"]', '', 0, 0);
INSERT INTO contacts (person, company_role, channel, last_contact, next_touch, notes, created_at, updated_at)
VALUES ('Example Contact', 'Example Corp - hiring manager', 'LinkedIn', '', '', 'Fictional example only.', 0, 0);
