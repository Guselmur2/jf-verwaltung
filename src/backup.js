'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { db, DB_FILE } = require('./db');

// Die Datenbank laeuft im WAL-Modus: ein Teil der Aenderungen steht in
// spinte.db-wal und noch nicht in spinte.db. Ein einfaches Kopieren der Datei
// liefert deshalb einen unvollstaendigen Stand. SQLite hat dafuer eine eigene
// Sicherungsfunktion, die einen in sich stimmigen Abzug erzeugt — auch waehrend
// gearbeitet wird.

/** Dateiname mit Datum und Uhrzeit, z.B. spinte-2026-07-27-2241.db */
function dateiname(jetzt = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const d = `${jetzt.getFullYear()}-${p(jetzt.getMonth() + 1)}-${p(jetzt.getDate())}`;
  return `spinte-${d}-${p(jetzt.getHours())}${p(jetzt.getMinutes())}.db`;
}

/**
 * Erzeugt eine Sicherung in einer temporaeren Datei und liefert deren Pfad.
 * Der Aufrufer muss sie nach dem Ausliefern wieder loeschen.
 */
async function erstellen() {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-sicherung-'));
  const ziel = path.join(ordner, dateiname());
  await db.backup(ziel);
  return { pfad: ziel, ordner, name: path.basename(ziel), groesse: fs.statSync(ziel).size };
}

/** Temporaeren Ordner samt Sicherung wieder entfernen. */
function aufraeumen(ordner) {
  try {
    fs.rmSync(ordner, { recursive: true, force: true });
  } catch {
    /* beim naechsten Neustart raeumt das Betriebssystem auf */
  }
}

/** Angaben fuer die Anzeige: wie gross ist der Bestand gerade? */
function info() {
  const zahl = (sql) => db.prepare(sql).get().n;
  let groesse = 0;
  for (const endung of ['', '-wal']) {
    try {
      groesse += fs.statSync(DB_FILE + endung).size;
    } catch {
      /* -wal gibt es nicht immer */
    }
  }
  return {
    datei: DB_FILE,
    groesse,
    mitglieder: zahl('SELECT COUNT(*) AS n FROM members'),
    spinte: zahl('SELECT COUNT(*) AS n FROM lockers'),
    ausruestung: zahl('SELECT COUNT(*) AS n FROM equipment'),
    lagerorte: zahl('SELECT COUNT(*) AS n FROM storages'),
    aufgaben: zahl('SELECT COUNT(*) AS n FROM tasks'),
  };
}

module.exports = { erstellen, aufraeumen, info, dateiname };
