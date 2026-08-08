'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const auth = require('../auth');
const audit = require('../audit');
const backup = require('../backup');
const restore = require('../restore');
const { DATA_DIR } = require('../db');

const router = express.Router();

// Eine Sicherung in die LAUFENDE Installation einspielen.
//
// Bisher ging das nur bei einer leeren Datenbank ("Mit Sicherung fortsetzen"
// auf der Einrichtungsseite). Damit stand man bei kaputten Daten — 40 Teile
// falsch eingebucht, ein Mitglied versehentlich geloescht — ohne Weg da.
//
// Bewusst nicht als Rettung fuer eine misslungene Aktualisierung gedacht: geht
// die schief, ist die Anwendung selbst hin und koennte diese Seite gar nicht
// mehr ausliefern. Dafuer setzt der Update-Helfer von sich aus zurueck.

// Wo Sicherungen liegen koennen: der USB-Stick und das Ersatzziel auf der
// Speicherkarte, falls der Stick einmal fehlte.
const ORTE = [
  { pfad: process.env.SICHERUNG_ZIEL || '/mnt/jf-sicherung', name: 'USB-Stick' },
  { pfad: path.join(DATA_DIR, 'sicherungen'), name: 'Speicherkarte' },
];

/** Alle gefundenen Sicherungen, neueste zuerst. */
function vorhandene() {
  const alle = [];
  for (const ort of ORTE) {
    let dateien;
    try {
      dateien = fs.readdirSync(ort.pfad);
    } catch {
      continue; // Stick nicht eingehaengt, Ordner gibt es nicht
    }
    for (const datei of dateien) {
      if (!/^spinte-.*\.db\.enc$/.test(datei)) continue;
      try {
        const s = fs.statSync(path.join(ort.pfad, datei));
        alle.push({ datei, ort: ort.name, pfad: path.join(ort.pfad, datei), groesse: s.size, zeit: s.mtime });
      } catch {
        /* verschwunden zwischen readdir und stat */
      }
    }
  }
  return alle.sort((a, b) => b.zeit - a.zeit);
}

/** Prueft, dass der Pfad wirklich aus einem der bekannten Orte stammt. */
function erlaubt(pfad) {
  return vorhandene().some((s) => s.pfad === pfad);
}

router.get('/restore', auth.requireJugendwart, (req, res) => {
  res.render('restore', {
    title: 'Sicherung einspielen',
    sicherungen: vorhandene(),
    bestand: backup.info(),
  });
});

router.post('/restore', auth.requireJugendwart, async (req, res, next) => {
  const passwort = req.body.passwort || '';
  const zurueck = (text, typ = 'warn') => {
    req.session.flash = { type: typ, text };
    res.redirect('/restore');
  };

  if (req.body.verstanden !== 'ja') {
    return zurueck('Bitte bestätigen, dass der aktuelle Bestand ersetzt wird.');
  }

  // Woher kommt die Sicherung — vom Datenträger oder frisch hochgeladen?
  let inhalt;
  let herkunft;
  if (req.file && req.file.buffer && req.file.buffer.length) {
    inhalt = req.file.buffer;
    herkunft = req.file.originalname || 'hochgeladen';
  } else if (req.body.pfad) {
    if (!erlaubt(req.body.pfad)) return zurueck('Diese Sicherung ist nicht (mehr) auffindbar.');
    try {
      inhalt = fs.readFileSync(req.body.pfad);
    } catch (err) {
      return zurueck(`Die Datei ließ sich nicht lesen: ${err.message}`);
    }
    herkunft = path.basename(req.body.pfad);
  } else {
    return zurueck('Bitte eine Sicherung auswählen oder eine Datei hochladen.');
  }

  const fehler = backup.passwortPruefen(passwort);
  if (fehler) return zurueck(fehler);

  // Vor dem Ersetzen den jetzigen Stand wegschreiben. Wer sich in der Datei
  // vergreift, soll nicht ohne Rueckweg dastehen.
  let sicherheitskopie = null;
  try {
    const s = await backup.erstellen(passwort);
    const ziel = path.join(DATA_DIR, 'sicherungen');
    fs.mkdirSync(ziel, { recursive: true });
    sicherheitskopie = path.join(ziel, s.name.replace('.db.enc', '-vor-restore.db.enc'));
    fs.copyFileSync(s.pfad, sicherheitskopie);
    backup.aufraeumen(s.ordner);
  } catch (err) {
    return zurueck(`Die Sicherheitskopie ließ sich nicht anlegen — abgebrochen. (${err.message})`);
  }

  try {
    const bericht = await restore.ausSicherung(inhalt, passwort);
    audit.log(
      req,
      'system',
      null,
      'Sicherung eingespielt',
      `${herkunft}: ${bericht.mitglieder} Mitglieder, ${bericht.spinte} Spinte, ${bericht.ausruestung} Teile`
    );
    req.session.flash = {
      type: 'ok',
      text:
        `Eingespielt: ${bericht.mitglieder} Mitglieder, ${bericht.spinte} Spinte, ` +
        `${bericht.ausruestung} Teile. Der vorherige Stand liegt als ` +
        `${path.basename(sicherheitskopie)} daneben.`,
    };
    // Die eigene Anmeldung stammt aus der ersetzten Datenbank — neu anmelden.
    return req.session.destroy(() => res.redirect('/anmelden'));
  } catch (err) {
    if (err.code === 'PASSWORT') return zurueck('Das Passwort passt nicht zu dieser Sicherung.');
    if (err.code === 'FORMAT') return zurueck('Das ist keine Sicherung dieser Software.');
    return next(err);
  }
});

module.exports = router;
