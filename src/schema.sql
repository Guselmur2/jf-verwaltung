PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Betreuer / Jugendwarte
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('betreuer', 'jugendwart')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Jugendliche. gender: 'm' maennlich, 'w' weiblich, 'd' divers (NULL = ohne Angabe)
CREATE TABLE IF NOT EXISTS members (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  birthday TEXT,                                    -- ISO yyyy-mm-dd
  phone    TEXT,
  note     TEXT,
  gender   TEXT CHECK (gender IN ('m', 'w', 'd')),
  active   INTEGER NOT NULL DEFAULT 1
);

-- Umkleidebereiche. Ein Bereich buendelt die Spinte eines oder mehrerer
-- Geschlechter. numbering legt fest, ob die Spint-Nummerierung im Bereich neu
-- beginnt ('eigen') oder ueber alle Bereiche fortlaeuft ('fortlaufend').
CREATE TABLE IF NOT EXISTS areas (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  numbering  TEXT NOT NULL DEFAULT 'eigen' CHECK (numbering IN ('eigen', 'fortlaufend')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Zuordnung Geschlecht -> Umkleidebereich.
CREATE TABLE IF NOT EXISTS gender_area (
  gender  TEXT PRIMARY KEY CHECK (gender IN ('m', 'w', 'd')),
  area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE
);

-- Spinte. code ist nur je Bereich eindeutig, damit die Nummerierung pro Bereich
-- neu beginnen darf. Angesprochen werden Spinte deshalb ueber die id.
CREATE TABLE IF NOT EXISTS lockers (
  id        INTEGER PRIMARY KEY,
  code      TEXT NOT NULL COLLATE NOCASE,           -- steht auf dem QR-Etikett, z.B. "01"
  label     TEXT,                                   -- optionale Bezeichnung
  location  TEXT,                                   -- z.B. "Umkleide links"
  area_id   INTEGER REFERENCES areas(id),
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  note      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS lockers_member_unique
  ON lockers(member_id) WHERE member_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lockers_area_code
  ON lockers(area_id, code);

-- Ausruestungsarten (Jacke, Hose, Helm, ...)
CREATE TABLE IF NOT EXISTS equipment_types (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  has_size        INTEGER NOT NULL DEFAULT 1,
  has_inventory   INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  active          INTEGER NOT NULL DEFAULT 1
);

-- Einzelne Ausruestungsstuecke. locker_id NULL = liegt im Lager.
CREATE TABLE IF NOT EXISTS equipment (
  id           INTEGER PRIMARY KEY,
  type_id      INTEGER NOT NULL REFERENCES equipment_types(id),
  size         TEXT,
  inventory_no TEXT,
  condition    TEXT NOT NULL DEFAULT 'gut' CHECK (condition IN ('gut', 'gebraucht', 'defekt')),
  note         TEXT,
  locker_id    INTEGER REFERENCES lockers(id) ON DELETE SET NULL,
  retired      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS equipment_locker_idx ON equipment(locker_id);
CREATE INDEX IF NOT EXISTS equipment_inv_idx    ON equipment(inventory_no);

-- Aenderungsprotokoll
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  ts        TEXT NOT NULL DEFAULT (datetime('now')),
  user_id   INTEGER,
  username  TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  action    TEXT NOT NULL,
  detail    TEXT
);

CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_log(ts DESC);

-- Sessions (eigener Store, damit kein zweites DB-Modul noetig ist)
CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  data    TEXT NOT NULL
);
