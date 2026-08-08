'use strict';

// Nimmt die Bilder fuer docs/handbuch.md auf.
//
//   node scripts/doku-daten.js --force   (einmal, legt den Demo-Bestand an)
//   node scripts/doku-bilder.js
//
// Startet den Server auf dem Demo-Bestand, steuert Chrome im Kopflos-Modus
// ueber das DevTools-Protokoll und legt PNG-Dateien in docs/bilder ab.
//
// Ohne zusaetzliche Abhaengigkeit: Node bringt seit Fassung 22 einen
// WebSocket mit, und mehr braucht das Protokoll nicht. Fuer eine Doku will
// niemand ein halbes Browser-Framework installieren.
//
// Die Anmeldung laeuft nicht ueber das Formular, sondern ueber einen echten
// Anmeldevorgang per fetch — der Sitzungs-Keks wird danach in den Browser
// gelegt. Das ist unempfindlicher als Tippen in Felder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const WURZEL = path.join(__dirname, '..');
const DATEN = process.env.DATA_DIR || path.join(WURZEL, 'data-doku');
const ZIEL = path.join(WURZEL, 'docs', 'bilder');
const PORT = Number(process.env.PORT) || 3999;
const BASIS = `http://127.0.0.1:${PORT}`;
const DEBUG_PORT = 9333;
const BENUTZER = { username: 'jugendwart', password: 'doku1234' };

// Breite wie ein schmaler Laptop: die Seiten sind auf 1100 px begrenzt, mehr
// Fenster wuerde nur Rand zeigen.
const BREIT = 1180;
const HOCH = 900;
const HANDY = { breite: 390, hoehe: 844 };

function chromePfad() {
  const kandidaten = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const k of kandidaten) if (fs.existsSync(k)) return k;
  throw new Error('Chrome nicht gefunden. Pfad ueber CHROME= angeben.');
}

const warten = (ms) => new Promise((f) => setTimeout(f, ms));

// ------------------------------------------------------------ CDP-Sprechrohr

class Draht {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.n = 0;
    this.offen = new Map();
    this.ws.addEventListener('message', (e) => {
      const nachricht = JSON.parse(e.data);
      if (nachricht.id && this.offen.has(nachricht.id)) {
        const { fertig, schief } = this.offen.get(nachricht.id);
        this.offen.delete(nachricht.id);
        nachricht.error ? schief(new Error(nachricht.error.message)) : fertig(nachricht.result);
      }
    });
  }

  bereit() {
    return new Promise((fertig, schief) => {
      this.ws.addEventListener('open', () => fertig());
      this.ws.addEventListener('error', () => schief(new Error('Verbindung zu Chrome fehlgeschlagen')));
    });
  }

  ruf(methode, params = {}) {
    const id = ++this.n;
    return new Promise((fertig, schief) => {
      this.offen.set(id, { fertig, schief });
      this.ws.send(JSON.stringify({ id, method: methode, params }));
    });
  }
}

// ------------------------------------------------------------------ Bestand

/** IDs und Token aus dem Demo-Bestand — die Adressen brauchen sie. */
function bestand() {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(DATEN, 'spinte.db'), { readonly: true });
  try {
    const spint = db
      .prepare("SELECT l.id, l.token, l.code FROM lockers l JOIN members m ON m.id = l.member_id WHERE m.name = 'Ben Adler'")
      .get();
    const lagerort = db.prepare('SELECT id, token, name FROM storages WHERE is_default = 1').get();
    const teil = db
      .prepare(
        'SELECT e.id FROM equipment e JOIN equipment_types t ON t.id = e.type_id ' +
          "WHERE e.locker_id = ? AND t.name = 'Jacke'"
      )
      .get(spint.id);
    const heute = db.prepare('SELECT id, datum FROM termine ORDER BY datum DESC').get();
    return { spint, lagerort, teil, heute };
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------- Ablauf

async function anmelden() {
  const seite = await fetch(`${BASIS}/anmelden`);
  const keks = (seite.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const token = (await seite.text()).match(/name="_csrf" value="([^"]+)"/)[1];

  const antwort = await fetch(`${BASIS}/anmelden`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: keks, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token, ...BENUTZER }).toString(),
  });
  const gesetzt = (antwort.headers.getSetCookie?.() || []).find((c) => c.startsWith('jfspint.sid='));
  if (!gesetzt) throw new Error(`Anmeldung fehlgeschlagen (Status ${antwort.status})`);
  const [name, wert] = gesetzt.split(';')[0].split('=');
  return { name, wert: decodeURIComponent(wert) };
}

