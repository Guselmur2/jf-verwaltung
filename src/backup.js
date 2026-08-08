'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { db, DB_FILE } = require('./db');
const migrationen = require('./migrationen');

// Die Datenbank laeuft im WAL-Modus: ein Teil der Aenderungen steht in
// spinte.db-wal und noch nicht in spinte.db. Ein einfaches Kopieren der Datei
// liefert deshalb einen unvollstaendigen Stand. SQLite hat dafuer eine eigene
// Sicherungsfunktion, die einen in sich stimmigen Abzug erzeugt — auch waehrend
// gearbeitet wird.
//
// Die Sicherung enthaelt Namen und Geburtsdaten von Kindern und wird deshalb
// immer verschluesselt. Bewusst im Format von "openssl enc": so laesst sie sich
// mit einem Standardbefehl oeffnen, auch wenn diese Software einmal nicht mehr
// da ist. Eine Sicherung, die nur das eigene Programm lesen kann, ist im
// Ernstfall keine.
//
//   openssl enc -d -aes-256-cbc -pbkdf2 -in spinte-….db.enc -out spinte.db

const VERFAHREN = 'aes-256-cbc';
const ITERATIONEN = 10000; // Vorgabe von "openssl enc -pbkdf2"
const MIN_PASSWORT = 8;

/**
 * Dateiname mit Datum, Uhrzeit und Schema-Fassung, z.B.
 * spinte-2026-07-27-2241-s1.db
 *
 * Die Fassung steht auch IN der Datei — sie hier zu wiederholen kostet nichts
 * und beantwortet vor einem Stick voller Sicherungen die Frage, welche davon zu
 * welchem Softwarestand gehoert. Ohne Passwort, ohne Entschluesseln.
 */
function dateiname(jetzt = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const d = `${jetzt.getFullYear()}-${p(jetzt.getMonth() + 1)}-${p(jetzt.getDate())}`;
  const fassung = migrationen.stand(db) || 1;
  return `spinte-${d}-${p(jetzt.getHours())}${p(jetzt.getMinutes())}-s${fassung}.db`;
}

/** Prueft das Passwort und liefert eine Fehlermeldung oder null. */
function passwortPruefen(passwort) {
  const p = String(passwort ?? '');
  if (!p) return 'Bitte ein Passwort für die Sicherung angeben.';
  if (p.length < MIN_PASSWORT) return `Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen lang sein.`;
  return null;
}

/**
 * Erzeugt eine verschluesselte Sicherung in einer temporaeren Datei.
 * Der Aufrufer muss den Ordner nach dem Ausliefern wieder loeschen.
 */
async function erstellen(passwort) {
  const fehler = passwortPruefen(passwort);
  if (fehler) throw Object.assign(new Error(fehler), { code: 'PASSWORT' });

  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-sicherung-'));
  const roh = path.join(ordner, dateiname());
  const ziel = roh + '.enc';

  await db.backup(roh);

  // Format von openssl enc: "Salted__" + 8 Byte Salz + Chiffrat.
  const salz = crypto.randomBytes(8);
  const abgeleitet = crypto.pbkdf2Sync(String(passwort), salz, ITERATIONEN, 48, 'sha256');
  const cipher = crypto.createCipheriv(VERFAHREN, abgeleitet.subarray(0, 32), abgeleitet.subarray(32, 48));

  const aus = fs.createWriteStream(ziel);
  aus.write(Buffer.concat([Buffer.from('Salted__', 'binary'), salz]));
  await pipeline(fs.createReadStream(roh), cipher, aus);

  // Der unverschluesselte Abzug darf nicht liegen bleiben.
  fs.rmSync(roh, { force: true });

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
    verschluesselung: `${VERFAHREN}, PBKDF2 mit ${ITERATIONEN} Runden (Format von openssl enc)`,
    mitglieder: zahl('SELECT COUNT(*) AS n FROM members'),
    spinte: zahl('SELECT COUNT(*) AS n FROM lockers'),
    ausruestung: zahl('SELECT COUNT(*) AS n FROM equipment'),
    lagerorte: zahl('SELECT COUNT(*) AS n FROM storages'),
    aufgaben: zahl('SELECT COUNT(*) AS n FROM tasks'),
  };
}

module.exports = { erstellen, aufraeumen, info, dateiname, passwortPruefen, MIN_PASSWORT };
