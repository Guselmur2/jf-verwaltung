'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const express = require('express');
const auth = require('../auth');
const audit = require('../audit');
const update = require('../update');
const d = require('../dienst');
const { DATA_DIR } = require('../db');

const router = express.Router();

// Der Befehl zum Herunterfahren. Absichtlich ueber die Umgebung austauschbar —
// so laesst sich der Ablauf im Test pruefen, ohne den Rechner abzuschalten.
//
// "systemctl poweroff" spricht ueber D-Bus mit systemd-logind und braucht daher
// kein sudo. Das ist wichtig: der Dienst laeuft mit NoNewPrivileges=true, damit
// aus einer Luecke in der Weboberflaeche keine Root-Rechte werden koennen. Ein
// setuid-Programm wie sudo waere dort gar nicht startbar. Die Erlaubnis kommt
// stattdessen aus einer polkit-Regel, die genau diese eine Aktion fuer diesen
// einen Benutzer freigibt (siehe README).
//
// --no-block: systemd stellt den Auftrag in die Warteschlange und antwortet
// sofort. So bekommen wir noch einen Rueckgabewert — und der Browser noch die
// Abschiedsseite —, bevor der Rechner tatsaechlich ausgeht.
const STANDARD_BEFEHL = 'systemctl poweroff --no-block';

function abschaltBefehl() {
  const roh = (process.env.ABSCHALT_BEFEHL || STANDARD_BEFEHL).trim();
  // JSON-Schreibweise fuer Befehle mit Leerzeichen im Pfad.
  if (roh.startsWith('[')) {
    const teile = JSON.parse(roh);
    return { datei: teile[0], argumente: teile.slice(1) };
  }
  const teile = roh.split(/\s+/);
  return { datei: teile[0], argumente: teile.slice(1) };
}

function betriebszeit(sekunden) {
  const tage = Math.floor(sekunden / 86400);
  const stunden = Math.floor((sekunden % 86400) / 3600);
  const minuten = Math.floor((sekunden % 3600) / 60);
  if (tage) return `${tage} Tage, ${stunden} Std.`;
  if (stunden) return `${stunden} Std., ${minuten} Min.`;
  return `${minuten} Min.`;
}

/** Freier Platz auf der Partition der Datenbank. */
function speicherplatz() {
  try {
    const s = fs.statfsSync(DATA_DIR);
    return { frei: s.bavail * s.bsize, gesamt: s.blocks * s.bsize };
  } catch {
    return null; // statfs gibt es nicht ueberall — dann bleibt die Zeile leer
  }
}

/**
 * Stand der naechtlichen Sicherung. Die Datei schreibt
 * scripts/sicherung-automatisch.sh nach jedem Lauf — fehlt sie, ist der Timer
 * nicht eingerichtet.
 */
function sicherungsstand() {
  try {
    const stand = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sicherung-status.json'), 'utf8'));
    const zeit = new Date(stand.zeitpunkt);
    return {
      ...stand,
      zeit,
      alterTage: Number.isNaN(zeit.getTime()) ? null : Math.floor((Date.now() - zeit.getTime()) / 86400000),
    };
  } catch {
    return null; // noch nie gelaufen oder nicht eingerichtet
  }
}

/** Wurde heute schon Anwesenheit erfasst? Dann laeuft gerade ein Uebungsabend. */
function dienstHeute() {
  const termin = d.terminByDatum(d.heute());
  if (!termin) return null;
  const liste = d.anwesenheit(termin.id).filter((m) => m.status);
  return liste.length ? { termin, erfasst: liste.length } : null;
}

function zustand() {
  return {
    rechner: os.hostname(),
    system: `${os.type()} ${os.release()}`,
    betriebszeit: betriebszeit(os.uptime()),
    speicher: speicherplatz(),
    arbeitsspeicher: { frei: os.freemem(), gesamt: os.totalmem() },
    befehl: (process.env.ABSCHALT_BEFEHL || STANDARD_BEFEHL).replace(/^\[|\]$/g, ''),
  };
}