async function main() {
  if (!fs.existsSync(path.join(DATEN, 'spinte.db'))) {
    throw new Error(`Kein Demo-Bestand in ${DATEN}. Erst "node scripts/doku-daten.js --force" laufen lassen.`);
  }
  fs.mkdirSync(ZIEL, { recursive: true });

  // ------------------------------------------------------------ Server
  const server = spawn(process.execPath, ['server.js'], {
    cwd: WURZEL,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATEN, SESSION_SECRET: 'doku', BASE_URL: 'https://jfwpi.local' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let v = 0; ; v++) {
    try {
      await fetch(`${BASIS}/anmelden`);
      break;
    } catch (err) {
      if (v > 100) throw new Error('Server startet nicht: ' + err.message);
      await warten(100);
    }
  }
  console.log(`Server laeuft auf ${BASIS} (Bestand: ${DATEN})`);

  const keks = await anmelden();
  const b = bestand();

  // ------------------------------------------------------------ Chrome
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-doku-chrome-'));
  const chrome = spawn(
    chromePfad(),
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profil}`,
      `--window-size=${BREIT},${HOCH}`,
      '--hide-scrollbars',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );

  let ziel = null;
  for (let v = 0; ; v++) {
    try {
      const liste = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      ziel = liste.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (ziel) break;
    } catch {
      /* Chrome ist noch am Starten */
    }
    if (v > 150) throw new Error('Chrome meldet sich nicht am Debug-Port');
    await warten(100);
  }

  const draht = new Draht(ziel.webSocketDebuggerUrl);
  await draht.bereit();
  await draht.ruf('Page.enable');
  await draht.ruf('Network.enable');
  await draht.ruf('Runtime.enable');
  await draht.ruf('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });

  const angemeldet = async (ja) => {
    await draht.ruf('Network.clearBrowserCookies');
    if (ja) {
      await draht.ruf('Network.setCookie', {
        name: keks.name,
        value: keks.wert,
        domain: '127.0.0.1',
        path: '/',
      });
    }
  };
  await angemeldet(true);

  /** Fenstergroesse setzen. Zwei Groessen: Laptop und Handy. */
  const fenster = (breite, hoehe, mobil = false) =>
    draht.ruf('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: hoehe,
      deviceScaleFactor: 2, // schaerfer auf guten Bildschirmen
      mobile: mobil,
    });
  await fenster(BREIT, HOCH);

  let gezaehlt = 0;

  /**
   * Ein Bild aufnehmen.
   *   maxHoehe  kappt lange Listen — ein 4000 Pixel hohes Bild liest niemand
   *   vorher    Javascript, das vor der Aufnahme laeuft (Menü aufklappen o.ae.)
   */
  async function bild(name, adresse, { maxHoehe = 1500, vorher = null, ab = null, ruhe = 350 } = {}) {
    await draht.ruf('Page.navigate', { url: BASIS + adresse });
    // Auf das Laden warten: die Seiten sind statisch, ein kurzer Moment genuegt.
    await warten(ruhe);
    if (vorher) await draht.ruf('Runtime.evaluate', { expression: vorher, awaitPromise: true });
    if (vorher) await warten(250);

    const { cssContentSize } = await draht.ruf('Page.getLayoutMetrics');

    // Lange Seiten haben mehrere Abschnitte. "ab" schneidet erst dort an —
    // ein Anker in der Adresse genuegt nicht, weil das Bild ohnehin von oben
    // aufgenommen wird.
    let start = 0;
    if (ab) {
      const { result } = await draht.ruf('Runtime.evaluate', {
        expression: `(() => { const e = document.querySelector('${ab}');
          return e ? Math.max(0, Math.round(e.getBoundingClientRect().top + window.scrollY) - 24) : 0; })()`,
        returnByValue: true,
      });
      start = result.value || 0;
    }

    const hoehe = Math.min(Math.ceil(cssContentSize.height) - start, maxHoehe);
    const { data } = await draht.ruf('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: start, width: Math.ceil(cssContentSize.width), height: hoehe, scale: 1 },
    });
    const datei = path.join(ZIEL, `${name}.png`);
    fs.writeFileSync(datei, Buffer.from(data, 'base64'));
    const kb = Math.round(fs.statSync(datei).size / 1024);
    gezaehlt++;
    console.log(`  ${String(gezaehlt).padStart(2)}. ${name}.png  ${kb} KB`);
  }

  // ------------------------------------------------------- Ohne Anmeldung
  await angemeldet(false);
  await bild('anmeldung', '/anmelden', { maxHoehe: 700 });
  await bild('spint-qr-anonym', `/s/${b.spint.token}`, { maxHoehe: 1000 });
  await bild('lagerort-qr-anonym', `/l/${b.lagerort.token}`, { maxHoehe: 1000 });

  // ------------------------------------------------------- Mit Anmeldung
  await angemeldet(true);
  // Erster Aufruf nur, um die Meldung "Angemeldet als ..." abzuholen — die soll
  // nicht auf jedem Bild stehen.
  await draht.ruf('Page.navigate', { url: BASIS + '/' });
  await warten(400);
  await bild('uebersicht', '/', { maxHoehe: 1400 });
  await bild('navigation-dienst', '/', {
    maxHoehe: 700,
    vorher: "document.querySelector('.navmenu').open = true",
  });
  await bild('spint-bearbeiten', `/spint/${b.spint.id}/bearbeiten`, { maxHoehe: 1900 });
  await bild('tauschen', `/ausruestung/${b.teil.id}/tauschen`, { maxHoehe: 1200 });
  await bild('aufgaben', '/aufgaben', { maxHoehe: 1200 });
  await bild('mitglieder', '/mitglieder', { maxHoehe: 1600 });
  await bild('lager', '/lager', { maxHoehe: 1700 });
  await bild('lagerorte', '/lagerorte', { maxHoehe: 1400 });
  await bild('arten-groessen', '/ausruestungsarten', { maxHoehe: 1600 });
  await bild('suche', '/suche?q=158', { maxHoehe: 1200 });
  await bild('ausgemustert', '/ausgemustert', { maxHoehe: 900 });

  // Dienstabend
  await bild('anwesenheit', `/anwesenheit/${b.heute.id}`, { maxHoehe: 1600 });
  await bild('anwesenheit-quoten', '/anwesenheit/quoten', { maxHoehe: 1500 });
  // Zweimal: einmal zugeklappt (so kommt die Seite hoch, wenn Kinder daneben
  // stehen) und einmal geoeffnet.
  await bild('einschaetzung', '/einschaetzung', { maxHoehe: 900 });
  await bild('einschaetzung-offen', '/einschaetzung?zeigen=1', { maxHoehe: 1550 });
  await bild('einschaetzung-eignung', '/einschaetzung?zeigen=1', { ab: '#eignung', maxHoehe: 1700 });
  await bild('einteilung', '/einteilung?bilden=1&aufstellung=gruppe&anzahl=2', { maxHoehe: 2000 });

  // Drucken
  await bild('qr-aufkleber', '/qr', { maxHoehe: 1300 });
  await bild('etikett', `/etikett/${b.spint.id}?pro=1`, { maxHoehe: 1700 });
  await bild('etiketten-bogen', '/etiketten?pro=2&belegt=1', { maxHoehe: 1700 });

  // Verwaltung
  await bild('stammdaten', '/stammdaten', { maxHoehe: 1500 });
  await bild('sicherung', '/sicherung', { maxHoehe: 1400 });
  await bild('system', '/system', { maxHoehe: 1500 });
  await bild('update', '/system/update', { maxHoehe: 1100 });
  await bild('restore', '/restore', { maxHoehe: 1300 });
  await bild('betreuer', '/betreuer', { maxHoehe: 1000 });
  await bild('api-zugaenge', '/api-zugaenge', { maxHoehe: 1200 });
  await bild('verlauf', '/verlauf', { maxHoehe: 1200 });

  // Dunkle Darstellung — die Software folgt der Einstellung des Geraets.
  await draht.ruf('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await bild('uebersicht-dunkel', '/', { maxHoehe: 1000 });
  await draht.ruf('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });

  // ------------------------------------------------------------- Am Handy
  await fenster(HANDY.breite, HANDY.hoehe, true);
  await bild('handy-anwesenheit', `/anwesenheit/${b.heute.id}`, { maxHoehe: 1500 });
  await bild('handy-spint', `/spint/${b.spint.id}/bearbeiten`, { maxHoehe: 1500 });
  await angemeldet(false);
  await bild('handy-spint-qr', `/s/${b.spint.token}`, { maxHoehe: 1200 });

  // ------------------------------------------------------------ Aufraeumen
  await draht.ruf('Browser.close').catch(() => {});
  chrome.kill();
  server.kill();
  try {
    fs.rmSync(profil, { recursive: true, force: true });
  } catch {
    /* Windows haelt das Profil manchmal noch kurz */
  }

  const gesamt = fs
    .readdirSync(ZIEL)
    .filter((f) => f.endsWith('.png'))
    .reduce((s, f) => s + fs.statSync(path.join(ZIEL, f)).size, 0);
  console.log(`\n${gezaehlt} Bilder in docs/bilder, zusammen ${Math.round(gesamt / 1024)} KB`);

  // Chrome laesst sich unter Windows Zeit — sonst haengt der Prozess.
  setTimeout(() => process.exit(0), 300);
}

main().catch((err) => {
  console.error(err.message);
  spawnSync(process.platform === 'win32' ? 'taskkill' : 'pkill', process.platform === 'win32' ? ['/f', '/im', 'chrome.exe'] : ['-f', 'jf-doku-chrome'], { stdio: 'ignore' });
  process.exit(1);
});
