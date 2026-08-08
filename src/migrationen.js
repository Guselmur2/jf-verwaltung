'use strict';

// Fassung des Datenbankschemas — und der Weg von einer Fassung zur nächsten.
//
// Warum das hier steht, obwohl sich am Schema noch nichts geändert hat:
//
// Beim Zurückspielen einer Sicherung übernimmt restore.js nur Spalten, die es
// in BEIDEN Datenbanken gibt. Eine ALTE Sicherung wächst dadurch von selbst in
// ein neueres Schema hinein — die Richtung ist abgedeckt.
//
// Die andere Richtung ist es nicht: eine NEUE Sicherung in eine ältere
// Installation. Dann verschwinden die unbekannten Spalten stillschweigend, und
// niemand merkt es — bis die Daten fehlen. Genau dafür braucht es eine Nummer,
// die sagt: "diese Sicherung ist neuer als du, lass die Finger davon."
//
// Dieselbe Nummer beantwortet die zweite Frage: nach einem misslungenen Update
// setzt der Helfer den CODE zurück, die DATENBANK aber nicht. Wurde dabei schon
// migriert, läuft alte Software auf einem neueren Bestand. Solange alle
// Migrationen nur hinzufügen, ist das harmlos — die alte Software ignoriert die
// neuen Spalten. Sobald eine Migration etwas umbaut, ist es das nicht mehr, und
// dann muss man es wenigstens merken.
//
// ---------------------------------------------------------------------------
// Regeln für neue Migrationen — bitte einhalten, sie tragen den ganzen Bau:
//
//   1. JEDE Migration muss mehrfach ausführbar sein, ohne Schaden anzurichten
//      ("IF NOT EXISTS", "hatSpalte(...)"-Abfrage davor). Das ersetzt die
//      Atomarität: bricht eine Migration in der Mitte ab, hilft ein zweiter
//      Lauf, statt einen halben Stand zu hinterlassen.
//   2. Was eine Migration anlegt, gehört GLEICHZEITIG in schema.sql. Frisch
//      angelegte Datenbanken entstehen aus schema.sql, nicht aus der
//      Migrationskette. Der Test test/schema.mjs prüft beides gegeneinander.
//   3. Neue Nummer nur anhängen, nie eine bestehende ändern. Draußen laufen
//      Datenbanken, die die alte Nummer schon gespeichert haben.
//   4. Bauen statt umbauen. Eine zusätzliche Spalte ist rückwärtsverträglich,
//      ein Umbenennen nicht. Wo es sich nicht vermeiden lässt: vertraeglich
//      auf false setzen und in docs/datenbank.md aufschreiben, warum.
// ---------------------------------------------------------------------------

/** Gibt es die Spalte schon? Tabellennamen sind intern und fest. */
function hatSpalte(db, tabelle, spalte) {
  return db
    .prepare(`PRAGMA table_info(${tabelle})`)
    .all()
    .some((s) => s.name === spalte);
}

/**
 * Fassung 1 ist alles, was vor der Versionierung gewachsen ist: die Schritte,
 * die eine Datenbank aus der Frühzeit auf den heutigen Stand bringen. Sie sind
 * ausnahmslos ergänzend und alle mehrfach ausführbar — auf einer frisch aus
 * schema.sql angelegten Datenbank passiert hier nichts.
 */
function ausgangsstand(db) {
  if (!hatSpalte(db, 'members', 'gender')) {
    db.exec('ALTER TABLE members ADD COLUMN gender TEXT');
  }
  if (!hatSpalte(db, 'lockers', 'area_id')) {
    db.exec('ALTER TABLE lockers ADD COLUMN area_id INTEGER REFERENCES areas(id)');
  }
  if (!hatSpalte(db, 'equipment', 'storage_id')) {
    db.exec('ALTER TABLE equipment ADD COLUMN storage_id INTEGER REFERENCES storages(id)');
    db.exec('CREATE INDEX IF NOT EXISTS equipment_storage_idx ON equipment(storage_id)');
  }
  globalenCodeIndexEntfernen(db);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS lockers_area_code ON lockers(area_id, code)');

  if (!hatSpalte(db, 'equipment_types', 'size_scheme')) {
    db.exec('ALTER TABLE equipment_types ADD COLUMN size_scheme TEXT');
  }
  if (!hatSpalte(db, 'equipment_types', 'barcode_prefix')) {
    db.exec('ALTER TABLE equipment_types ADD COLUMN barcode_prefix TEXT');
    db.exec('ALTER TABLE equipment_types ADD COLUMN barcode_digits INTEGER');
  }
  if (!hatSpalte(db, 'storages', 'is_default')) {
    db.exec('ALTER TABLE storages ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
  }
  tokenSpalte(db, 'lockers', 'lockers_token');
  tokenSpalte(db, 'storages', 'storages_token');
  inventarIndex(db);
}

/**
 * Eine Inventarnummer gehoert zu genau einem Teil. Teile ohne Nummer
 * (Sammelposten) bleiben ausgenommen, davon gibt es beliebig viele.
 *
 * Steht in einer aelteren Datenbank dieselbe Nummer mehrfach, laesst sich der
 * Index nicht anlegen. Dann startet die Software trotzdem, meldet die Faelle
 * und verlaesst sich auf die Pruefung im Programm — sonst kaeme man an die
 * Daten gar nicht mehr heran, um sie zu berichtigen.
 */
function inventarIndex(db) {
  const doppelte = db
    .prepare(
      `SELECT TRIM(inventory_no) AS nr, COUNT(*) AS anzahl
         FROM equipment
        WHERE inventory_no IS NOT NULL AND TRIM(inventory_no) <> ''
        GROUP BY LOWER(TRIM(inventory_no))
       HAVING COUNT(*) > 1
        ORDER BY anzahl DESC, nr`
    )
    .all();

  if (doppelte.length) {
    console.warn('WARNUNG: Diese Inventarnummern sind mehrfach vergeben:');
    for (const d of doppelte) console.warn(`  ${d.nr} — ${d.anzahl} Teile`);
    console.warn('Bitte über die Suche berichtigen. Nach einem Neustart wird die');
    console.warn('Eindeutigkeit dann auch von der Datenbank erzwungen.');
    return;
  }

  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS equipment_inv_unique
       ON equipment(inventory_no COLLATE NOCASE)
     WHERE inventory_no IS NOT NULL AND inventory_no <> ''`
  );
}

// Geheimnis fuer die QR-Links. Bestehende Zeilen bekommen eines nachgetragen,
// damit ohne Anmeldung niemand fremde Spinte durchprobieren kann.
function tokenSpalte(db, tabelle, indexName) {
  const { neuerToken } = require('./tokens');

  if (!hatSpalte(db, tabelle, 'token')) {
    db.exec(`ALTER TABLE ${tabelle} ADD COLUMN token TEXT`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tabelle}(token) WHERE token IS NOT NULL`);

  const offen = db.prepare(`SELECT id FROM ${tabelle} WHERE token IS NULL`).all();
  if (!offen.length) return;

  const setzen = db.prepare(`UPDATE ${tabelle} SET token = ? WHERE id = ?`);
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
  console.log(`${offen.length} ${tabelle}: QR-Token nachgetragen — Etiketten müssen neu gedruckt werden.`);
}

