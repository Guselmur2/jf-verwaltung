'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const migrationen = require('./migrationen');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'spinte.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('foreign_keys = ON');

// Steht die Datenbank auf einer Fassung, die diese Software noch nicht kennt?
// Wird beim Start gesetzt und in der Oberflaeche als Warnung angezeigt — die
// Software laeuft trotzdem weiter, siehe migrationen.js.
let zuNeu = false;

function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();
  // Erst die Arten, dann die Schemata — die Zuordnung braucht die Arten.
  seedEquipmentTypes();
  seedSizeSchemes();
}

/**
 * Bringt die Datenbank auf den Stand, den diese Software erwartet.
 *
 * Wird auch nach dem Einspielen einer Sicherung gebraucht: dort steht
 * womoeglich ein aelterer Bestand, dem Spalten fehlen. Welche Schritte es gibt
 * und welche Regeln fuer neue gelten, steht in migrationen.js.
 */
function migrate(ab = null) {
  const ergebnis = migrationen.anwenden(db, ab);
  zuNeu = ergebnis.zuNeu;
  return ergebnis;
}

/** Auf welcher Schema-Fassung steht die laufende Datenbank? */
function schemaStand() {
  return { fassung: migrationen.stand(db), erwartet: migrationen.NEUESTE, zuNeu };
}

// Groessenschemata einmalig anlegen. Spaeter geaenderte oder geloeschte Groessen
// kommen dadurch nicht zurueck.
function seedSizeSchemes() {
  const { SCHEMES, TYP_SCHEMA } = require('./size-catalog');
  const vorhanden = db.prepare('SELECT COUNT(*) AS n FROM size_schemes').get().n;

  if (vorhanden === 0) {
    const schema = db.prepare('INSERT INTO size_schemes (name, label, note) VALUES (?, ?, ?)');
    const groesse = db.prepare('INSERT INTO sizes (scheme, gruppe, wert, sort_order) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      for (const s of SCHEMES) {
        schema.run(s.name, s.label, s.note);
        let sort = 10;
        for (const g of s.gruppen) {
          for (const wert of g.werte) groesse.run(s.name, g.gruppe, wert, (sort += 10));
        }
      }
    })();
  }

  // Bestehende Standardarten bekommen ihr Schema, sofern noch keines gesetzt ist.
  const setzen = db.prepare('UPDATE equipment_types SET size_scheme = ? WHERE name = ? AND size_scheme IS NULL');
  db.transaction(() => {
    for (const [typ, schemaName] of Object.entries(TYP_SCHEMA)) setzen.run(schemaName, typ);
  })();
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

module.exports = { db, init, migrate, schemaStand, DB_FILE, DATA_DIR };