router.get('/system', auth.requireJugendwart, (req, res) => {
  res.render('system', {
    title: 'System',
    zustand: zustand(),
    sicherung: sicherungsstand(),
    aktualisierung: { istGit: update.istGit(), status: update.status(), laeuft: update.inArbeit() },
  });
});

// ------------------------------------------------------------ Aktualisierung

/**
 * Zeigt, was ein Update braechte. Das "git fetch" dahinter aendert nichts an
 * den Dateien — es holt nur, was auf dem Server liegt.
 */
router.get('/system/update', auth.requireJugendwart, async (req, res, next) => {
  try {
    const laeuft = update.inArbeit();
    res.render('update', {
      title: 'Aktualisierung',
      // Waehrend etwas laeuft, wird nicht nebenher noch nachgesehen.
      pruefung: laeuft ? null : await update.pruefen(),
      status: update.status(),
      abgleich: update.abgleichStand(),
      laeuft,
      art: update.artInArbeit(),
      fenster: d.dienstfenster(),
      // Ist heute schon Anwesenheit erfasst, laeuft der Uebungsabend gerade
      // oder war eben — dann besser nicht neu starten.
      heuteDienst: dienstHeute(),
    });
  } catch (err) {
    next(err);
  }
});

/** Nur der Stand, fuer die Anzeige waehrend des Neustarts. */
router.get('/system/update/status.json', auth.requireJugendwart, (req, res) => {
  res.json({
    laeuft: update.inArbeit(),
    art: update.artInArbeit(),
    status: update.status(),
    abgleich: update.abgleichStand(),
  });
});

/**
 * Beim Repository nachfragen. Der Dienst kann das nicht selbst — er darf nicht
 * in .git schreiben (siehe src/update.js). Also fragt er den Helfer.
 */
router.post('/system/update/abgleichen', auth.requireJugendwart, (req, res) => {
  if (update.inArbeit()) {
    req.session.flash = { type: 'info', text: 'Es läuft bereits ein Update oder eine Suche.' };
    return res.redirect('/system/update');
  }
  if (!update.istGit()) {
    req.session.flash = { type: 'warn', text: 'Diese Installation ist kein Git-Arbeitsverzeichnis.' };
    return res.redirect('/system/update');
  }
  update.abgleichAnfordern(req.session.user.name);
  res.redirect('/system/update');
});

router.post('/system/update/starten', auth.requireJugendwart, (req, res) => {
  if (update.inArbeit()) {
    req.session.flash = { type: 'info', text: 'Es läuft bereits eine Aktualisierung.' };
    return res.redirect('/system/update');
  }
  if (!update.istGit()) {
    req.session.flash = {
      type: 'warn',
      text: 'Diese Installation ist kein Git-Arbeitsverzeichnis — siehe README, „Vom Pi aus".',
    };
    return res.redirect('/system/update');
  }

  update.anfordern(req.session.user.name);
  audit.log(req, 'system', null, 'Aktualisierung angefordert', null);
  res.redirect('/system/update');
});

router.post('/system/herunterfahren', auth.requireJugendwart, (req, res) => {
  const { datei, argumente } = abschaltBefehl();

  // Erst protokollieren, dann abschalten — nach dem Abschalten schreibt niemand
  // mehr etwas in die Datenbank.
  audit.log(req, 'system', null, 'heruntergefahren', `${datei} ${argumente.join(' ')}`.trim());

  execFile(datei, argumente, { timeout: 10000 }, (fehler, ausgabe, fehlerausgabe) => {
    if (!fehler) {
      return res.render('abschalten', { title: 'Der Pi fährt herunter' });
    }

    // Der haeufigste Fall: die polkit-Regel fehlt, dann meldet systemctl
    // "Interactive authentication required".
    const meldung = String(fehlerausgabe || fehler.message).trim().split('\n')[0];
    req.session.flash = {
      type: 'warn',
      text: `Das Herunterfahren hat nicht geklappt: ${meldung}`,
    };
    audit.log(req, 'system', null, 'Herunterfahren fehlgeschlagen', meldung);
    res.redirect('/system');
  });
});

module.exports = router;
