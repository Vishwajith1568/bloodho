PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- IDENTITY
-- ============================================================
CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('donor','requester','bank','admin')),
  -- role-scoped owning row; meaning depends on role
  donor_id      INTEGER,
  bank_id       INTEGER,
  hospital_id   INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_account ON sessions(account_id);

-- ============================================================
-- PEOPLE AND PLACES
-- ============================================================
CREATE TABLE donors (
  id                  INTEGER PRIMARY KEY,
  full_name           TEXT NOT NULL,
  blood_group         TEXT NOT NULL CHECK (blood_group IN ('O-','O+','A-','A+','B-','B+','AB-','AB+')),
  gender              TEXT NOT NULL CHECK (gender IN ('male','female')),
  date_of_birth       TEXT,
  phone               TEXT NOT NULL,
  locality            TEXT NOT NULL,
  lat                 REAL NOT NULL,
  lng                 REAL NOT NULL,
  last_donation_date  TEXT,
  -- contact preference: how the donor wants to be reached once they accept
  contact_pref        TEXT NOT NULL DEFAULT 'call' CHECK (contact_pref IN ('call','sms','whatsapp','in_app')),
  quiet_hours         INTEGER NOT NULL DEFAULT 0,
  -- availability toggle: donor can go temporarily unavailable
  is_available        INTEGER NOT NULL DEFAULT 1,
  unavailable_until   TEXT,
  unavailable_reason  TEXT,
  verification_state  TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (verification_state IN ('unverified','pending','verified','revoked')),
  total_donations     INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_donors_group ON donors(blood_group);
CREATE INDEX idx_donors_avail ON donors(is_available);

CREATE TABLE hospitals (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  locality   TEXT NOT NULL,
  address    TEXT NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  phone      TEXT NOT NULL,
  has_blood_bank INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE blood_banks (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  locality   TEXT NOT NULL,
  address    TEXT NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  phone      TEXT NOT NULL,
  licence_no TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  onboarded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- STOCK (batch-level so expiry and wastage are honest)
-- ============================================================
CREATE TABLE stock_batches (
  id           INTEGER PRIMARY KEY,
  bank_id      INTEGER NOT NULL REFERENCES blood_banks(id),
  blood_group  TEXT NOT NULL,
  component    TEXT NOT NULL CHECK (component IN ('whole_blood','prbc','platelets','plasma')),
  units        INTEGER NOT NULL CHECK (units >= 0),
  collected_on TEXT NOT NULL,
  expires_on   TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('voluntary','replacement','camp','transfer')),
  status       TEXT NOT NULL DEFAULT 'available'
               CHECK (status IN ('available','reserved','issued','expired','discarded')),
  camp_id      INTEGER
);
CREATE INDEX idx_batch_bank ON stock_batches(bank_id, blood_group, component, status);
CREATE INDEX idx_batch_expiry ON stock_batches(expires_on);

CREATE TABLE stock_movements (
  id          INTEGER PRIMARY KEY,
  bank_id     INTEGER NOT NULL REFERENCES blood_banks(id),
  batch_id    INTEGER REFERENCES stock_batches(id),
  kind        TEXT NOT NULL CHECK (kind IN ('receipt','issue','transfer_in','transfer_out','discard','reserve','release')),
  blood_group TEXT NOT NULL,
  component   TEXT NOT NULL,
  units       INTEGER NOT NULL,
  counterparty TEXT,
  request_id  INTEGER,
  note        TEXT,
  actor       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_moves_bank ON stock_movements(bank_id, created_at);

-- ============================================================
-- REQUESTS
-- ============================================================
CREATE TABLE requests (
  id                 INTEGER PRIMARY KEY,
  ref_code           TEXT NOT NULL UNIQUE,
  requester_account_id INTEGER REFERENCES accounts(id),
  patient_ref        TEXT NOT NULL,
  patient_age        INTEGER,
  blood_group        TEXT NOT NULL,
  component          TEXT NOT NULL CHECK (component IN ('whole_blood','prbc','platelets','plasma')),
  units_needed       INTEGER NOT NULL CHECK (units_needed > 0),
  units_pledged      INTEGER NOT NULL DEFAULT 0,
  units_fulfilled    INTEGER NOT NULL DEFAULT 0,
  urgency            TEXT NOT NULL CHECK (urgency IN ('critical','urgent','scheduled')),
  hospital_id        INTEGER NOT NULL REFERENCES hospitals(id),
  ward               TEXT,
  attendant_name     TEXT NOT NULL,
  attendant_phone    TEXT NOT NULL,
  lat                REAL NOT NULL,
  lng                REAL NOT NULL,
  verification_state TEXT NOT NULL DEFAULT 'unverified'
                     CHECK (verification_state IN ('unverified','otp_verified','hospital_verified','rejected')),
  hospital_ref_no    TEXT,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','broadcasting','partially_fulfilled','fulfilled','cancelled','expired')),
  radius_stage       INTEGER NOT NULL DEFAULT 0,   -- index into [5,10,15,25]
  stage_started_at   TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  broadcast_at       TEXT,
  fulfilled_at       TEXT,
  is_flagged         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_requests_status ON requests(status, created_at);

CREATE TABLE request_matches (
  id           INTEGER PRIMARY KEY,
  request_id   INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  donor_id     INTEGER NOT NULL REFERENCES donors(id),
  distance_km  REAL NOT NULL,
  radius_stage INTEGER NOT NULL,
  notified_at  TEXT NOT NULL DEFAULT (datetime('now')),
  response     TEXT NOT NULL DEFAULT 'pending'
               CHECK (response IN ('pending','accepted','declined','expired','no_show','donated')),
  responded_at TEXT,
  units_pledged INTEGER NOT NULL DEFAULT 0,
  -- donor phone stays hidden until response = 'accepted'
  UNIQUE (request_id, donor_id)
);
CREATE INDEX idx_matches_donor ON request_matches(donor_id, response);

CREATE TABLE bank_claims (
  id         INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  bank_id    INTEGER NOT NULL REFERENCES blood_banks(id),
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','accepted','reserved','rejected','issued')),
  units      INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_id, bank_id)
);

CREATE TABLE otp_codes (
  id         INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  consumed   INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- DONOR LIFE
-- ============================================================
CREATE TABLE donations (
  id            INTEGER PRIMARY KEY,
  donor_id      INTEGER NOT NULL REFERENCES donors(id),
  donated_on    TEXT NOT NULL,
  component     TEXT NOT NULL,
  units         INTEGER NOT NULL DEFAULT 1,
  donation_type TEXT NOT NULL CHECK (donation_type IN ('voluntary','replacement')),
  bank_id       INTEGER REFERENCES blood_banks(id),
  hospital_id   INTEGER REFERENCES hospitals(id),
  camp_id       INTEGER,
  request_id    INTEGER REFERENCES requests(id),
  certificate_no TEXT
);
CREATE INDEX idx_donations_donor ON donations(donor_id, donated_on);

CREATE TABLE badges (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  descriptor TEXT NOT NULL,
  threshold  INTEGER
);

CREATE TABLE donor_badges (
  donor_id  INTEGER NOT NULL REFERENCES donors(id),
  badge_id  INTEGER NOT NULL REFERENCES badges(id),
  earned_on TEXT NOT NULL,
  PRIMARY KEY (donor_id, badge_id)
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  donor_id   INTEGER REFERENCES donors(id),
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  request_id INTEGER REFERENCES requests(id),
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- CAMPS
-- ============================================================
CREATE TABLE camps (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  organiser     TEXT NOT NULL,
  venue         TEXT NOT NULL,
  locality      TEXT NOT NULL,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  camp_date     TEXT NOT NULL,
  start_time    TEXT NOT NULL,
  end_time      TEXT NOT NULL,
  bank_id       INTEGER REFERENCES blood_banks(id),
  capacity      INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','ongoing','completed','cancelled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE camp_registrations (
  id            INTEGER PRIMARY KEY,
  camp_id       INTEGER NOT NULL REFERENCES camps(id) ON DELETE CASCADE,
  donor_id      INTEGER NOT NULL REFERENCES donors(id),
  slot_time     TEXT,
  status        TEXT NOT NULL DEFAULT 'registered'
                CHECK (status IN ('registered','attended','no_show','cancelled')),
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (camp_id, donor_id)
);

CREATE TABLE camp_collections (
  id          INTEGER PRIMARY KEY,
  camp_id     INTEGER NOT NULL REFERENCES camps(id),
  bank_id     INTEGER NOT NULL REFERENCES blood_banks(id),
  blood_group TEXT NOT NULL,
  component   TEXT NOT NULL,
  units       INTEGER NOT NULL,
  collected_on TEXT NOT NULL,
  batch_id    INTEGER REFERENCES stock_batches(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- GOVERNANCE
-- ============================================================
CREATE TABLE verification_requests (
  id          INTEGER PRIMARY KEY,
  donor_id    INTEGER NOT NULL REFERENCES donors(id),
  document_kind TEXT NOT NULL,
  document_ref  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE flags (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER REFERENCES requests(id),
  donor_id    INTEGER REFERENCES donors(id),
  reason      TEXT NOT NULL CHECK (reason IN ('hoax','duplicate','abusive','payment_demand','wrong_details','other')),
  detail      TEXT,
  raised_by   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','upheld','dismissed')),
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE feedback (
  id           INTEGER PRIMARY KEY,
  source_portal TEXT NOT NULL CHECK (source_portal IN ('donor','requester','bank','admin')),
  account_id   INTEGER REFERENCES accounts(id),
  author_name  TEXT NOT NULL,
  category     TEXT NOT NULL,
  rating       INTEGER,
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','actioned','closed')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transfers (
  id            INTEGER PRIMARY KEY,
  from_bank_id  INTEGER NOT NULL REFERENCES blood_banks(id),
  to_bank_id    INTEGER NOT NULL REFERENCES blood_banks(id),
  blood_group   TEXT NOT NULL,
  component     TEXT NOT NULL,
  units         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested','approved','rejected','completed')),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
