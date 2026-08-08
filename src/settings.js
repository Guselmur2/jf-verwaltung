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
  // Wann der Uebungsabend stattfindet. Daraus ergibt sich das Zeitfenster, in
  // dem die Software vor einer Aktualisierung warnt — mitten im Dienst will
  // niemand einen Neustart.
  dienst_beginn: '17:45',
  dienst_ende: '19:30',
};

const FELDER = Object.keys(STANDARD);

const LAENGE = {
  organisation: 80,
  abteilung: 40,
  slogan: 80,
  dienst_beginn: 5,
  dienst_ende: 5,
};

// Felder, die eine Uhrzeit enthalten. Was nicht als HH:MM lesbar ist, wird
// verworfen — sonst stuende dort "halb sechs" und die Rechnung ginge schief.
const ZEITFELDER = ['dienst_beginn', 'dienst_ende'];

function alsUhrzeit(wert) {
  const t = String(wert ?? '').trim().replace('.', ':');
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const stunde = Number(m[1]);
  const minute = Number(m[2]);
  if (stunde > 23 || minute > 59) return null;
  return `${String(stunde).padStart(2, '0')}:${m[2]}`;
}

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

      let wert = String(eingaben[feld] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, LAENGE[feld]);

      // Eine unlesbare Uhrzeit wird verworfen, statt sie zu speichern — sonst
      // faellt das erst auf, wenn die Warnung vor dem Update ausbleibt.
      if (ZEITFELDER.includes(feld) && wert) {
        const zeit = alsUhrzeit(wert);
        if (!zeit) continue;
        wert = zeit;
      }

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

// Einfache Ja/Nein-Schalter, getrennt von den Textfeldern. Fehlt der Eintrag,
// gilt die Voreinstellung.
const SCHALTER = {
  // Erfassungsmodus: solange er an ist, steht das Einbuchen im Lager ganz oben.
  // Ist das Material erfasst, schaltet man ihn aus und die Bestandsliste hat
  // Vorrang. Neu aufgesetzt beginnt man beim Erfassen, darum Vorgabe an.
  erfassen: true,
};

function schalter(name) {
  const zeile = db.prepare('SELECT wert FROM settings WHERE schluessel = ?').get(name);
  if (!zeile || zeile.wert == null) return SCHALTER[name] ?? false;
  return zeile.wert === '1';
}

function setzeSchalter(name, an) {
  q.setzen.run(name, an ? '1' : '0');
  return !!an;
}

module.exports = {
  alle,
  speichern,
  logo,
  logoSpeichern,
  logoLoeschen,
  bildtyp,
  schalter,
  setzeSchalter,
  STANDARD,
  FELDER,
  LOGO_MAX,
};
