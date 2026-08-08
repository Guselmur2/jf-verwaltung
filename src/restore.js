'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { db } = require('./db');
const migrationen = require('./migrationen');

// Zurueckspielen einer Sicherung. Statt die Datenbankdatei auszutauschen — dafuer
// muesste die Software neu starten — wird der Inhalt in die laufende Datenbank
// uebernommen. Das hat einen zweiten Vorteil: kopiert werden nur Spalten, die es
// hier auch gibt, sodass eine aeltere Sicherung automatisch mitwaechst.
//
// sessions bleibt aussen vor: alte Anmeldungen zurueckzuholen ergibt keinen Sinn.
// schema_version ebenfalls: die Fassung der Sicherung wird eigens gelesen und
// steuert, welche Migrationen hinterher laufen (siehe einspielen).
const TABELLEN = [
  'users',
  'members',
  'areas',
  'gender_area',
  'size_schemes',
  'sizes',
  'equipment_types',
  'storages',
  'lockers',
  'equipment',
  'tasks',
  'api_tokens',
  'audit_log',
  'settings',
  'assets',
  'termine',
  'anwesenheit',
  'einschaetzung',
  'trennen',
  'funktion_eignung',
  'teams',
  'team_mitglieder',
];

const ITERATIONEN = 10000;

