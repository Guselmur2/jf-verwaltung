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
// Eigene Datei fuer den blossen Abgleich, damit ein Nachsehen nicht das
// Ergebnis der letzten echten Aktualisierung ueberschreibt — das braucht man
// gerade dann, wenn etwas schiefging.
const ABGLEICH = process.env.UPDATE_ABGLEICH || path.join(DATA_DIR, 'update-abgleich.json');
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
 * Wann wurde zuletzt vom Server geholt? FETCH_HEAD schreibt git bei jedem
 * "fetch" neu — die Uhrzeit der Datei ist also genau die Antwort.
 */
function letzterAbgleich() {
  try {
    return fs.statSync(path.join(ORDNER, '.git', 'FETCH_HEAD')).mtime;
  } catch {
    return null; // noch nie geholt
  }
}

/**
 * Sieht nach, ob es etwas Neues gibt.
 *
 * Und zwar OHNE "git fetch" — das ist der springende Punkt. Der Dienst laeuft
 * mit ProtectSystem=strict und darf ausser data/ nirgends schreiben; ein fetch
 * will aber .git/FETCH_HEAD anlegen und scheitert an "Read-only file system".
 *
 * Die naheliegende Abhilfe waere, .git in ReadWritePaths aufzunehmen. Genau das
 * darf nicht sein: wer in .git schreiben kann, kann die Herkunftsadresse
 * aendern oder Objekte unterschieben — und der Helfer spielt sie anschliessend
 * als root ein und laesst dabei npm ci laufen. Aus einer Luecke in der
 * Weboberflaeche wuerde so Rootzugriff. Der ganze Aufbau ist darauf angelegt,
 * dass genau das nicht geht.
 *
 * Geholt wird deshalb vom Helfer (siehe abgleichAnfordern). Hier wird nur
 * gelesen, was dabei herauskam.
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

  const jetzigerStand = await stand();
  const abgeglichen = letzterAbgleich();

  // Ohne origin/<Zweig> gab es noch keinen Abgleich — dann gibt es auch nichts
  // zu vergleichen.
  const fern = await git(['rev-parse', '--verify', '--quiet', `origin/${ZWEIG}`]);
  if (fern.code !== 0) {
    return { moeglich: true, unbekannt: true, stand: jetzigerStand, abgeglichen, letzter: abgleichStand() };
  }

  const liste = await git(['log', '--oneline', `HEAD..origin/${ZWEIG}`]);
  const zeilen = liste.aus ? liste.aus.split('\n').filter(Boolean) : [];

  return {
    moeglich: true,
    unbekannt: false,
    aktuell: zeilen.length === 0,
    anzahl: zeilen.length,
    commits: zeilen.map((z) => {
      const leer = z.indexOf(' ');
      return { kurz: z.slice(0, leer), text: z.slice(leer + 1) };
    }),
    stand: jetzigerStand,
    abgeglichen,
    letzter: abgleichStand(),
  };
}

/**
 * Fordert die Aktualisierung an. Mehr passiert hier nicht — den Rest macht der
 * Helfer, der von systemd gestartet wird.
 */
function anfordern(von) {
  markeSchreiben('update', von);
  // Damit die Seite sofort etwas anzeigen kann, statt "noch nie gelaufen".
  statusSchreiben(STATUS, {
    zeitpunkt: new Date().toISOString(),
    schritt: 'angefordert',
    ergebnis: 'laeuft',
  });
  return true;
}

/**
 * Bittet den Helfer, einmal beim Repository nachzufragen. Mehr als die
 * Markierung passiert auch hier nicht — geholt wird ausserhalb des Dienstes.
 */
function abgleichAnfordern(von) {
  markeSchreiben('pruefen', von);
  statusSchreiben(ABGLEICH, {
    zeitpunkt: new Date().toISOString(),
    schritt: 'abgleich',
    ergebnis: 'laeuft',
  });
  return true;
}

/** Die Markierung, auf die jf-update.path wartet. Zeile 1 sagt, was zu tun ist. */
function markeSchreiben(modus, von) {
  try {
    fs.mkdirSync(path.dirname(MARKE), { recursive: true });
  } catch {
    /* liegt schon da */
  }
  fs.writeFileSync(MARKE, `${modus}\n${new Date().toISOString()}\n${von || ''}\n`);
}

function statusSchreiben(datei, inhalt) {
  try {
    fs.writeFileSync(datei, JSON.stringify(inhalt, null, 2));
  } catch {
    /* nicht schlimm — die Anzeige bleibt dann beim alten Stand */
  }
}

function statusLesen(datei) {
  try {
    const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
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

/** Was der Helfer zur letzten Aktualisierung gemeldet hat. */
function status() {
  return statusLesen(STATUS);
}

/** Was der Helfer zum letzten Abgleich gemeldet hat. */
function abgleichStand() {
  return statusLesen(ABGLEICH);
}

/** Laeuft gerade etwas? Auch die Markierung zaehlt. */
function inArbeit() {
  if (fs.existsSync(MARKE)) return true;
  const a = status();
  const b = abgleichStand();
  return !!((a && a.laeuft) || (b && b.laeuft));
}

/** Was genau laeuft gerade — 'update', 'abgleich' oder null? */
function artInArbeit() {
  if (!inArbeit()) return null;
  const a = status();
  if (a && a.laeuft) return 'update';
  const b = abgleichStand();
  if (b && b.laeuft) return 'abgleich';
  // Nur die Markierung liegt da: die erste Zeile sagt, was gemeint ist.
  try {
    return fs.readFileSync(MARKE, 'utf8').split('\n')[0].trim() === 'pruefen' ? 'abgleich' : 'update';
  } catch {
    return 'update';
  }
}

module.exports = {
  istGit, stand, standSynchron, pruefen, anfordern, abgleichAnfordern,
  status, abgleichStand, letzterAbgleich, inArbeit, artInArbeit,
  ORDNER, MARKE, STATUS, ABGLEICH, ZWEIG,
};
