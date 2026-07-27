'use strict';

const crypto = require('crypto');
const { db } = require('./db');

// Stammdaten der Wehr. Alles, was auf Etiketten und im Kopf der Seite steht,
// gehoert hierher — jede Wehr traegt ihren eigenen Namen ein, statt dass er im
// Quelltext steht.
const STANDARD = {
  organisation: 'Jugendfeuerwehr',
  abteilung: 'Jugendfeuerwehr',
  slogan: 'Wir sind die Helden von morgen!',
};

const FELDER = Object.keys(STANDARD);

const LAENGE = {
  organisation: 80,
  abteilung: 40,
  slogan: 80,
};

const q = {
  alle: db.prepare('SELECT schluessel, wert FROM settings'),
  setzen: db.prepare(
    'INSERT INTO settings (schluessel, wert) VALUES (?, ?) ' +
      'ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert'
  ),
  loeschen: db.prepare('DELETE FROM settings WHERE schluessel = ?'),
  logo: db.prepare('SELECT mime, daten, geaendert FROM assets WHERE name = ?'),
  logoKopf: db.prepare('SELECT mime, geaendert, length(daten) AS groesse FROM assets WHERE name = ?'),
  logoSetzen: db.prepare(
    "INSERT INTO assets (name, mime, daten, geaendert) VALUES (?, ?, ?, datetime('now')) " +
      'ON CONFLICT(name) DO UPDATE SET mime = excluded.mime, daten = excluded.daten, geaendert = excluded.geaendert'
  ),
  logoLoeschen: db.prepare('DELETE FROM assets WHERE name = ?'),
};

/** Alle Stammdaten inklusive Voreinstellungen. */
function alle() {
  const werte = { ...STANDARD };
  for (const zeile of q.alle.all()) {
    if (FELDER.includes(zeile.schluessel) && zeile.wert) werte[zeile.schluessel] = zeile.wert;
  }
  const kopf = q.logoKopf.get('logo');
  werte.hatLogo = !!kopf;
  // Der Zeitstempel haengt an der Bild-Adresse, damit nach dem Austausch des
  // Logos nicht die alte Fassung aus dem Browser-Cache kommt.
  werte.logoStand = kopf ? crypto.createHash('sha1').update(String(kopf.geaendert)).digest('hex').slice(0, 8) : '';
  return werte;
}

/**
 * Speichert die Textfelder. Ein leeres Feld faellt auf die Voreinstellung
 * zurueck, damit auf einem Etikett nie eine Luecke klafft.
 */
function speichern(eingaben) {
  const geaendert = {};
  const vorher = alle();

  db.transaction(() => {
    for (const feld of FELDER) {
      if (!(feld in eingaben)) continue;
      const wert = String(eingaben[feld] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, LAENGE[feld]);
      if (wert) q.setzen.run(feld, wert);
      else q.loeschen.run(feld);
      const neu = wert || STANDARD[feld];
      if (neu !== vorher[feld]) geaendert[feld] = neu;
    }
  })();

  return geaendert;
}

// Erlaubte Logo-Formate. Erkannt wird am Dateiinhalt, nicht am mitgeschickten
// Typ — was der Browser behauptet, muss nicht stimmen.
const BILDTYPEN = [
  { mime: 'image/png', pruefe: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', pruefe: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', pruefe: (b) => b.subarray(0, 6).toString('binary').match(/^GIF8[79]a$/) },
  {
    mime: 'image/webp',
    pruefe: (b) => b.subarray(0, 4).toString('binary') === 'RIFF' && b.subarray(8, 12).toString('binary') === 'WEBP',
  },
  {
    mime: 'image/svg+xml',
    // SVG ist Text; der Anfang darf eine XML-Deklaration oder ein Kommentar sein.
    pruefe: (b) => /^\s*(<\?xml[\s\S]{0,400}?\?>\s*)?(<!--[\s\S]{0,400}?-->\s*)*(<!DOCTYPE\s+svg[\s\S]{0,400}?>\s*)?<svg[\s>]/i.test(b.subarray(0, 1024).toString('utf8')),
  },
];

const LOGO_MAX = 2 * 1024 * 1024;

/** Erkennt den Bildtyp am Inhalt. Gibt null zurueck, wenn es kein Bild ist. */
function bildtyp(daten) {
  if (!Buffer.isBuffer(daten) || daten.length < 12) return null;
  const treffer = BILDTYPEN.find((t) => t.pruefe(daten));
  return treffer ? treffer.mime : null;
}

function logoSpeichern(daten) {
  if (!Buffer.isBuffer(daten) || !daten.length) {
    throw Object.assign(new Error('Es wurde keine Datei ausgewählt.'), { code: 'LEER' });
  }
  if (daten.length > LOGO_MAX) {
    throw Object.assign(new Error('Das Bild ist größer als 2 MB. Bitte kleiner speichern.'), { code: 'GROSS' });
  }
  const mime = bildtyp(daten);
  if (!mime) {
    throw Object.assign(new Error('Das ist keine Bilddatei. Erlaubt sind PNG, JPEG, GIF, WebP und SVG.'), {
      code: 'FORMAT',
    });
  }
  q.logoSetzen.run('logo', mime, daten);
  return { mime, groesse: daten.length };
}

function logo() {
  return q.logo.get('logo') || null;
}

function logoLoeschen() {
  return q.logoLoeschen.run('logo').changes > 0;
}

module.exports = { alle, speichern, logo, logoSpeichern, logoLoeschen, bildtyp, STANDARD, FELDER, LOGO_MAX };