/** Entschluesselt eine Sicherung im Format von "openssl enc". */
async function entschluesseln(quelle, passwort) {
  const kopf = Buffer.alloc(16);
  const fd = fs.openSync(quelle, 'r');
  const gelesen = fs.readSync(fd, kopf, 0, 16, 0);
  fs.closeSync(fd);

  if (gelesen < 16 || kopf.subarray(0, 8).toString('binary') !== 'Salted__') {
    throw Object.assign(new Error('Das ist keine verschlüsselte Sicherung dieser Software.'), { code: 'FORMAT' });
  }

  const salz = kopf.subarray(8, 16);
  const abgeleitet = crypto.pbkdf2Sync(String(passwort), salz, ITERATIONEN, 48, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-cbc', abgeleitet.subarray(0, 32), abgeleitet.subarray(32, 48));

  const ziel = quelle + '.db';
  try {
    await pipeline(fs.createReadStream(quelle, { start: 16 }), decipher, fs.createWriteStream(ziel));
  } catch {
    // Bei falschem Passwort passt die Auffuellung am Ende nicht.
    throw Object.assign(new Error('Das Passwort passt nicht zu dieser Sicherung.'), { code: 'PASSWORT' });
  }
  return ziel;
}

/** Ist das eine brauchbare Sicherung? Prueft Dateikopf und erwartete Tabellen. */
function pruefen(datei) {
  const kopf = Buffer.alloc(16);
  const fd = fs.openSync(datei, 'r');
  fs.readSync(fd, kopf, 0, 16, 0);
  fs.closeSync(fd);
  if (!kopf.toString('binary').startsWith('SQLite format 3')) {
    throw Object.assign(new Error('Die entschlüsselte Datei ist keine Datenbank.'), { code: 'FORMAT' });
  }

  const Database = require('better-sqlite3');
  const quelle = new Database(datei, { readonly: true });
  try {
    const vorhanden = new Set(
      quelle.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    );
    for (const noetig of ['users', 'members', 'lockers', 'equipment']) {
      if (!vorhanden.has(noetig)) {
        throw Object.assign(new Error(`In der Sicherung fehlt die Tabelle "${noetig}".`), { code: 'FORMAT' });
      }
    }
    // Auf welcher Schema-Fassung steht die Sicherung? Sicherungen aus der Zeit
    // vor der Versionierung haben die Tabelle nicht — die stehen auf 1, denn
    // genau das war der Stand, als die Zaehlung begann.
    let fassung = 1;
    if (vorhanden.has('schema_version')) {
      fassung = quelle.prepare('SELECT MAX(version) AS v FROM schema_version').get().v || 1;
    }

    // Neuer als diese Software: nicht einspielen. Die unbekannten Spalten
    // wuerden beim Kopieren stillschweigend wegfallen, und niemand merkte es —
    // bis die Daten fehlen. Lieber gar nicht als halb.
    if (fassung > migrationen.NEUESTE) {
      throw Object.assign(
        new Error(
          `Diese Sicherung stammt aus einer neueren Fassung der Software ` +
            `(Schema ${fassung}, diese Installation kennt ${migrationen.NEUESTE}). ` +
            `Bitte erst die Software aktualisieren, dann erneut einspielen.`
        ),
        { code: 'VERSION', fassung, erwartet: migrationen.NEUESTE }
      );
    }

    return {
      tabellen: vorhanden,
      fassung,
      benutzer: quelle.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      mitglieder: quelle.prepare('SELECT COUNT(*) AS n FROM members').get().n,
      spinte: quelle.prepare('SELECT COUNT(*) AS n FROM lockers').get().n,
      ausruestung: quelle.prepare('SELECT COUNT(*) AS n FROM equipment').get().n,
    };
  } finally {
    quelle.close();
  }
}

function spalten(datenbank, tabelle) {
  return db
    .prepare(`PRAGMA ${datenbank}.table_info(${tabelle})`)
    .all()
    .map((s) => s.name);
}

/**
 * Uebernimmt den Inhalt der Sicherung in die laufende Datenbank.
 * Alles Bestehende wird dabei ersetzt.
 */
function einspielen(datei) {
  const bericht = pruefen(datei);

  db.pragma('foreign_keys = OFF');
  try {
    db.prepare('ATTACH DATABASE ? AS sicherung').run(datei);
    try {
      const quellTabellen = new Set(
        db.prepare("SELECT name FROM sicherung.sqlite_master WHERE type = 'table'").all().map((r) => r.name)
      );

      const uebernommen = {};
      db.transaction(() => {
        // Rueckwaerts leeren, damit Verweise nicht ins Leere zeigen.
        for (const t of [...TABELLEN].reverse()) db.prepare(`DELETE FROM main.${t}`).run();

        for (const t of TABELLEN) {
          if (!quellTabellen.has(t)) continue;
          const hier = spalten('main', t);
          const dort = spalten('sicherung', t);
          const gemeinsam = hier.filter((s) => dort.includes(s));
          if (!gemeinsam.length) continue;

          const liste = gemeinsam.join(', ');
          const info = db
            .prepare(`INSERT INTO main.${t} (${liste}) SELECT ${liste} FROM sicherung.${t}`)
            .run();
          uebernommen[t] = info.changes;
        }
      })();

      // Ab der Fassung der Sicherung EINSCHLIESSLICH neu anwenden, nicht erst
      // danach: die eben kopierten Zeilen stammen aus der Sicherung, und was
      // ihre Fassung zusichert, muss fuer sie auch wirklich gelten. Aeltere
      // Sicherungen kennen z.B. die QR-Token noch nicht — die werden dabei
      // nachgetragen. Moeglich ist das nur, weil jede Migration mehrfach
      // ausfuehrbar sein muss.
      const gehoben = migrationen.anwenden(db, bericht.fassung - 1);

      return { ...bericht, uebernommen, gehoben };
    } finally {
      db.exec('DETACH DATABASE sicherung');
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/** Kompletter Ablauf: entschluesseln, pruefen, einspielen, aufraeumen. */
async function ausSicherung(hochgeladen, passwort) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-restore-'));
  const verschluesselt = path.join(ordner, 'sicherung.enc');
  fs.writeFileSync(verschluesselt, hochgeladen);

  try {
    const entschluesselt = await entschluesseln(verschluesselt, passwort);
    return einspielen(entschluesselt);
  } finally {
    try {
      fs.rmSync(ordner, { recursive: true, force: true });
    } catch {
      /* raeumt spaeter das Betriebssystem auf */
    }
  }
}

module.exports = { ausSicherung, entschluesseln, einspielen, pruefen };