// Frueher war lockers.code global eindeutig (inline UNIQUE -> Auto-Index nur auf
// code). Damit die Nummerierung je Bereich neu beginnen darf, muss dieser Index
// weg. Er laesst sich nicht einzeln droppen, also wird die Tabelle einmalig neu
// aufgebaut.
function globalenCodeIndexEntfernen(db) {
  const globalerIndex = db
    .prepare("PRAGMA index_list('lockers')")
    .all()
    .filter((idx) => idx.unique)
    .find((idx) => {
      const spalten = db.prepare(`PRAGMA index_info(${JSON.stringify(idx.name)})`).all();
      return spalten.length === 1 && spalten[0].name === 'code';
    });
  if (!globalerIndex) return;

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

// ---------------------------------------------------------------------------

const MIGRATIONEN = [
  {
    version: 1,
    name: 'Ausgangsstand',
    // Rückwärtsverträglich: ältere Software kommt mit dieser Datenbank zurecht,
    // weil nur Spalten und Indizes dazugekommen sind.
    vertraeglich: true,
    hoch: ausgangsstand,
  },
];

const NEUESTE = MIGRATIONEN.reduce((h, m) => Math.max(h, m.version), 0);

/** Auf welcher Fassung steht diese Datenbank? 0 = noch gar keine. */
function stand(db) {
  try {
    return db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v || 0;
  } catch {
    return 0; // Tabelle gibt es nicht — Datenbank aus der Zeit vor der Versionierung
  }
}

/** Welche Schritte wurden wann angewendet? */
function verlauf(db) {
  try {
    return db.prepare('SELECT version, name, angewendet FROM schema_version ORDER BY version').all();
  } catch {
    return [];
  }
}

function tabelleAnlegen(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      angewendet TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Wendet alles an, was dieser Datenbank noch fehlt, und liefert die Liste der
 * ausgeführten Schritte. Mehrfach aufrufbar — beim zweiten Mal passiert nichts.
 *
 * @param {object} db     offene Datenbank
 * @param {number} [ab]   ab welcher Fassung gerechnet wird (Vorgabe: was drinsteht)
 */
function anwenden(db, ab = null) {
  tabelleAnlegen(db);
  const vorher = ab === null ? stand(db) : ab;

  if (vorher > NEUESTE) {
    // Kein Abbruch: an einem Übungsabend hilft es niemandem, wenn die Software
    // gar nicht mehr startet. Aber gesagt werden muss es.
    console.error(
      `WARNUNG: Die Datenbank steht auf Schema-Fassung ${vorher}, diese Software kennt nur ${NEUESTE}.`
    );
    console.error('Sie wurde von einer neueren Fassung geschrieben. Bitte die Software aktualisieren —');
    console.error('bis dahin können Daten fehlen oder falsch angezeigt werden.');
    return { vorher, nachher: vorher, schritte: [], zuNeu: true };
  }

  const offen = MIGRATIONEN.filter((m) => m.version > vorher).sort((a, b) => a.version - b.version);
  const eintragen = db.prepare('INSERT OR IGNORE INTO schema_version (version, name) VALUES (?, ?)');

  const schritte = [];
  for (const m of offen) {
    m.hoch(db);
    eintragen.run(m.version, m.name);
    schritte.push({ version: m.version, name: m.name });
    if (vorher > 0) console.log(`Datenbank auf Fassung ${m.version} gehoben: ${m.name}`);
  }

  return { vorher, nachher: stand(db), schritte, zuNeu: false };
}

module.exports = { MIGRATIONEN, NEUESTE, stand, verlauf, anwenden, hatSpalte };
