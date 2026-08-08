'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { DATA_DIR } = require('./db');

// Aktualisierung über die Oberfläche.
//
// Der entscheidende Punkt: die Anwendung aktualisiert sich NICHT selbst. Sie
// kann es nicht — "systemctl restart" würde genau den Prozess abschiessen, der
// den Befehl absetzt, mitten in der Anfrage. Und ginge beim Einspielen etwas
// schief, könnte ausgerechnet die kaputte Anwendung keine Rettungsseite mehr
// ausliefern.
//
// Stattdessen legt sie nur eine Markierung ab. Ein systemd-Wächter
// (jf-update.path) startet daraufhin den Helfer als root, ausserhalb dieses
// Prozesses. Der sichert, spielt ein, startet neu, prueft — und setzt bei
// Misserfolg von selbst zurueck. Die Anwendung braucht dafuer keinerlei
// Sonderrechte; NoNewPrivileges bleibt bestehen.
//
// Beide Pfade sind ueber die Umgebung austauschbar, damit sich der Ablauf
// testen laesst, ohne einen Rechner zu aktualisieren.

const ORDNER = process.env.GIT_ORDNER || path.join(__dirname, '..');
const MARKE = process.env.UPDATE_MARKE || '/run/jf-spinte/update-anfordern';
const STATUS = process.env.UPDATE_STATUS || path.join(DATA_DIR, 'update-status.json');
const ZWEIG = process.env.UPDATE_ZWEIG || 'main';

/** git mit Zeitgrenze. Liefert { code, aus, fehler }. */
function git(argumente, zeitgrenze = 20000) {
  return new Promise((fertig) => {
    execFile('git', ['-C', ORDNER, ...argumente], { timeout: zeitgrenze }, (fehler, aus, fehlerAus) => {
      fertig({
        code: fehler ? fehler.code ?? 1 : 0,
        aus: String(aus || '').trim(),
        fehler: String(fehlerAus || (fehler ? fehler.message : '')).trim(),
      });
    });
  });
}

/** Ist die Installation ueberhaupt ein Git-Arbeitsverzeichnis? */
function istGit() {
  return fs.existsSync(path.join(ORDNER, '.git'));
}

/** Der Stand, auf dem die Installation gerade laeuft. */
async function stand() {
  if (!istGit()) return null;
  const r = await git(['log', '--oneline', '-1']);
  return r.code === 0 ? r.aus : null;
}

/**
 * Der Stand als Kurzfassung, ohne git aufzurufen — liest .git direkt.
 * Fuer Anzeigen gedacht, die bei jedem Seitenaufruf gebraucht werden.
 */
function standSynchron() {
  try {
    const kopf = fs.readFileSync(path.join(ORDNER, '.git', 'HEAD'), 'utf8').trim();
    const ref = kopf.startsWith('ref: ') ? kopf.slice(5) : null;
    const sha = ref ? fs.readFileSync(path.join(ORDNER, '.git', ref), 'utf8').trim() : kopf;
    return /^[0-9a-f]{7,}$/i.test(sha) ? sha.slice(0, 7) : null;
  } catch {
    // Kein Git-Arbeitsverzeichnis oder gepackte Referenzen — dann eben ohne.
    return null;
  }
}

/**
 * Sieht nach, ob es etwas Neues gibt. Holt dafuer vom Server (das aendert
 * nichts an den Dateien) und vergleicht.
 */
async function pruefen() {
  if (!istGit()) {
    return {
      moeglich: false,
      grund:
        'Diese Installation ist kein Git-Arbeitsverzeichnis. Einmalig umstellen mit ' +
        'scripts/auf-git-umstellen.sh — siehe README.',
    };
  }

  const geholt = await git(['fetch', '--quiet', 'origin', ZWEIG], 45000);
  if (geholt.code !== 0) {
    return {
      moeglich: false,
      grund: `Das Repository ist nicht erreichbar: ${geholt.fehler || 'unbekannter Fehler'}`,
    };
  }

  const liste = await git(['log', '--oneline', `HEAD..origin/${ZWEIG}`]);
  const zeilen = liste.aus ? liste.aus.split('\n').filter(Boolean) : [];

  return {
    moeglich: true,
    aktuell: zeilen.length === 0,
    anzahl: zeilen.length,
    commits: zeilen.map((z) => {
      const leer = z.indexOf(' ');
      return { kurz: z.slice(0, leer), text: z.slice(leer + 1) };
    }),
    stand: await stand(),
  };
}

/**
 * Fordert die Aktualisierung an. Mehr passiert hier nicht — den Rest macht der
 * Helfer, der von systemd gestartet wird.
 */
function anfordern(von) {
  const ordner = path.dirname(MARKE);
  try {
    fs.mkdirSync(ordner, { recursive: true });
  } catch {
    /* liegt schon da */
  }
  fs.writeFileSync(MARKE, `${new Date().toISOString()}\n${von || ''}\n`);
  // Damit die Seite sofort etwas anzeigen kann, statt "noch nie gelaufen".
  statusSchreiben({ zeitpunkt: new Date().toISOString(), schritt: 'angefordert', ergebnis: 'laeuft' });
  return true;
}

function statusSchreiben(inhalt) {
  try {
    fs.writeFileSync(STATUS, JSON.stringify(inhalt, null, 2));
  } catch {
    /* nicht schlimm — die Anzeige bleibt dann beim alten Stand */
  }
}

/** Was der Helfer zuletzt gemeldet hat. */
function status() {
  try {
    const roh = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
    const zeit = new Date(roh.zeitpunkt);
    return {
      ...roh,
      zeit: Number.isNaN(zeit.getTime()) ? null : zeit,
      laeuft: roh.ergebnis === 'laeuft',
    };
  } catch {
    return null;
  }
}

/** Laeuft gerade eine Aktualisierung? Auch die Markierung zaehlt. */
function inArbeit() {
  if (fs.existsSync(MARKE)) return true;
  const s = status();
  return !!(s && s.laeuft);
}

module.exports = {
  istGit, stand, standSynchron, pruefen, anfordern, status, inArbeit,
  ORDNER, MARKE, STATUS, ZWEIG,
};
