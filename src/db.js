'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'spinte.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('foreign_keys = ON');

function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();
  seedEquipmentTypes();
}

function hasColumn(table, column) {
  // Tabellenname ist intern und fest, daher keine Injektionsgefahr.
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

// Bringt aeltere Datenbanken auf den aktuellen Stand. Fuer frisch angelegte
// Datenbanken sind alle Schritte No-ops, weil das Schema schon passt.
function migrate() {
  if (!hasColumn('members', 'gender')) {
    db.exec("ALTER TABLE members ADD COLUMN gender TEXT");
  }
  if (!hasColumn('lockers', 'area_id')) {
    db.exec('ALTER TABLE lockers ADD COLUMN area_id INTEGER REFERENCES areas(id)');
  }
  if (!hasColumn('equipment', 'storage_id')) {
    db.exec('ALTER TABLE equipment ADD COLUMN storage_id INTEGER REFERENCES storages(id)');
    db.exec('CREATE INDEX IF NOT EXISTS equipment_storage_idx ON equipment(storage_id)');
  }
  dropGlobalCodeUniqueIfPresent();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS lockers_area_code ON lockers(area_id, code)');

  addTokenColumn('lockers', 'lockers_token');
  addTokenColumn('storages', 'storages_token');
}

// Geheimnis fuer die QR-Links. Bestehende Zeilen bekommen eines nachgetragen,
// damit ohne Anmeldung niemand fremde Spinte durchprobieren kann.
function addTokenColumn(table, indexName) {
  const { neuerToken } = require('./tokens');

  if (!hasColumn(table, 'token')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN token TEXT`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table}(token) WHERE token IS NOT NULL`);

  const offen = db.prepare(`SELECT id FROM ${table} WHERE token IS NULL`).all();
  if (!offen.length) return;

  const setzen = db.prepare(`UPDATE ${table} SET token = ? WHERE id = ?`);
  db.transaction(() => {
    for (const row of offen) {
      // Bei einer Kollision (praktisch unmoeglich) einfach neu wuerfeln.
      for (let versuch = 0; versuch < 10; versuch++) {
        try {
          setzen.run(neuerToken(), row.id);
          break;
        } catch (err) {
          if (!/UNIQUE/i.test(err.message)) throw err;
        }
      }
    }
  })();
  console.log(`${offen.length} ${table}: QR-Token nachgetragen — Etiketten müssen neu gedruckt werden.`);
}

// Frueher war lockers.code global eindeutig (inline UNIQUE -> Auto-Index nur auf
// code). Damit die Nummerierung je Bereich neu beginnen darf, muss dieser Index
// weg. Er laesst sich nicht einzeln droppen, also wird die Tabelle einmalig neu
// aufgebaut.
function dropGlobalCodeUniqueIfPresent() {
  const globalCodeIndex = db
    .prepare("PRAGMA index_list('lockers')")
    .all()
    .filter((idx) => idx.unique)
    .find((idx) => {
      const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all();
      return cols.length === 1 && cols[0].name === 'code';
    });
  if (!globalCodeIndex) return;

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE lockers_neu (
        id        INTEGER PRIMARY KEY,
        code      TEXT NOT NULL COLLATE NOCASE,
        label     TEXT,
        location  TEXT,
        area_id   INTEGER REFERENCES areas(id),
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        note      TEXT
      );
      INSERT INTO lockers_neu (id, code, label, location, area_id, member_id, note)
        SELECT id, code, label, location, area_id, member_id, note FROM lockers;
      DROP TABLE lockers;
      ALTER TABLE lockers_neu RENAME TO lockers;
      CREATE UNIQUE INDEX IF NOT EXISTS lockers_member_unique
        ON lockers(member_id) WHERE member_id IS NOT NULL;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

// Die fuenf Standardteile nur beim allerersten Start anlegen. Spaeter geloeschte
// oder umbenannte Arten kommen dadurch nicht wieder zurueck.
function seedEquipmentTypes() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM equipment_types').get();
  if (n > 0) return;

  const insert = db.prepare(
    'INSERT INTO equipment_types (name, has_size, has_inventory, sort_order) VALUES (?, ?, ?, ?)'
  );
  const defaults = [
    ['Jacke', 1, 1, 10],
    ['Hose', 1, 1, 20],
    ['Helm', 0, 1, 30],
    ['Handschuhe', 1, 0, 40],
    ['Schuhe', 1, 1, 50],
  ];
  db.transaction(() => defaults.forEach((d) => insert.run(...d)))();
}

module.exports = { db, init, DB_FILE, DATA_DIR };
