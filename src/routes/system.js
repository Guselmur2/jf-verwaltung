'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const express = require('express');
const auth = require('../auth');
const audit = require('../audit');
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
  res.render('system', { title: 'System', zustand: zustand(), sicherung: sicherungsstand() });
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
