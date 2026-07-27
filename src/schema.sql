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
-- token ist das Geheimnis im QR-Code. Ohne Anmeldung ist ein Spint nur ueber
-- diesen Token erreichbar — mit fortlaufenden IDs koennte sonst jeder im WLAN
-- alle Spinte durchprobieren und die Daten aller Jugendlichen lesen.
CREATE TABLE IF NOT EXISTS lockers (
  id        INTEGER PRIMARY KEY,
  code      TEXT NOT NULL COLLATE NOCASE,           -- steht auf dem QR-Etikett, z.B. "01"
  token     TEXT,                                   -- Geheimnis fuer den QR-Link
  label     TEXT,                                   -- optionale Bezeichnung
  location  TEXT,                                   -- z.B. "Umkleide links"
  area_id   INTEGER REFERENCES areas(id),
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  note      TEXT
);
-- Der Index auf token entsteht in migrate() (db.js), weil bei einer aelteren
-- Datenbank erst die Spalte nachgeruestet werden muss.

CREATE UNIQUE INDEX IF NOT EXISTS lockers_member_unique
  ON lockers(member_id) WHERE member_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lockers_area_code
  ON lockers(area_id, code);

-- Groessenschemata. Kleidung wird nach Koerpergroesse gefuehrt, Handschuhe und
-- Schuhe nach eigenen Reihen — darum je Ausruestungsart ein eigenes Schema.
CREATE TABLE IF NOT EXISTS size_schemes (
  name  TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  note  TEXT
);

-- Die gueltigen Groessen eines Schemas, aufsteigend sortiert. "gruppe" ist nur
-- eine Beschriftung (z.B. "Körpergröße" / "Konfektion"), die Reihenfolge steckt
-- in sort_order: nach 176 folgt 44, weil dort die Erwachsenengroessen anfangen.
CREATE TABLE IF NOT EXISTS sizes (
  id         INTEGER PRIMARY KEY,
  scheme     TEXT NOT NULL REFERENCES size_schemes(name) ON DELETE CASCADE,
  gruppe     TEXT,
  wert       TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sizes_unique ON sizes(scheme, wert COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS sizes_scheme_idx ON sizes(scheme, sort_order);

-- Ausruestungsarten (Jacke, Hose, Helm, ...)
-- barcode_prefix: fester Anfang aller Inventarnummern dieser Art, z.B.
-- "KKJF.1202." bei Helmen oder "112000" bei Jacken. Wird eine kurze Nummer
-- eingetippt, ergaenzt die Software den Anfang selbst.
-- barcode_digits: auf wie viele Stellen der eingetippte Rest aufgefuellt wird
-- (leer = gar nicht).
CREATE TABLE IF NOT EXISTS equipment_types (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  has_size        INTEGER NOT NULL DEFAULT 1,
  has_inventory   INTEGER NOT NULL DEFAULT 1,
  size_scheme     TEXT REFERENCES size_schemes(name) ON DELETE SET NULL,
  barcode_prefix  TEXT,
  barcode_digits  INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  active          INTEGER NOT NULL DEFAULT 1
);

-- Lagerorte (Schrank, Regal, Kiste ...). Jeder bekommt einen eigenen QR-Code.
CREATE TABLE IF NOT EXISTS storages (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- z.B. "Schrank 1"
  token      TEXT,                                   -- Geheimnis fuer den QR-Link
  location   TEXT,                                   -- z.B. "Gerätehaus, Raum 2"
  note       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Index auf token: siehe migrate() in db.js.

-- Einzelne Ausruestungsstuecke. Wo ein Teil liegt, ergibt sich so:
--   locker_id gesetzt                  -> in diesem Spint
--   locker_id NULL, storage_id gesetzt -> an diesem Lagerort
--   beide NULL                         -> im Lager, noch ohne Ort
-- Beides gleichzeitig gesetzt gibt es nicht; das stellt der Code sicher
-- (setPlacement in model.js), damit alte und neue Datenbanken gleich sind.
CREATE TABLE IF NOT EXISTS equipment (
  id           INTEGER PRIMARY KEY,
  type_id      INTEGER NOT NULL REFERENCES equipment_types(id),
  size         TEXT,
  inventory_no TEXT,
  condition    TEXT NOT NULL DEFAULT 'gut' CHECK (condition IN ('gut', 'gebraucht', 'defekt')),
  note         TEXT,
  locker_id    INTEGER REFERENCES lockers(id) ON DELETE SET NULL,
  storage_id   INTEGER REFERENCES storages(id) ON DELETE SET NULL,
  retired      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS equipment_locker_idx  ON equipment(locker_id);
CREATE INDEX IF NOT EXISTS equipment_storage_idx ON equipment(storage_id);
CREATE INDEX IF NOT EXISTS equipment_inv_idx     ON equipment(inventory_no);

-- Aufgaben, die beim Jugendwart auflaufen: Kleidungsstueck in anderer Groesse
-- besorgen oder ersetzen. Art, Mitglied und Spint stehen zusaetzlich als eigene
-- Spalten drin, damit die Aufgabe lesbar bleibt, wenn das Teil spaeter wegfaellt.
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('tausch', 'bestellung')),
  status       TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen', 'erledigt', 'abgebrochen')),
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  type_id      INTEGER REFERENCES equipment_types(id),
  member_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
  locker_id    INTEGER REFERENCES lockers(id) ON DELETE SET NULL,
  from_size    TEXT,
  to_size      TEXT,
  reason       TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT,
  done_at      TEXT,
  done_by      TEXT
);

CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status, id DESC);

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

-- Zugaenge fuer andere Systeme. Gespeichert wird nur der Hash des Tokens —
-- im Klartext bekommt man ihn genau einmal beim Anlegen zu sehen.
CREATE TABLE IF NOT EXISTS api_tokens (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope      TEXT NOT NULL DEFAULT 'lesen' CHECK (scope IN ('lesen', 'schreiben')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  last_used  TEXT
);

-- Sessions (eigener Store, damit kein zweites DB-Modul noetig ist)
CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  data    TEXT NOT NULL
);
