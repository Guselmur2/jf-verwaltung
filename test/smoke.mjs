// Durchlauf durch die wichtigsten Abläufe gegen einen frisch gestarteten Server
// mit leerer Datenbank. Aufruf: npm test
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const datenordner = mkdtempSync(path.join(tmpdir(), 'jf-spinte-test-'));

// Der Abschalt-Befehl wird im Test durch ein harmloses Skript ersetzt — es legt
// eine Datei an, statt den Rechner auszuschalten. Damit laesst sich der ganze
// Weg pruefen, ohne dass der Testlauf den Rechner mitnimmt.
const abschaltHelfer = path.join(datenordner, 'abschalt-helfer.js');
const abschaltNachweis = path.join(datenordner, 'abgeschaltet.txt');
writeFileSync(
  abschaltHelfer,
  "const fs = require('fs');\n" +
    "if (process.argv[2] === '--fehler') {\n" +
    "  process.stderr.write('Interactive authentication required.\\n');\n" +
    '  process.exit(1);\n' +
    '}\n' +
    "fs.writeFileSync(process.argv[2], 'abgeschaltet');\n"
);

// Die Aktualisierung wird komplett am Testordner nachgestellt: GIT_ORDNER zeigt
// nicht auf diese Arbeitskopie (sonst wuerde der Testlauf wirklich vom Server
// holen), und die Markierung landet in einer Datei, die der Test nachsehen kann.
// Ein echter Helfer laeuft dabei nie mit — das ist Sache von systemd.
const gitOrdner = path.join(datenordner, 'installation');
const updateMarke = path.join(datenordner, 'update-anfordern');
const updateStatus = path.join(datenordner, 'update-status.json');
const updateAbgleich = path.join(datenordner, 'update-abgleich.json');
mkdirSync(gitOrdner, { recursive: true });

const server = spawn(process.execPath, ['server.js'], {
  cwd: WURZEL,
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: datenordner,
    SESSION_SECRET: 'test',
    ABSCHALT_BEFEHL: JSON.stringify([process.execPath, abschaltHelfer, abschaltNachweis]),
    GIT_ORDNER: gitOrdner,
    UPDATE_MARKE: updateMarke,
    UPDATE_STATUS: updateStatus,
    UPDATE_ABGLEICH: updateAbgleich,
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

process.on('exit', () => {
  server.kill();
  try {
    rmSync(datenordner, { recursive: true, force: true });
  } catch {
    /* unter Windows haelt SQLite die Datei manchmal noch kurz fest */
  }
});

// Auf den Server warten, statt blind zu schlafen.
for (let versuch = 0; ; versuch++) {
  try {
    await fetch(BASE + '/einrichtung');
    break;
  } catch (err) {
    if (versuch > 100) throw new Error('Server startet nicht: ' + err.message);
    await new Promise((r) => setTimeout(r, 100));
  }
}

let cookie = '';
let fails = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name} ${extra}`); }
}

async function req(path, { method = 'GET', form = null, redirect = 'manual' } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await fetch(BASE + path, { method, headers, body, redirect });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) cookie = c.split(';')[0];
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text };
}

async function csrf(path) {
  const r = await req(path);
  const m = r.text.match(/name="_csrf" value="([^"]+)"/);
  if (!m) throw new Error(`kein CSRF-Token auf ${path} (status ${r.status})`);
  return m[1];
}

// Legt einen Spint an und liefert dessen id (aus der Weiterleitung).
async function createLocker(fields) {
  const token = await csrf('/spinte/neu');
  const r = await req('/spinte/neu', { method: 'POST', form: { _csrf: token, ...fields } });
  const m = (r.location || '').match(/^\/spint\/(\d+)\/bearbeiten$/);
  return { id: m ? Number(m[1]) : null, res: r };
}

// Sucht auf der Spint-Bearbeiten-Seite die Ausrüstungs-id in der Zeile, die
// <text> enthält (z. B. eine Inventarnummer).
function idAusZeile(html, text) {
  // Ohne schliessendes Anfuehrungszeichen trennen: die Zeile kann noch weitere
  // Klassen tragen, etwa wenn eine Aufgabe an dem Teil offen ist.
  for (const block of html.split('class="teilzeile')) {
    if (block.includes(text)) return Number(block.match(/\/ausruestung\/(\d+)\//)?.[1]) || null;
  }
  return null;
}

// Liest die Bereichs-Auswahl aus dem Neuer-Spint-Formular als {name: id}.
async function areaMap() {
  const r = await req('/spinte/neu');
  const sel = r.text.match(/<select name="area_id"[^>]*>([\s\S]*?)<\/select>/);
  const map = {};
  if (sel) {
    for (const o of sel[1].matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)) {
      map[o[2].trim()] = Number(o[1]);
    }
  }
  return map;
}

console.log('\n1) Ersteinrichtung');
let r = await req('/');
check('leere DB leitet zur Einrichtung', r.status === 302 && r.location === '/einrichtung', r.status + ' ' + r.location);

let token = await csrf('/einrichtung');
r = await req('/einrichtung', {
  method: 'POST',
  form: { _csrf: token, name: 'Max Wart', username: 'jugendwart', password: 'geheim1234', password2: 'geheim1234' },
});
check('Jugendwart angelegt + eingeloggt', r.status === 302 && r.location === '/', r.status + ' ' + r.location);

console.log('\n2) CSRF-Schutz');
r = await req('/spinte/neu', { method: 'POST', form: { code: 'X', _csrf: 'falsch' } });
check('falsches Token wird abgelehnt', r.status === 403, String(r.status));

console.log('\n3) Datum-Kurzform und Geschlecht');
token = await csrf('/mitglieder');
r = await req('/mitglieder/neu', { method: 'POST', form: { _csrf: token, name: 'Max Muster', gender: 'm', birthday: '5.5.16' } });
check('erster Junge angelegt (kein Bereichs-Dialog)', r.status === 302 && r.location === '/mitglieder', r.location);
r = await req('/mitglieder');
check('Datum 5.5.16 wird zu 05.05.2016', r.text.includes('05.05.2016'));
check('Geschlecht männlich angezeigt', r.text.includes('männlich'));

r = await req('/');
check('bei nur einem Geschlecht keine Bereichs-Gruppen', !r.text.includes('bereichstitel'));

console.log('\n4) Neues Geschlecht → Nachfrage beim Jugendwart');
token = await csrf('/mitglieder');
r = await req('/mitglieder/neu', { method: 'POST', form: { _csrf: token, name: 'Lena Muster', gender: 'w', birthday: '23.5.87' } });
check('erstes Mädel führt zum Einrichtungsdialog', r.status === 302 && (r.location || '').startsWith('/bereiche/einrichten?geschlecht=w'), r.location);
r = await req('/mitglieder');
check('Datum 23.5.87 wird zu 23.05.1987', r.text.includes('23.05.1987'));

token = await csrf('/bereiche/einrichten?geschlecht=w');
r = await req('/bereiche/einrichten?geschlecht=w', {
  method: 'POST',
  form: { _csrf: token, geschlecht: 'w', modus: 'eigen', name: 'Umkleide Mädels', numbering: 'eigen' },
});
check('eigener Mädels-Bereich angelegt', r.status === 302 && r.location === '/mitglieder', r.location);

console.log('\n5) Spinte pro Bereich, eigene Nummerierung');
let areas = await areaMap();
const boysArea = areas['Umkleide Jungs'];
const girlsArea = areas['Umkleide Mädels'];
check('beide Bereiche im Formular wählbar', !!boysArea && !!girlsArea, JSON.stringify(areas));

const boys01 = await createLocker({ code: '01', area_id: boysArea, member_id: '1' });
check('Spint 01 im Jungs-Bereich (Max)', boys01.id !== null, boys01.res.location);
const girls01 = await createLocker({ code: '01', area_id: girlsArea, member_id: '2' });
check('Spint 01 im Mädels-Bereich (Lena) — gleiche Nummer erlaubt', girls01.id !== null, girls01.res.location);
const dup = await createLocker({ code: '01', area_id: boysArea });
check('gleiche Nummer im selben Bereich wird abgelehnt', dup.res.status === 400 && dup.res.text.includes('schon vergeben'));

r = await req('/');
check('Übersicht gruppiert nach Bereich', r.text.includes('bereichstitel') && r.text.includes('Umkleide Jungs') && r.text.includes('Umkleide Mädels'));

console.log('\n6) Bereich filtert Mitglieder-Auswahl');
r = await req(`/spint/${boys01.id}/bearbeiten`);
const memSel = r.text.match(/<select name="member_id">([\s\S]*?)<\/select>/);
check('Jungs-Spint bietet Max an', memSel && memSel[1].includes('Max Muster'));
check('Jungs-Spint bietet Lena NICHT an', memSel && !memSel[1].includes('Lena Muster'));

console.log('\n7) Ausrüstung, Lager, Suche');
token = await csrf(`/spint/${boys01.id}/bearbeiten`);
for (const [type, size, inv] of [['1', '164', 'JA-0815'], ['3', '', 'HE-0042']]) {
  await req('/ausruestung/neu', {
    method: 'POST',
    form: { _csrf: token, zurueck: `/spint/${boys01.id}/bearbeiten`, locker_id: String(boys01.id), type_id: type, size, inventory_no: inv, condition: 'gut' },
  });
}
r = await req(`/spint/${boys01.id}`);
check('Spint-Seite zeigt Besitzer', r.text.includes('Dieser Spint gehört') && r.text.includes('Max Muster'));
check('Spint-Seite zeigt Jacke 164', r.text.includes('Jacke') && r.text.includes('164'));
check('Spint-Seite zeigt Bereichs-Kennzeichnung', r.text.includes('Umkleide Jungs'));

r = await req('/suche?q=HE-0042');
check('Suche findet Inventarnummer', r.text.includes('Helm'));
r = await req('/qr');
check('QR-Seite rendert SVG mit Token-Link',
  r.text.includes('<svg') && /\/s\/[a-z2-9]{8,}/.test(r.text) && !r.text.includes(`/spint/${boys01.id}`));

console.log('\n8) Ohne Anmeldung: nur der eigene QR-Code');
// Token des Jungs-Spints aus der QR-Seite holen (dort steht die Adresse).
r = await req('/qr');
const tokenJungs = r.text.match(/\/s\/([a-z2-9]{8,})/)?.[1];
const tokenMaedels = [...r.text.matchAll(/\/s\/([a-z2-9]{8,})/g)].map((x) => x[1])[1];
check('QR-Codes tragen einen Token statt der Nummer', !!tokenJungs && tokenJungs !== String(boys01.id));
check('jeder Spint hat einen eigenen Token', !!tokenMaedels && tokenMaedels !== tokenJungs);

const merk = cookie;
cookie = '';

r = await req(`/s/${tokenJungs}`);
check('Spint per QR-Token ohne Login lesbar', r.status === 200 && r.text.includes('Max Muster'));
check('kein Bearbeiten-Knopf', !r.text.includes('/bearbeiten'));
check('keine Navigation zu anderen Seiten', !r.text.includes('href="/mitglieder"') && !r.text.includes('href="/lager"'));
check('kein Link auf die Spint-Übersicht', !r.text.includes('Alle Spinte'));

// Der Kern: Durchprobieren darf nichts bringen.
r = await req(`/spint/${boys01.id}`);
check('Spint über die laufende Nummer ist gesperrt', r.status === 302 && r.location === '/anmelden', r.location);
r = await req('/');
check('Übersicht ist gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req('/mitglieder');
check('Mitgliederliste ist gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req('/suche?q=Muster');
check('Suche ist gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req('/lager');
check('Lagerbestand ist gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req('/scannen?nr=HE-0042');
check('Scan-Weiterleitung ist gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req('/qr');
check('QR-Druckseite ist gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req('/aufgaben');
check('Aufgaben sind gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req('/bereiche');
check('Bereiche sind gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req(`/s/${tokenJungs}/bearbeiten`);
check('erfundene Unterseite am Token ist gesperrt', r.status === 302 && r.location === '/anmelden', r.location);
r = await req('/s/abcdefghjkmn');
check('geratener Token führt ins Leere', r.status === 404, String(r.status));

// Der zweite Spint bleibt fremd, obwohl man den ersten kennt.
r = await req(`/s/${tokenMaedels}`);
check('anderer Spint zeigt nur dessen eigenes Mitglied',
  r.status === 200 && r.text.includes('Lena Muster') && !r.text.includes('Max Muster'));

cookie = merk;

console.log('\n9) Rollen und Rechte');
token = await csrf('/betreuer');
r = await req('/betreuer/neu', { method: 'POST', form: { _csrf: token, name: 'Tim Helfer', username: 'tim', password: 'passwort123', role: 'betreuer' } });
check('Betreuer angelegt', r.status === 302);

cookie = '';
token = await csrf('/anmelden');
r = await req('/anmelden', { method: 'POST', form: { _csrf: token, username: 'tim', password: 'passwort123' } });
check('Betreuer kann sich anmelden', r.status === 302);
r = await req('/bereiche');
check('Betreuer kommt nicht in die Bereichsverwaltung', r.status === 403, String(r.status));
r = await req(`/spint/${boys01.id}/bearbeiten`);
check('Betreuer darf Spinte bearbeiten', r.status === 200);

console.log('\n10) Verlauf');
cookie = '';
token = await csrf('/anmelden');
await req('/anmelden', { method: 'POST', form: { _csrf: token, username: 'jugendwart', password: 'geheim1234' } });
r = await req('/verlauf');
check('Verlauf protokolliert Änderungen', r.status === 200 && r.text.includes('Max Wart') && r.text.includes('angelegt'));

console.log('\n11) Lagerorte mit QR-Code');
token = await csrf('/lagerorte');
r = await req('/lagerorte/neu', { method: 'POST', form: { _csrf: token, name: 'Schrank 1', location: 'Gerätehaus' } });
const schrank = Number((r.location || '').match(/\/lagerort\/(\d+)/)?.[1]);
check('Lagerort angelegt', !!schrank, r.location);

token = await csrf('/lagerorte');
r = await req('/lagerorte/neu', { method: 'POST', form: { _csrf: token, name: 'Schrank 1' } });
check('doppelter Name wird abgelehnt', r.status === 302 && (await req('/lagerorte')).text.includes('gibt es schon'));

// Erfassungsmodus ist neu installiert an: Einbuchen steht oben, noch vor dem
// Bestand — sonst muss man am Handy weit scrollen. Zwei Wege: Sammelposten
// (ohne Nummer) und Einzelteil.
r = await req('/lager');
const einbuchenPos = r.text.indexOf('Sammelposten');
const bestandPos = r.text.indexOf('id="bestand"');
check('Einbuchen steht über dem Bestand', einbuchenPos > 0 && einbuchenPos < bestandPos, `${einbuchenPos} / ${bestandPos}`);
check('Sammelposten-Weg vorhanden', r.text.includes('Sammelposten einbuchen'));
check('Einzelteil-Weg vorhanden', r.text.includes('Einzelteil hinzufügen'));
check('offen, nicht eingeklappt', !r.text.includes('einbuchen-klapp'));

// Erfassungsmodus ausschalten: das Einbuchen klappt ein, der Bestand rückt nach oben.
r = await req('/lagerorte');
check('Schalter „Material erfassen“ auf der Lagerorte-Seite', r.text.includes('name="erfassen"') && r.text.includes('Material erfassen'));
token = await csrf('/lagerorte');
r = await req('/lagerorte/erfassen', { method: 'POST', form: { _csrf: token } }); // ohne Häkchen = aus
check('Umschalten führt zurück', r.status === 302 && r.location === '/lagerorte', `${r.status} ${r.location}`);

r = await req('/lager');
check('Einbuchen ist jetzt eingeklappt', r.text.includes('einbuchen-klapp'));
check('kein Sprunglink mehr nötig', !r.text.includes('↓ Bestand ansehen'));
check('Einbuchen bleibt erreichbar', r.text.includes('Sammelposten einbuchen'));
const bestandFrueher = r.text.indexOf('kacheln') > -1 ? r.text.indexOf('kacheln') : r.text.indexOf('teilliste');
const klappPos = r.text.indexOf('einbuchen-klapp');
// Das Formular selbst kommt zwar im Markup vor der Liste, aber nur als
// zugeklappter Kasten — die eigentliche Aufgabe (Bestand) ist sofort sichtbar.
check('Einbuchen weiter oben, aber nur eingeklappt', klappPos > 0);

// Wieder einschalten und prüfen, dass es hält.
token = await csrf('/lagerorte');
r = await req('/lagerorte/erfassen', { method: 'POST', form: { _csrf: token, erfassen: '1' } });
r = await req('/lager');
check('wieder offen nach dem Einschalten', !r.text.includes('einbuchen-klapp') && r.text.includes('id="bestand"'));

// Standard-Lagerort: neue Teile ohne gewähltes Ziel landen dort.
r = await req('/lagerorte');
check('Standard-Knopf je Lagerort', r.text.includes('/standard'));
token = await csrf('/lagerorte');
r = await req(`/lagerort/${schrank}/standard`, { method: 'POST', form: { _csrf: token } });
check('Standard-Lagerort gesetzt', r.status === 302 && r.location === '/lagerorte', `${r.status} ${r.location}`);
r = await req('/lagerorte');
check('Standard wird markiert', r.text.includes('chip-standard') || r.text.includes('★ Standard'));

// Ein Teil ganz ohne Ziel-Feld anlegen → muss im Standard-Lagerort landen.
token = await csrf('/lager');
r = await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', type_id: '3', note: 'Standardtest' }, // kein ziel
});
check('Anlage ohne Ziel angenommen', r.status === 302);
r = await req(`/lager?ort=${schrank}`);
check('Teil landete im Standard-Lagerort', r.text.includes('Standardtest'));

// "Lager ohne Ort" bleibt aber eine bewusste Wahl — der Standard greift da nicht.
token = await csrf('/lager');
await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: 'lager', type_id: '3', note: 'BewusstOhneOrt' },
});
r = await req('/lager?ort=ohne');
check('bewusst „ohne Ort“ bleibt ohne Ort', r.text.includes('BewusstOhneOrt'));

// Erneuter Klick hebt den Standard wieder auf.
token = await csrf('/lagerorte');
await req(`/lagerort/${schrank}/standard`, { method: 'POST', form: { _csrf: token } });
check('Standard wieder aufgehoben', !(await req('/lagerorte')).text.includes('chip-standard'));
// Danach zurücksetzen, damit die folgenden Abschnitte ohne Standard rechnen.

// 10 Jacken und 20 Paar Schuhe per Mengenangabe
token = await csrf('/lager');
r = await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '1', size: '176', anzahl: '10', condition: 'gut' },
});
check('10 Jacken auf einmal angelegt', r.status === 302);
r = await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '5', size: '38', anzahl: '20', condition: 'gut' },
});
check('20 Paar Schuhe auf einmal angelegt', r.status === 302);

r = await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '1', size: '170', anzahl: '5', inventory_no: 'X-1' },
});
check('Menge + Inventarnummer wird abgelehnt', (await req('/lager')).text.includes('bitte die Inventarnummer leer lassen'));

// Teile im Lager müssen bearbeitbar sein — sonst kommt man an Größe und
// Inventarnummer eines eingelagerten Teils nicht heran.
r = await req(`/lager?ort=${schrank}`);
const lagerTeilId = Number(r.text.match(/\/ausruestung\/(\d+)\/bearbeiten/)?.[1]);
check('Lagerzeilen haben ein Bearbeiten-Formular', !!lagerTeilId);
check('mit Feld für die Inventarnummer', r.text.includes('name="inventory_no"'));
token = await csrf(`/lager?ort=${schrank}`);
r = await req(`/ausruestung/${lagerTeilId}/bearbeiten`, {
  method: 'POST',
  form: { _csrf: token, zurueck: `/lager?ort=${schrank}`, type_id: '1', size: '176', inventory_no: 'IM-LAGER-1', condition: 'gut' },
});
check('Speichern führt zur gefilterten Ansicht zurück', r.status === 302 && r.location === `/lager?ort=${schrank}`, r.location);
r = await req(`/lager?ort=${schrank}`);
check('geänderte Inventarnummer ist gespeichert', r.text.includes('IM-LAGER-1'));

r = await req(`/lagerort/${schrank}`);
check('Lagerort zeigt 10 × Jacke', r.text.includes('10 ×') && r.text.includes('Jacke'));
check('Lagerort zeigt 20 × Schuhe', r.text.includes('20 ×') && r.text.includes('Schuhe'));
check('Lagerort zeigt Größen', r.text.includes('Gr. 176') && r.text.includes('Gr. 38'));

r = await req('/qr');
const tokenSchrank = r.text.match(/\/l\/([a-z2-9]{8,})/)?.[1];
check('QR-Seite enthält Lagerort-Etikett mit Token', !!tokenSchrank && r.text.includes('Lagerorte'));

const angemeldet = cookie;
cookie = '';
r = await req(`/l/${tokenSchrank}`);
check('Lagerort per QR-Token ohne Login lesbar', r.status === 200 && r.text.includes('Schrank 1'));
r = await req(`/lagerort/${schrank}`);
check('Lagerort über die laufende Nummer ist gesperrt', r.status === 302 && r.location === '/anmelden');
r = await req('/lagerorte');
check('Lagerort-Verwaltung ist gesperrt', r.status === 302 && r.location === '/anmelden');
cookie = angemeldet;

console.log('\n12) Barcode-Scan');
r = await req('/scannen?nr=HE-0042');
check('Scan einer eindeutigen Nummer springt zum Spint', r.status === 302 && r.location === `/spint/${boys01.id}`, r.location);
r = await req('/scannen?nr=gibtesnicht');
check('unbekannte Nummer landet auf der Suche', r.status === 302 && r.location.startsWith('/suche?q='), r.location);
r = await req('/scannen');
check('Scan-Seite ohne Nummer rendert', r.status === 200 && r.text.includes('Barcode scannen'));
r = await req('/vendor/html5-qrcode.min.js');
check('Barcode-Bibliothek wird lokal ausgeliefert', r.status === 200 && r.text.length > 10000, String(r.status));

console.log('\n13) Tauschen: passendes Stück im Lager');
// Max hat Jacke 164; im Schrank liegen Jacken 176.
const jacke = boys01.id;
r = await req(`/spint/${jacke}/bearbeiten`);
const jackenId = Number(r.text.match(/\/ausruestung\/(\d+)\/tauschen/)?.[1]);
check('Tausch-Aktion am Teil vorhanden', !!jackenId);

token = await csrf(`/ausruestung/${jackenId}/tauschen`);
r = await req(`/ausruestung/${jackenId}/tauschen`, {
  method: 'POST',
  form: { _csrf: token, to_size: '176', reason: 'zu klein' },
});
check('Lagertreffer wird gemeldet statt Aufgabe angelegt', r.status === 200 && r.text.includes('Passendes Stück ist im Lager'));
check('Fundort wird genannt', r.text.includes('Schrank 1'));

// Schritt zur Sicherheitsabfrage
token = await csrf(`/ausruestung/${jackenId}/tauschen`);
const fundFeld = { _csrf: token, size: '176', storage_id: String(schrank), condition: 'gut' };
r = await req(`/ausruestung/${jackenId}/tauschen/pruefen`, { method: 'POST', form: fundFeld });
check('Kontrollseite erscheint vor dem Tausch', r.status === 200 && r.text.includes('Kontrolle vor dem Tausch'));
check('Kontrolle fragt beide Teile ab', r.text.includes('alt_pruefung') && r.text.includes('neu_pruefung'));

// Falsche Nummer am alten Teil muss abgelehnt werden.
r = await req(`/ausruestung/${jackenId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fundFeld, alt_pruefung: '999999', neu_pruefung: 'NEU-1', verbleib: 'lager' },
});
check('falsche Nummer am alten Teil wird abgelehnt', r.status === 400 && r.text.includes('gehört nicht zum Teil aus dem Spint'));

// Richtige Nummer am alten Teil, Sammelposten ohne Nummer beim neuen Teil.
r = await req(`/ausruestung/${jackenId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fundFeld, alt_pruefung: 'JA-0815', neu_pruefung: 'NEU-176-A', verbleib: 'lager' },
});
check('Tausch nach Kontrolle führt zurück zum Spint', r.status === 302 && r.location === `/spint/${boys01.id}/bearbeiten`, r.location);

r = await req(`/spint/${boys01.id}`);
check('neue Jacke Gr. 176 liegt im Spint', r.text.includes('176'));
check('gescannte Nummer wurde dem Sammelposten zugewiesen', r.text.includes('NEU-176-A'));

// Die id des jetzt im Spint liegenden Teils fuer die naechsten Abschnitte.
r = await req(`/spint/${boys01.id}/bearbeiten`);
const ersatzId = idAusZeile(r.text, 'NEU-176-A');
check('getauschtes Teil im Spint auffindbar', !!ersatzId);

console.log('\n14) Tauschen: nichts im Lager → Aufgabe');
// Ab hier zählt die getauschte Jacke (Gr. 176), die jetzt in Max' Spint liegt —
// die alte 164er ist beim Tausch ins Lager gewandert.
token = await csrf(`/ausruestung/${ersatzId}/tauschen`);
r = await req(`/ausruestung/${ersatzId}/tauschen`, {
  method: 'POST',
  form: { _csrf: token, to_size: '52', reason: 'zu klein', note: 'wächst schnell' },
});
check('ohne Lagertreffer wird Aufgabe angelegt', r.status === 302 && r.location === '/aufgaben', r.location);

r = await req('/aufgaben');
check('Aufgabe erscheint im Tab', r.text.includes('52') && r.text.includes('wächst schnell'));
check('Aufgabe nennt das Mitglied', r.text.includes('Max Muster'));
check('Zähler in der Navigation', r.text.includes('zaehler'));

// Beim Einräumen soll oben stehen, was noch fehlt — nicht die Jacke, die
// längst hängt.
r = await req(`/spint/${boys01.id}/bearbeiten`);
const auswahl = r.text.split('<h3>Neues Teil eintragen</h3>')[1]?.split('</select>')[0] || '';
check('Auswahl trennt fehlende von vorhandenen Arten',
  auswahl.includes('optgroup label="fehlt noch"') && auswahl.includes('optgroup label="schon im Spint"'));
const gruppe = (name) => auswahl.match(new RegExp(`label="${name}">([\\s\\S]*?)</optgroup>`))?.[1] || '';
const fehltNoch = gruppe('fehlt noch');
const schonDa = gruppe('schon im Spint');
check('die vorhandene Jacke steht unten',
  !fehltNoch.includes('>Jacke<') && schonDa.includes('>Jacke<'),
  `oben: ${fehltNoch.replace(/\s+/g, ' ').slice(0, 80)}`);
check('eine fehlende Art steht oben', fehltNoch.includes('>Schuhe<'), fehltNoch.replace(/\s+/g, ' ').slice(0, 80));

// Am Teil selbst muss die offene Bestellung zu sehen sein — sonst bestellt der
// nächste Betreuer dasselbe noch einmal.
r = await req(`/spint/${boys01.id}/bearbeiten`);
check('offene Bestellung steht am Teil', r.text.includes('chip-offen') && r.text.includes('teilzeile-offen'));
// "zu klein" ist ein Tausch, kein Verlust — daher "Tausch angefragt".
check('mit Richtung der Bestellung', /Tausch angefragt: [^<]*→\s*52/.test(r.text.replace(/\s+/g, ' ')),
  'kein "→ 52" gefunden');
check('Knopf weist auf die Wiederholung hin', r.text.includes('Nochmal tauschen / bestellen'));

// Auch auf der Seite, die per QR-Code aufgerufen wird.
const spintToken = (await req('/qr')).text.match(/\/s\/([a-z2-9]{12})/)?.[1];
let merkeAnmeldung = cookie;
cookie = '';
r = await req('/s/' + spintToken);
check('auch ohne Anmeldung sichtbar', r.status === 200 && r.text.includes('chip-offen'), String(r.status));
cookie = merkeAnmeldung;

// Und wer es trotzdem noch einmal versucht, wird gewarnt.
r = await req(`/ausruestung/${ersatzId}/tauschen`);
check('Tausch-Formular warnt vor der Doppelbestellung', r.text.includes('Dafür läuft schon etwas'));
check('die Warnung nennt das Datum', /steht seit <strong>\d{2}\.\d{2}\.\d{4}/.test(r.text));

const aufgabeId = Number((await req('/aufgaben')).text.match(/\/aufgaben\/(\d+)\/erledigt/)?.[1]);
token = await csrf('/aufgaben');
r = await req(`/aufgaben/${aufgabeId}/erledigt`, { method: 'POST', form: { _csrf: token } });
check('Aufgabe abhakbar', r.status === 302);
r = await req('/aufgaben');
check('erledigte Aufgabe nicht mehr offen', !r.text.includes('wächst schnell'));
r = await req('/aufgaben?status=erledigt');
check('erledigte Aufgabe im Archiv', r.text.includes('wächst schnell'));

// Nach dem Abhaken muss der Hinweis am Teil wieder verschwinden, sonst traut
// ihm bald niemand mehr.
r = await req(`/spint/${boys01.id}/bearbeiten`);
check('erledigte Aufgabe verschwindet vom Teil', !r.text.includes('chip-offen'));
r = await req(`/ausruestung/${ersatzId}/tauschen`);
check('und das Formular warnt nicht mehr', !r.text.includes('Dafür läuft schon etwas'));

console.log('\n16) Kontrolle: Skip bei Verlust');
// Zweite Jacke Gr. 170 ins Lager, damit es etwas zu tauschen gibt.
token = await csrf('/lager');
await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '1', size: '170', anzahl: '2' },
});

const fund170 = { _csrf: token, size: '170', storage_id: String(schrank), condition: 'gut' };
r = await req(`/ausruestung/${ersatzId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fund170, alt_pruefung: '', neu_pruefung: 'NEU-170-A', verbleib: 'lager' },
});
check('ohne Eingabe am alten Teil wird abgelehnt', r.status === 400 && r.text.includes('Inventarnummer des alten Teils'));

r = await req(`/ausruestung/${ersatzId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fund170, alt_fehlt: '1', skip_grund: 'verloren', neu_pruefung: 'NEU-170-A', verbleib: 'lager' },
});
check('Skip-Knopf tauscht ohne Kontrolle des alten Teils', r.status === 302, String(r.status));
r = await req('/ausgemustert');
check('verlorenes Teil wurde ausgemustert', r.text.includes('NEU-176-A'));
r = await req('/verlauf');
check('Verlauf hält den übersprungenen Check fest', r.text.includes('ohne Kontrolle des alten Teils (verloren)'));

console.log('\n17) Kontrolle: Handschuhe über die Größe');
// Handschuhe (Art 4) führen keine Inventarnummer.
r = await req(`/spint/${boys01.id}/bearbeiten`);
token = await csrf(`/spint/${boys01.id}/bearbeiten`);
await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: `/spint/${boys01.id}/bearbeiten`, locker_id: String(boys01.id), type_id: '4', size: '7' },
});
await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '4', size: '8', anzahl: '3' },
});
r = await req(`/spint/${boys01.id}/bearbeiten`);
const handschuhId = idAusZeile(r.text, 'value="7"');
check('Handschuhe im Spint gefunden', !!handschuhId);

const fundH = { _csrf: token, size: '8', storage_id: String(schrank), condition: 'gut' };
r = await req(`/ausruestung/${handschuhId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fundH, alt_pruefung: '9', neu_pruefung: '8', verbleib: 'lager' },
});
check('falsche Größe am alten Teil wird abgelehnt', r.status === 400 && r.text.includes('passt nicht zum Teil aus dem Spint'));

r = await req(`/ausruestung/${handschuhId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fundH, alt_pruefung: '7', neu_pruefung: '9', verbleib: 'lager' },
});
check('falsche Größe am neuen Teil wird abgelehnt', r.status === 400 && r.text.includes('Größe des neuen Teils bestätigen'));

r = await req(`/ausruestung/${handschuhId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fundH, alt_pruefung: '7', neu_pruefung: '8', verbleib: 'lager' },
});
check('Handschuhtausch über Größe funktioniert', r.status === 302, String(r.status));
r = await req(`/spint/${boys01.id}`);
check('Handschuhe Gr. 8 liegen jetzt im Spint', /Handschuhe[\s\S]{0,200}>8</.test(r.text));

console.log('\n18) Kontrolle: fremde Nummer am neuen Teil');
// Genau ein Lagerteil in Gr. 158, und das hat eine Inventarnummer. Damit gibt es
// kein nummernloses Teil mehr, dem eine falsche Nummer zugewiesen werden könnte.
token = await csrf('/lager');
await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '1', size: '158', inventory_no: 'LAGER-158' },
});

r = await req(`/spint/${boys01.id}/bearbeiten`);
const jacke170 = idAusZeile(r.text, 'NEU-170-A');
const fund158 = { _csrf: token, size: '158', storage_id: String(schrank), condition: 'gut' };

r = await req(`/ausruestung/${jacke170}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fund158, alt_pruefung: 'NEU-170-A', neu_pruefung: 'FALSCHE-NUMMER', verbleib: 'lager' },
});
check('fremde Nummer am neuen Teil wird abgelehnt',
  r.status === 400 && r.text.includes('gehört zu keinem Teil an dieser Fundstelle'), String(r.status));

r = await req(`/ausruestung/${jacke170}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fund158, alt_pruefung: 'NEU-170-A', neu_pruefung: 'lager-158', verbleib: 'lager' },
});
check('richtige Nummer wird akzeptiert (Groß-/Kleinschreibung egal)', r.status === 302, String(r.status));

console.log('\n19) Inventarnummern sind eindeutig');
token = await csrf('/lager');
const neu = (form) => req('/ausruestung/neu', { method: 'POST', form: { _csrf: token, zurueck: '/lager', ziel: 'lager', ...form } });

await neu({ type_id: '1', size: '164', inventory_no: 'EINDEUTIG-1' });
r = await req('/lager?q=EINDEUTIG-1');
check('erste Jacke mit Nummer angelegt', r.text.includes('EINDEUTIG-1'));

// Genau der gemeldete Fall: zweite Jacke, gleiche Nummer.
await neu({ type_id: '1', size: '176', inventory_no: 'EINDEUTIG-1' });
r = await req('/lager?q=EINDEUTIG-1');
check('zweite Jacke mit gleicher Nummer wird abgelehnt', r.text.includes('schon vergeben'));
// Der Scan springt nur bei genau einem Treffer direkt zum Fundort — gäbe es die
// Nummer doppelt, landete er auf der Suche.
r = await req('/scannen?nr=EINDEUTIG-1');
check('die Nummer existiert weiterhin nur einmal', r.status === 302 && !r.location.startsWith('/suche'), r.location);

await neu({ type_id: '2', size: '164', inventory_no: 'eindeutig-1' });
r = await req('/lager?q=EINDEUTIG-1');
check('auch in anderer Schreibweise abgelehnt', r.text.includes('schon vergeben'));

// Die Meldung muss sagen, wo die Nummer schon steckt.
await neu({ type_id: '1', size: '170', inventory_no: 'JA-0815' });
r = await req('/lager');
check('Meldung nennt Art und Fundort', /schon vergeben[\s\S]{0,120}(Jacke|Spint)/.test(r.text));

// Mehrere Teile ohne Nummer bleiben erlaubt — sonst wäre der Sammelposten kaputt.
await neu({ type_id: '5', size: '41', anzahl: '5' });
r = await req('/lager?q=41');
check('Sammelposten ohne Nummer weiterhin möglich', r.status === 200 && !r.text.includes('schon vergeben'));

// Beim Bearbeiten darf man die eigene Nummer behalten, aber keine fremde nehmen.
r = await req('/lager?q=EINDEUTIG-1');
const eindeutigId = Number(r.text.match(/\/ausruestung\/(\d+)\/verschieben/)?.[1]);
token = await csrf('/lager');
r = await req(`/ausruestung/${eindeutigId}/bearbeiten`, {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', type_id: '1', size: '164', inventory_no: 'EINDEUTIG-1', condition: 'gut' },
});
r = await req('/lager?q=EINDEUTIG-1');
check('eigene Nummer beim Speichern behalten', !r.text.includes('schon vergeben') && r.text.includes('EINDEUTIG-1'));

r = await req(`/ausruestung/${eindeutigId}/bearbeiten`, {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', type_id: '1', size: '164', inventory_no: 'JA-0815', condition: 'gut' },
});
r = await req('/lager');
check('fremde Nummer beim Bearbeiten abgelehnt', r.text.includes('schon vergeben'));

console.log('\n20) Suche über mehrere Wörter');
// Ausgangslage: Jacke Gr. 176 mit Nummer NEU-176-A liegt in Max Musters Spint.
r = await req('/suche?q=Jacke');
check('ein Wort findet die Jacken', r.text.includes('Jacke'));

r = await req('/suche?q=Jacke%20176');
check('„Jacke 176“ findet die Jacke', r.text.includes('NEU-176-A') && !r.text.includes('Nichts gefunden'));

r = await req('/suche?q=176%20Jacke');
check('Reihenfolge der Wörter egal', r.text.includes('NEU-176-A'));

r = await req('/suche?q=JACKE%20176');
check('Groß-/Kleinschreibung egal', r.text.includes('NEU-176-A'));

r = await req('/suche?q=Jacke%20999');
check('unpassende Kombination findet nichts', r.text.includes('Nichts gefunden'));

r = await req('/suche?q=Hose%20176');
check('andere Art mit derselben Größe trennt sauber', !r.text.includes('NEU-176-A'));

// Teil über seinen Besitzer finden — der Helm liegt unverändert in Max' Spint.
r = await req('/suche?q=Helm%20Max');
check('Ausrüstung über den Besitzer findbar', r.text.includes('HE-0042'));
r = await req('/suche?q=Helm%20Lena');
check('fremder Besitzer findet den Helm nicht', !r.text.includes('HE-0042'));

// Mitglied mit umgedrehter Namensreihenfolge
r = await req('/suche?q=Muster%20Max');
check('Mitglied auch bei umgedrehtem Namen', r.text.includes('Max Muster'));

r = await req('/suche?q=%20%20');
check('nur Leerzeichen ergibt keinen Treffer', r.text.includes('Sucht gleichzeitig') || r.text.includes('Nichts gefunden'));

console.log('\n15) Größenschritte aus dem Katalog');
r = await req(`/ausruestung/${ersatzId}/tauschen`);
check('Vorschlag aus 176: eine Nummer größer = 44 (Übergang)', r.text.includes('>44 '));
check('Vorschlag aus 176: eine Nummer kleiner = 170', r.text.includes('>170 '));

// Schuhe haben eine eigene Reihe: 38 + 2 = 40
token = await csrf('/lager');
r = await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: 'lager', type_id: '5', size: '38', anzahl: '1' },
});
r = await req('/lager?q=38');
const schuhId = Number(r.text.match(/\/ausruestung\/(\d+)\/verschieben/)?.[1]);
r = await req(`/ausruestung/${schuhId}/tauschen`);
check('Schuh 38: zwei Nummern größer = 40', r.text.includes('>40 '));

console.log('\n21) Unbekannte Größe wird hinterfragt');
token = await csrf('/lager');
const anlegen = (form) =>
  req('/ausruestung/neu', { method: 'POST', form: { _csrf: token, zurueck: '/lager', ziel: 'lager', ...form } });

// Genau der gemeldete Fall: 162 gibt es nicht.
r = await anlegen({ type_id: '1', size: '162' });
check('162 führt zur Rückfrage', r.status === 200 && r.text.includes('Größe prüfen'));
check('Rückfrage schlägt 164 vor', r.text.includes('164 verwenden'));
check('Rückfrage bietet Beibehalten an', r.text.includes('162 trotzdem übernehmen'));
r = await req('/lager?q=162');
check('162 wurde noch nicht gespeichert', r.text.includes('Keine passenden Teile'));

// Vorschlag annehmen
r = await anlegen({ type_id: '1', size: '164' });
check('gültige Größe geht ohne Rückfrage durch', r.status === 302, String(r.status));

// Auf eigenen Wunsch trotzdem behalten
r = await anlegen({ type_id: '1', size: '162', groesse_ok: '1' });
check('mit Bestätigung wird 162 gespeichert', r.status === 302);
r = await req('/lager?q=162');
check('162 ist jetzt im Lager', r.text.includes('value="162"'));

// Handschuhe haben eine andere Reihe — 164 ist dort falsch.
r = await anlegen({ type_id: '4', size: '164' });
check('164 ist bei Handschuhen unbekannt', r.status === 200 && r.text.includes('Größe prüfen'));
check('Vorschlag für Handschuhe ist 12', r.text.includes('12 verwenden'));
r = await anlegen({ type_id: '4', size: '8' });
check('Handschuhgröße 8 geht durch', r.status === 302);

// Helm führt keine Größe -> keine Rückfrage
r = await anlegen({ type_id: '3', size: 'irgendwas', inventory_no: 'HELM-X' });
check('Art ohne Größenschema fragt nicht nach', r.status === 302, String(r.status));

// Auswahlliste im Formular
r = await req('/lager');
check('Auswahlliste für Kleidung vorhanden', r.text.includes('id="groessen-bekleidung"'));
check('Auswahlliste für Handschuhe vorhanden', r.text.includes('id="groessen-handschuh"'));
check('Arten tragen ihr Schema am Auswahlfeld', r.text.includes('data-schema="bekleidung"'));

console.log('\n22) Größen verwalten');
r = await req('/ausruestungsarten');
check('Schema je Art einstellbar', r.text.includes('name="size_scheme"'));
check('Größenlisten bearbeitbar', r.text.includes('werte_Körpergröße') && r.text.includes('116, 122'));
check('Übergang steht in der Reihe', /176,\s*$|176<\/|176"/.test(r.text) && r.text.includes('44, 46'));

token = await csrf('/ausruestungsarten');
r = await req('/groessen/handschuh/speichern', {
  method: 'POST',
  form: { _csrf: token, 'werte_Handschuhgröße': '7, 8, 9' },
});
check('Größenliste speicherbar', r.status === 302);
r = await anlegen({ type_id: '4', size: '6' });
check('entfernte Größe wird jetzt hinterfragt', r.status === 200 && r.text.includes('Größe prüfen'));

console.log('\n23) Barcode-Präfix je Art');
r = await req('/ausruestungsarten');
check('Verwaltung im Hauptmenü verlinkt', r.text.includes('href="/ausruestungsarten"') && r.text.includes('Arten &amp; Größen'));
check('Präfix-Feld vorhanden', r.text.includes('name="barcode_prefix"') && r.text.includes('name="barcode_digits"'));

// Wie im Gerätehaus: Jacken 112000 (3 Stellen), Helme KKJF.1202.
token = await csrf('/ausruestungsarten');
r = await req('/ausruestungsarten/1/bearbeiten', {
  method: 'POST',
  form: { _csrf: token, name: 'Jacke', has_size: '1', has_inventory: '1', size_scheme: 'bekleidung',
          barcode_prefix: '112000', barcode_digits: '3', sort_order: '10' },
});
check('Präfix für Jacke gespeichert', r.status === 302);
r = await req('/ausruestungsarten/3/bearbeiten', {
  method: 'POST',
  form: { _csrf: token, name: 'Helm', has_inventory: '1', barcode_prefix: 'KKJF.1202.', sort_order: '30' },
});
check('Präfix für Helm gespeichert', r.status === 302);
r = await req('/ausruestungsarten');
check('Präfixe erscheinen in der Verwaltung', r.text.includes('112000') && r.text.includes('KKJF.1202.'));

// Kurze Eingabe wird ergänzt
token = await csrf('/lager');
const mitNr = (form) =>
  req('/ausruestung/neu', { method: 'POST', form: { _csrf: token, zurueck: '/lager', ziel: 'lager', groesse_ok: '1', ...form } });

await mitNr({ type_id: '1', size: '164', inventory_no: '801' });
r = await req('/lager?q=112000801');
check('„801“ wird zu 112000801', r.text.includes('112000801'));

await mitNr({ type_id: '1', size: '164', inventory_no: '9' });
r = await req('/lager?q=112000009');
check('„9“ wird mit Nullen zu 112000009 aufgefüllt', r.text.includes('112000009'));

await mitNr({ type_id: '3', inventory_no: '77' });
r = await req('/lager?q=KKJF');
check('Helm „77“ wird zu KKJF.1202.77', r.text.includes('KKJF.1202.77'));

// Volle Nummern bleiben unverändert — so kommen sie vom Scanner
await mitNr({ type_id: '1', size: '164', inventory_no: '112000654' });
r = await req('/lager?q=112000654');
check('gescannte volle Nummer bleibt unverändert', r.text.includes('112000654'));
check('kein doppelter Präfix', !r.text.includes('112000112000654'));

// Art ohne Präfix bleibt unberührt
await mitNr({ type_id: '5', size: '38', inventory_no: '55' });
r = await req('/lager?q=55');
check('Art ohne Präfix lässt die Nummer stehen', r.text.includes('value="55"'));

// Kurze Nummer beim Scannen findet das Teil
r = await req('/scannen?nr=801');
check('Suche mit Kurznummer findet das Teil', r.status === 302 && !r.location.startsWith('/suche'), r.location);

console.log('\n24) Datensicherung über das Menü');
r = await req('/sicherung');
check('Sicherungsseite für den Jugendwart', r.status === 200 && r.text.includes('Datensicherung'));
check('zeigt den Bestand', r.text.includes('Mitglieder') && r.text.includes('Datenbank'));
check('erklärt das Zurückspielen', r.text.includes('systemctl stop jf-spinte'));

const SICHERUNGSPASSWORT = 'SicherungsPasswort123';
token = await csrf('/sicherung');
const holen = async (pw, pw2 = pw) => {
  const res3 = await fetch(BASE + '/sicherung/herunterladen', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token, passwort: pw, passwort2: pw2 }).toString(),
    redirect: 'manual',
  });
  return { status: res3.status, kopf: res3.headers.get('content-disposition') || '',
           rumpf: Buffer.from(await res3.arrayBuffer()) };
};

let dl = await holen('kurz');
check('zu kurzes Passwort wird abgelehnt', dl.status === 302, String(dl.status));
dl = await holen(SICHERUNGSPASSWORT, 'anderes123');
check('abweichende Wiederholung wird abgelehnt', dl.status === 302, String(dl.status));

dl = await holen(SICHERUNGSPASSWORT);
const kopf = dl.kopf;
const rumpf = dl.rumpf;
check('Sicherung wird geliefert', dl.status === 200 && rumpf.length > 1000, `${dl.status}, ${rumpf.length} Bytes`);
check('als .db.enc mit Datum im Namen', /spinte-\d{4}-\d{2}-\d{2}-\d{4}-s\d+\.db\.enc/.test(kopf), kopf);
check('mit der Schema-Fassung im Namen', /-s2\.db\.enc/.test(kopf), kopf);
check('ist verschlüsselt, nicht im Klartext', rumpf.subarray(0, 8).toString() === 'Salted__');
check('enthält keine lesbaren Namen', !rumpf.includes(Buffer.from('Max Muster')));

console.log('\n25) API');
r = await req('/api-zugaenge');
check('Verwaltung der Zugänge erreichbar', r.status === 200 && r.text.includes('API-Zugänge'));

r = await req('/api/v1/');
check('API ohne Token abgewiesen', r.status === 401, String(r.status));

token = await csrf('/api-zugaenge');
r = await req('/api-zugaenge/neu', { method: 'POST', form: { _csrf: token, name: 'Testsystem', scope: 'lesen' } });
r = await req('/api-zugaenge');
const apiToken = r.text.match(/id="frischerToken">(jfw_[a-f0-9]+)</)?.[1];
check('Token wird einmalig angezeigt', !!apiToken && apiToken.startsWith('jfw_'));
r = await req('/api-zugaenge');
check('und danach nicht mehr', !r.text.includes('frischerToken'));

const apiGet = async (pfad, tok = apiToken) => {
  const res2 = await fetch(BASE + pfad, { headers: tok ? { 'x-api-key': tok } : {} });
  const text = await res2.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* kein JSON */ }
  return { status: res2.status, json, text };
};

let a = await apiGet('/api/v1/');
check('Übersicht mit Token', a.status === 200 && Array.isArray(a.json?.endpunkte?.lesen));
a = await apiGet('/api/v1/', 'jfw_falsch');
check('falscher Token abgewiesen', a.status === 401);

a = await apiGet('/api/v1/status');
check('Status liefert Zahlen', a.status === 200 && typeof a.json.spinte === 'number');

a = await apiGet('/api/v1/spinte');
check('Spinte als JSON', a.status === 200 && a.json.daten.length > 0);
check('Spint nennt Nummer und QR-Pfad', /^\/s\/[a-z2-9]+$/.test(a.json.daten[0].qr_pfad || ''), a.json.daten[0]?.qr_pfad);

a = await apiGet('/api/v1/mitglieder');
check('Mitglieder als JSON', a.status === 200 && a.json.daten.some((x) => x.name === 'Max Muster'));

a = await apiGet('/api/v1/ausruestung?nummer=801');
check('Ausrüstung über die Kurznummer findbar', a.status === 200 && a.json.anzahl === 1, JSON.stringify(a.json?.anzahl));

a = await apiGet('/api/v1/arten');
check('Arten liefern Größen und Präfix', a.status === 200 && a.json.daten.some((t) => t.barcode_praefix === '112000'));

a = await apiGet('/api/v1/suche?q=Jacke%20176');
check('Suche über die API', a.status === 200 && Array.isArray(a.json.ausruestung));

a = await apiGet('/api/v1/aufgaben');
check('Aufgaben als JSON', a.status === 200 && Array.isArray(a.json.daten));

a = await apiGet('/api/v1/gibtesnicht');
check('unbekannter Endpunkt als JSON', a.status === 404 && !!a.json?.fehler);

console.log('\n26) API: Schreibrechte');
const schreibPost = async (pfad, body, tok) => {
  const res2 = await fetch(BASE + pfad, {
    method: 'POST',
    headers: { 'x-api-key': tok, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res2.status, json: await res2.json().catch(() => null) };
};

let w = await schreibPost('/api/v1/ausruestung', { art: 'Jacke', groesse: '164' }, apiToken);
check('Lese-Token darf nicht schreiben', w.status === 403, String(w.status));

token = await csrf('/api-zugaenge');
await req('/api-zugaenge/neu', { method: 'POST', form: { _csrf: token, name: 'Schreibsystem', scope: 'schreiben' } });
r = await req('/api-zugaenge');
const schreibToken = r.text.match(/id="frischerToken">(jfw_[a-f0-9]+)</)?.[1];
check('Schreib-Token angelegt', !!schreibToken);

w = await schreibPost('/api/v1/ausruestung', { art: 'Jacke', groesse: '164', anzahl: 3 }, schreibToken);
check('Ausrüstung über die API anlegen', w.status === 201 && w.json.angelegt === 3, JSON.stringify(w.json));

w = await schreibPost('/api/v1/ausruestung', { art: 'Jacke', groesse: '163' }, schreibToken);
check('unbekannte Größe wird auch über die API gemeldet', w.status === 409 && w.json.vorschlag === '164', JSON.stringify(w.json));

w = await schreibPost('/api/v1/ausruestung', { art: 'Jacke', groesse: '163', groesse_ok: true }, schreibToken);
check('mit groesse_ok trotzdem angelegt', w.status === 201);

w = await schreibPost('/api/v1/aufgaben', { art: 'Schuhe', nach_groesse: '42', notiz: 'per API bestellt' }, schreibToken);
check('Aufgabe über die API anlegen', w.status === 201 && w.json.status === 'offen', JSON.stringify(w.json));
const aufgabeApiId = w.json?.id;

const patch = await fetch(BASE + `/api/v1/aufgaben/${aufgabeApiId}`, {
  method: 'PATCH',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'erledigt' }),
});
const patchJson = await patch.json();
check('Aufgabe über die API abhaken', patch.status === 200 && patchJson.status === 'erledigt');

console.log('\n27) Stammdaten und Logo');
// 1x1-PNG, reicht als Nachweis, dass ein echtes Bild angenommen wird.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

r = await req('/stammdaten');
check('Stammdaten sind für den Jugendwart erreichbar', r.status === 200 && r.text.includes('Name der Wehr'), String(r.status));

const logoRoh = async (basis = BASE) => {
  const res5 = await fetch(basis + '/logo', { headers: cookie ? { cookie } : {} });
  return { status: res5.status, typ: res5.headers.get('content-type'), sniff: res5.headers.get('x-content-type-options'),
           laenge: (await res5.arrayBuffer()).byteLength };
};
check('ohne Logo antwortet /logo mit 404', (await logoRoh()).status === 404);

token = await csrf('/stammdaten');
r = await req('/stammdaten', {
  method: 'POST',
  form: { _csrf: token, organisation: 'Jugendfeuerwehr Ebertsheim', abteilung: 'Jugendfeuerwehr',
          slogan: 'Wir sind die Helden von morgen!' },
});
check('Stammdaten gespeichert', r.status === 302 && r.location === '/stammdaten', `${r.status} ${r.location}`);
r = await req('/');
check('Name der Wehr steht im Seitentitel', r.text.includes('· Jugendfeuerwehr Ebertsheim'));

// Logo hochladen — erst etwas, das kein Bild ist.
const logoHoch = async (inhalt, typ, name, tok) => {
  const fd = new FormData();
  fd.append('_csrf', tok);
  fd.append('logo', new Blob([inhalt], { type: typ }), name);
  const res5 = await fetch(BASE + '/stammdaten/logo', {
    method: 'POST', body: fd, headers: cookie ? { cookie } : {}, redirect: 'manual',
  });
  return { status: res5.status, location: res5.headers.get('location') };
};

token = await csrf('/stammdaten');
r = await logoHoch(Buffer.from('<html>kein Bild, sondern Text</html>'), 'image/png', 'boese.png', token);
check('Datei ohne Bildinhalt wird abgelehnt', r.status === 302, String(r.status));
r = await req('/stammdaten');
check('Hinweis auf das falsche Format', r.text.includes('keine Bilddatei'));
check('nichts gespeichert', (await logoRoh()).status === 404);

token = await csrf('/stammdaten');
r = await logoHoch(PNG, 'image/png', 'logo.png', token);
check('PNG wird angenommen', r.status === 302 && r.location === '/stammdaten', `${r.status} ${r.location}`);
const logoDa = await logoRoh();
check('Logo wird ausgeliefert', logoDa.status === 200 && logoDa.laenge === PNG.length, JSON.stringify(logoDa));
check('Logo wird als PNG ausgeliefert', logoDa.typ === 'image/png', String(logoDa.typ));
check('Browser darf den Typ nicht raten', logoDa.sniff === 'nosniff', String(logoDa.sniff));
r = await req('/stammdaten');
check('Vorschau zeigt das Logo', r.text.includes('logovorschau'));

// Leeres Feld faellt auf die Voreinstellung zurueck.
token = await csrf('/stammdaten');
await req('/stammdaten', { method: 'POST', form: { _csrf: token, organisation: '', abteilung: 'Jugendfeuerwehr', slogan: '' } });
r = await req('/stammdaten');
check('leerer Name fällt auf die Voreinstellung zurück', r.text.includes('value="Jugendfeuerwehr"'));
token = await csrf('/stammdaten');
await req('/stammdaten', {
  method: 'POST',
  form: { _csrf: token, organisation: 'Jugendfeuerwehr Ebertsheim', abteilung: 'Jugendfeuerwehr',
          slogan: 'Wir sind die Helden von morgen!' },
});

// Ohne Anmeldung: Stammdaten zu, Logo offen (es steht auf der QR-Spintseite).
let merkeCookie = cookie;
cookie = '';
r = await req('/stammdaten');
check('Stammdaten ohne Anmeldung gesperrt', r.status === 302 && r.location === '/anmelden', `${r.status} ${r.location}`);
check('Logo ist auch ohne Anmeldung sichtbar', (await logoRoh()).status === 200);
cookie = merkeCookie;

a = await apiGet('/api/v1/stammdaten');
check('Stammdaten über die API lesbar', a.status === 200 && a.json.organisation === 'Jugendfeuerwehr Ebertsheim', String(a.status));
check('API meldet das Logo', a.json.logo?.vorhanden === true);

const patchLesen = await fetch(BASE + '/api/v1/stammdaten', {
  method: 'PATCH',
  headers: { 'x-api-key': apiToken, 'content-type': 'application/json' },
  body: JSON.stringify({ slogan: 'geht nicht' }),
});
check('Lesezugang darf Stammdaten nicht ändern', patchLesen.status === 403, String(patchLesen.status));

const patchFalsch = await fetch(BASE + '/api/v1/stammdaten', {
  method: 'PATCH',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({ farbe: 'rot' }),
});
check('unbekanntes Feld wird abgelehnt', patchFalsch.status === 400, String(patchFalsch.status));

const patchOk = await fetch(BASE + '/api/v1/stammdaten', {
  method: 'PATCH',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({ slogan: 'Wir sind die Helden von morgen!' }),
});
check('Schreibzugang ändert die Stammdaten', patchOk.status === 200, String(patchOk.status));

console.log('\n28) A4-Etikett für den Spint');
r = await req('/etiketten');
const karten = (r.text.match(/class="a4"/g) || []).length;
const spinteGesamt = (await req('/')).text.match(/href="\/spint\/\d+"/g)?.length;
check('Etikettenseite wird ausgeliefert', r.status === 200 && karten > 0, `${r.status}, ${karten} Karten`);
check('eine Karte je Spint', karten === spinteGesamt, `${karten} von ${spinteGesamt}`);
check('eigener Druck-Stil ist eingebunden', r.text.includes('/static/etikett.css'));
check('Name der Wehr steht auf dem Blatt', r.text.includes('Jugendfeuerwehr Ebertsheim'));
check('Abteilung hebt sich von der Kinderfeuerwehr ab', r.text.includes('a4-abteilung'));
check('Hinweis zum QR-Code', r.text.includes('Was ist hier drin?'));
check('Logo ist eingebunden', r.text.includes('src="/logo?v='));

// Voreinstellung: zwei Etiketten je Seite — das passte in der Praxis an den
// Spinten. Die Karten stecken in Blatt-Abschnitten, einer je Druckseite.
check('Voreinstellung sind zwei je Seite', r.text.includes('data-pro-seite="2"'));
check('Auswahl der Anzahl vorhanden', r.text.includes('name="pro"'));
check('hochkant bei zwei je Seite', r.text.includes('size: A4 portrait'));
const blattZahl = (t) => (t.match(/class="blatt"/g) || []).length;
check('zwei Karten je Blatt', blattZahl(r.text) === Math.ceil(karten / 2), `${blattZahl(r.text)} Blätter für ${karten} Karten`);

r = await req('/etiketten?pro=4');
check('vier je Seite umschaltbar', r.text.includes('data-pro-seite="4"'));
check('vier Karten je Blatt', blattZahl(r.text) === Math.ceil(karten / 4), `${blattZahl(r.text)} Blätter`);

r = await req('/etiketten?pro=1');
check('eins je Seite umschaltbar', r.text.includes('data-pro-seite="1"'));
check('quer bei einem je Seite', r.text.includes('size: A4 landscape'));
check('ein Blatt je Karte', blattZahl(r.text) === karten, `${blattZahl(r.text)} Blätter`);

// Unsinnige Angaben fallen auf die Voreinstellung zurück, statt zu scheitern.
r = await req('/etiketten?pro=7');
check('ungültige Anzahl fällt auf zwei zurück', r.text.includes('data-pro-seite="2"'));
r = await req('/etiketten');
// Der Link steht nicht im Klartext auf dem Blatt, er steckt im QR-Bild. Also
// denselben Code noch einmal erzeugen und vergleichen — das beweist, dass der
// Etikett-QR auf die Token-Adresse zeigt und nicht auf die interne Nummer.
const qrSeite = await req('/qr');
const tokenUrl = qrSeite.text.match(/>(http:\/\/[^<]*\/s\/[a-z2-9]{12})</)?.[1];
const { createRequire: cr } = await import('node:module');
const QRCodeLib = cr(path.join(WURZEL, 'package.json'))('qrcode');
const erwartetesSvg = await QRCodeLib.toString(tokenUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'Q' });
check('QR-Code trägt den Token-Link', !!tokenUrl && r.text.includes(erwartetesSvg), String(tokenUrl));
check('Blatt trägt die Spintnummer', r.text.includes('a4-spint'));

r = await req('/etiketten?belegt=1');
const nurBelegt = (r.text.match(/class="a4"/g) || []).length;
check('Filter „nur belegte Spinte“ wirkt', nurBelegt > 0 && nurBelegt <= karten, `${nurBelegt} von ${karten}`);
check('kein freier Spint mehr dabei', !r.text.includes('a4-name frei'));

const einSpint = Number((await req('/')).text.match(/href="\/spint\/(\d+)"/)?.[1]);
r = await req('/etikett/' + einSpint);
check('einzelnes Etikett', r.status === 200 && (r.text.match(/class="a4"/g) || []).length === 1, String(r.status));
const groesse = (html) => Number(html.match(/a4-name[^"]*" style="font-size: (\d+)pt/)?.[1]);
check('Schriftgröße ist gesetzt', groesse(r.text) >= 24 && groesse(r.text) <= 96, String(groesse(r.text)));

// Ein langer Name muss kleiner gesetzt werden als ein kurzer, sonst laeuft er
// aus der Spalte.
token = await csrf('/mitglieder');
await req('/mitglieder/neu', { method: 'POST', form: { _csrf: token, name: 'Maximilian Schmidtberger', gender: 'm' } });
const langId = Number((await req('/mitglieder')).text.match(/\/mitglieder\/(\d+)\/bearbeiten/g)?.pop()?.match(/(\d+)/)?.[1]);
const langSpint = await createLocker({ code: 'ET-LANG', area_id: (await areaMap())['Umkleide Jungs'] || '' });
token = await csrf(`/spint/${langSpint.id}/bearbeiten`);
await req(`/spint/${langSpint.id}/bearbeiten`, {
  method: 'POST',
  form: { _csrf: token, code: 'ET-LANG', member_id: String(langId), label: '', location: '', note: '' },
});
const langBlatt = await req('/etikett/' + langSpint.id);
check('langer Name wird kleiner gesetzt', groesse(langBlatt.text) < groesse(r.text),
  `${groesse(langBlatt.text)}pt vs ${groesse(r.text)}pt`);

r = await req('/etikett/999999');
check('unbekannter Spint gibt 404', r.status === 404, String(r.status));

merkeCookie = cookie;
cookie = '';
r = await req('/etiketten');
check('Etiketten ohne Anmeldung gesperrt', r.status === 302 && r.location === '/anmelden', `${r.status} ${r.location}`);
cookie = merkeCookie;

console.log('\n29) Sicherung über die API');
const ohnePw = await fetch(BASE + '/api/v1/sicherung', { headers: { 'x-api-key': apiToken } });
check('API-Sicherung ohne Passwort abgelehnt', ohnePw.status === 400, String(ohnePw.status));

const sic = await fetch(BASE + '/api/v1/sicherung', {
  headers: { 'x-api-key': apiToken, 'x-sicherung-passwort': SICHERUNGSPASSWORT },
});
const sicRumpf = Buffer.from(await sic.arrayBuffer());
check('Sicherung über die API', sic.status === 200 && sicRumpf.subarray(0, 8).toString() === 'Salted__');
check('Sicherung ist vollständig', sicRumpf.length > 20000, `${sicRumpf.length} Bytes`);

// Der Abzug muss lesbar und inhaltlich vollstaendig sein.
const { mkdtempSync: mkT } = await import('node:fs');
const pruefOrdner = mkT(path.join(tmpdir(), 'jf-sicherung-pruef-'));
const pruefDatei = path.join(pruefOrdner, 'kopie.db');
const cryptoMod = await import('node:crypto');
const salz = sicRumpf.subarray(8, 16);
const abgeleitet = cryptoMod.pbkdf2Sync(SICHERUNGSPASSWORT, salz, 10000, 48, 'sha256');
const decipher = cryptoMod.createDecipheriv('aes-256-cbc', abgeleitet.subarray(0, 32), abgeleitet.subarray(32, 48));
const klar = Buffer.concat([decipher.update(sicRumpf.subarray(16)), decipher.final()]);
check('entschlüsselt ergibt eine SQLite-Datei', klar.subarray(0, 15).toString() === 'SQLite format 3');
writeFileSync(pruefDatei, klar);
const { createRequire } = await import('node:module');
const req2 = createRequire(path.join(WURZEL, 'package.json'));
const DB = req2('better-sqlite3');
const kopie = new DB(pruefDatei, { readonly: true });
const zahl = (t) => kopie.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
check('Sicherung enthält die Mitglieder', zahl('members') >= 2, String(zahl('members')));
check('Sicherung enthält die Spinte', zahl('lockers') >= 2, String(zahl('lockers')));
check('Sicherung enthält die Ausrüstung', zahl('equipment') > 10, String(zahl('equipment')));
kopie.close();
rmSync(pruefOrdner, { recursive: true, force: true });

// Gesperrter Zugang kommt nicht mehr rein
token = await csrf('/api-zugaenge');
const tokenId = (await req('/api-zugaenge')).text.match(/\/api-zugaenge\/(\d+)\/status/)?.[1];
await req(`/api-zugaenge/${tokenId}/status`, { method: 'POST', form: { _csrf: token } });
a = await apiGet('/api/v1/status', schreibToken);
check('gesperrter Zugang wird abgewiesen', a.status === 401, String(a.status));

console.log('\n30) API: Arten und Größen pflegen');
// Der vorige Abschnitt hat den Schreib-Zugang gesperrt — hier wieder freigeben.
token = await csrf('/api-zugaenge');
await req(`/api-zugaenge/${tokenId}/status`, { method: 'POST', form: { _csrf: token } });
a = await apiGet('/api/v1/status', schreibToken);
check('entsperrter Zugang funktioniert wieder', a.status === 200, String(a.status));

a = await apiGet('/api/v1/groessen');
check('Größenschemata über die API lesbar', a.status === 200 && a.json.daten.some((s) => s.schema === 'bekleidung'));

w = await schreibPost('/api/v1/arten', { name: 'Nomex-Haube', fuehrt_groesse: false, barcode_praefix: 'NH-' }, schreibToken);
check('Art über die API anlegen', w.status === 201 && !!w.json.id, JSON.stringify(w.json));
const artApiId = w.json?.id;

w = await schreibPost('/api/v1/arten', { name: 'Nomex-Haube' }, schreibToken);
check('doppelte Art wird abgelehnt', w.status === 409);

w = await schreibPost('/api/v1/arten', { name: 'Kaputt', groessenschema: 'gibtsnicht' }, schreibToken);
check('unbekanntes Größenschema wird abgelehnt', w.status === 400 && Array.isArray(w.json.bekannt));

const artPatch = await fetch(BASE + `/api/v1/arten/${artApiId}`, {
  method: 'PATCH',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({ groessenschema: 'handschuh', barcode_stellen: 2 }),
});
const artJson = await artPatch.json();
check('Art über die API ändern', artPatch.status === 200 && artJson.size_scheme === 'handschuh', JSON.stringify(artJson));
check('Größen folgen dem neuen Schema', Array.isArray(artJson.groessen) && artJson.groessen.includes('8'));

// Der Präfix wirkt sofort beim Anlegen über die API.
w = await schreibPost('/api/v1/ausruestung', { art: 'Nomex-Haube', inventarnummer: '7' }, schreibToken);
check('neue Art übernimmt den Präfix', w.status === 201);
a = await apiGet('/api/v1/ausruestung?nummer=NH-07');
check('„7“ wurde zu NH-07 ergänzt', a.json.anzahl === 1, JSON.stringify(a.json.anzahl));

// Größenreihe ersetzen
const putGr = await fetch(BASE + '/api/v1/groessen/handschuh', {
  method: 'PUT',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({ gruppen: [{ gruppe: 'Handschuhgröße', groessen: ['7', '8', '9', '10'] }] }),
});
const putJson = await putGr.json();
check('Größenreihe über die API ersetzen', putGr.status === 200 && putJson.anzahl === 4, JSON.stringify(putJson));

// Neues Schema anlegen — noetig, wenn zwei Arten verschiedene Reihen haben.
const neuesSchema = await fetch(BASE + '/api/v1/groessen', {
  method: 'POST',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({
    schema: 'jacke-test', bezeichnung: 'Jacke (Doppelgrößen)',
    gruppen: [{ gruppe: 'Körpergröße', groessen: ['122/128', '134/140', '146/152'] },
              { gruppe: 'Konfektion', groessen: ['44', '46'] }],
  }),
});
const schemaJson = await neuesSchema.json();
check('Größenschema über die API anlegen', neuesSchema.status === 201 && schemaJson.anzahl === 5, JSON.stringify(schemaJson));

const nochmal = await fetch(BASE + '/api/v1/groessen', {
  method: 'POST', headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({ schema: 'jacke-test', gruppen: [{ groessen: ['1'] }] }),
});
check('doppeltes Schema wird abgelehnt', nochmal.status === 409);

const krummerName = await fetch(BASE + '/api/v1/groessen', {
  method: 'POST', headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({ schema: 'Jacke Test!', gruppen: [{ groessen: ['1'] }] }),
});
check('ungültiger Kurzname wird abgelehnt', krummerName.status === 400);

// Doppelgrößen müssen als Größe durchgehen und die Schrittfolge bestimmen.
w = await schreibPost('/api/v1/arten', { name: 'Testjacke', groessenschema: 'jacke-test' }, schreibToken);
const testJackeId = w.json?.id;
check('Art mit dem neuen Schema angelegt', w.status === 201 && !!testJackeId);

w = await schreibPost('/api/v1/ausruestung', { art: 'Testjacke', groesse: '146/152' }, schreibToken);
check('Doppelgröße wird als gültig anerkannt', w.status === 201, JSON.stringify(w.json));

w = await schreibPost('/api/v1/ausruestung', { art: 'Testjacke', groesse: '150' }, schreibToken);
check('Größe außerhalb der Reihe wird hinterfragt', w.status === 409 && !!w.json.vorschlag, JSON.stringify(w.json));

// Nach 146/152 folgt die 44 — der Übergang bleibt auch bei Doppelgrößen erhalten.
a = await apiGet('/api/v1/arten');
const tj = a.json.daten.find((t) => t.name === 'Testjacke');
check('Reihenfolge im Schema bleibt erhalten',
  JSON.stringify(tj.groessen) === JSON.stringify(['122/128', '134/140', '146/152', '44', '46']),
  JSON.stringify(tj.groessen));

const schemaWeg = await fetch(BASE + '/api/v1/groessen/jacke-test', {
  method: 'DELETE', headers: { 'x-api-key': schreibToken },
});
check('benutztes Schema lässt sich nicht löschen', schemaWeg.status === 409, String(schemaWeg.status));

const putDoppelt = await fetch(BASE + '/api/v1/groessen/handschuh', {
  method: 'PUT',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: JSON.stringify({ gruppen: [{ gruppe: 'Handschuhgröße', groessen: ['7', '7'] }] }),
});
check('doppelte Größe wird abgelehnt', putDoppelt.status === 400);

a = await apiGet('/api/v1/arten');
check('Änderung wirkt sich aus', a.json.daten.find((t) => t.name === 'Nomex-Haube')?.groessen.length === 4);

const artWeg = await fetch(BASE + `/api/v1/arten/${artApiId}`, {
  method: 'DELETE',
  headers: { 'x-api-key': schreibToken },
});
check('benutzte Art lässt sich nicht löschen', artWeg.status === 409, String(artWeg.status));

console.log('\n30b) API: kaputte Umlaute werden abgewiesen');
// Genau der Fehler, der die Größenschemata einmal zerlegt hat: das aufrufende
// Programm schickt "ö" als einzelnes Windows-1252-Byte (0xF6). Beim Dekodieren
// wird daraus U+FFFD, und das Byte ist unwiederbringlich weg. Also ablehnen,
// statt es stillschweigend zu speichern.
const kaputt = Buffer.concat([
  Buffer.from('{"schema":"pruef","bezeichnung":"Gr'),
  Buffer.from([0xf6]), // "ö" in Windows-1252 — kein gültiges UTF-8
  Buffer.from('sse","gruppen":[{"gruppe":"Test","groessen":["1"]}]}'),
]);
const umlautFehler = await fetch(BASE + '/api/v1/groessen', {
  method: 'POST',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: kaputt,
});
const umlautAntwort = await umlautFehler.json().catch(() => ({}));
check('kaputte Kodierung wird abgelehnt', umlautFehler.status === 400, String(umlautFehler.status));
check('die Meldung nennt das Feld', /bezeichnung/.test(umlautAntwort.fehler || ''), umlautAntwort.fehler);
check('und erklärt, was zu tun ist', /UTF-8/.test(umlautAntwort.hinweis || ''), umlautAntwort.hinweis);

a = await apiGet('/api/v1/groessen');
check('nichts davon wurde angelegt', !a.json.daten.some((s) => s.schema === 'pruef'));

// Richtig kodiert muss es dagegen durchgehen — auch als \u-Escape.
const umlautOk = await fetch(BASE + '/api/v1/groessen', {
  method: 'POST',
  headers: { 'x-api-key': schreibToken, 'content-type': 'application/json' },
  body: '{"schema":"pruef","bezeichnung":"Gr\\u00f6\\u00dfe","gruppen":[{"gruppe":"K\\u00f6rpergr\\u00f6\\u00dfe","groessen":["1"]}]}',
});
check('sauberes UTF-8 geht durch', umlautOk.status === 201 || umlautOk.status === 200, String(umlautOk.status));
a = await apiGet('/api/v1/groessen');
const geprueft = a.json.daten.find((s) => s.schema === 'pruef');
check('Umlaute kommen heil an', geprueft?.bezeichnung === 'Größe', geprueft?.bezeichnung);
check('auch in der Gruppe', geprueft?.gruppen?.[0]?.gruppe === 'Körpergröße', geprueft?.gruppen?.[0]?.gruppe);

await fetch(BASE + '/api/v1/groessen/pruef', { method: 'DELETE', headers: { 'x-api-key': schreibToken } });

console.log('\n30d) Teile ohne Größe finden');
// Handschuhe ohne Etikett: die Größe bleibt leer statt „o.E“, und das Teil
// lässt sich gezielt wiederfinden, um die Größe nachzutragen.
token = await csrf('/lager');
await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '4', note: 'ohne Etikett' }, // keine size
});
r = await req('/lager');
check('Hinweis auf Teile ohne Größe', r.text.includes('ohne Größe') || r.text.includes('keine Größe'));
check('„Größe fehlt“ wird markiert', r.text.includes('chip-fehlt'));
r = await req('/lager?groesse=fehlt');
check('Filter zeigt nur Teile ohne Größe', r.text.includes('ohne Etikett') && r.text.includes('chip-fehlt'));
check('ein Teil mit Größe taucht dort nicht auf', !/152\/158/.test(r.text));
// Größe nachtragen → verschwindet aus der Liste.
const ohneId = Number(r.text.match(/\/ausruestung\/(\d+)\/bearbeiten/)?.[1]);
token = await csrf('/lager');
await req(`/ausruestung/${ohneId}/bearbeiten`, {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', type_id: '4', size: '8', condition: 'gut', note: 'ohne Etikett' },
});
r = await req('/lager?groesse=fehlt');
check('nach dem Nachtragen nicht mehr in der Liste', !r.text.includes('ohne Etikett'));

console.log('\n30e) Anwesenheit');
token = await csrf('/anwesenheit');
r = await req('/anwesenheit/neu', { method: 'POST', form: { _csrf: token, datum: '2026-08-04', thema: 'Löschangriff' } });
const terminId = Number((r.location || '').match(/\/anwesenheit\/(\d+)/)?.[1]);
check('Termin angelegt', r.status === 302 && !!terminId, `${r.status} ${r.location}`);

r = await req(`/anwesenheit/${terminId}`);
check('Liste zeigt die Mitglieder', r.text.includes('Max Muster') && r.text.includes('anwesend-offen'));
check('Thema steht dabei', r.text.includes('Löschangriff'));

// Alle auf "da", dann einen durchtippen.
token = await csrf(`/anwesenheit/${terminId}`);
r = await req(`/anwesenheit/${terminId}/alle`, { method: 'POST', form: { _csrf: token, status: 'da' } });
check('alle auf „da“ gesetzt', r.status === 302);
r = await req(`/anwesenheit/${terminId}`);
check('Status ist da', r.text.includes('anwesend-da'));

const maxId = Number((await req('/mitglieder')).text.match(/\/mitglieder\/(\d+)\/bearbeiten/)?.[1]);
token = await csrf(`/anwesenheit/${terminId}`);
r = await req(`/anwesenheit/${terminId}/tippen/${maxId}`, { method: 'POST', form: { _csrf: token } });
check('Antippen wechselt den Status', r.status === 302);
r = await req(`/anwesenheit/${terminId}`);
check('jetzt entschuldigt', r.text.includes('anwesend-entschuldigt'));

// Zwei Betreuer gleichzeitig: B sieht noch den alten Stand und tippt dasselbe,
// was A schon gesetzt hat. Weil der Knopf den Zielzustand mitschickt, ist das
// wirkungslos — und macht nicht versehentlich "entschuldigt" daraus.
const zweitesKind = Number((await req('/mitglieder')).text.match(/\/mitglieder\/(\d+)\/bearbeiten/g)?.[1]?.match(/(\d+)/)?.[1]);
token = await csrf(`/anwesenheit/${terminId}`);
await req(`/anwesenheit/${terminId}/tippen/${zweitesKind}`, { method: 'POST', form: { _csrf: token, ziel: 'da' } });
await req(`/anwesenheit/${terminId}/tippen/${zweitesKind}`, { method: 'POST', form: { _csrf: token, ziel: 'da' } });
r = await req(`/anwesenheit/${terminId}`);
const zeileZwei = r.text.split(`kind-${zweitesKind}`)[1]?.slice(0, 400) || '';
check('gleicher Tipp von zwei Seiten bleibt „da“', /anwesend-da/.test(zeileZwei), zeileZwei.slice(0, 120));

// Ohne Zielzustand (alte Seite aus dem Zwischenspeicher) wird weitergeschaltet.
token = await csrf(`/anwesenheit/${terminId}`);
await req(`/anwesenheit/${terminId}/tippen/${zweitesKind}`, { method: 'POST', form: { _csrf: token } });
r = await req(`/anwesenheit/${terminId}`);
check('ohne Ziel schaltet es weiter', /anwesend-entschuldigt/.test(r.text.split(`kind-${zweitesKind}`)[1]?.slice(0, 400) || ''));

// Der Knopf trägt den Zielzustand, und die Seite nennt ihren Stand.
r = await req(`/anwesenheit/${terminId}`);
check('Knopf trägt den Zielzustand', /name="ziel" value="(da|entschuldigt|fehlt|)"/.test(r.text));
check('Stand wird genannt', r.text.includes('data-stand'));

r = await req('/anwesenheit/quoten');
check('Quoten-Seite', r.status === 200 && r.text.includes('quote-balken'), String(r.status));

// Steht schon ein Termin, führt /anwesenheit direkt dorthin.
r = await req('/anwesenheit');
check('Anwesenheit springt zum letzten Termin', r.status === 302 && r.location === `/anwesenheit/${terminId}`, r.location);

// Dasselbe Datum zweimal ergibt keinen zweiten Termin.
token = await csrf(`/anwesenheit/${terminId}`);
r = await req('/anwesenheit/neu', { method: 'POST', form: { _csrf: token, datum: '2026-08-04' } });
check('kein doppelter Termin je Datum', r.location === `/anwesenheit/${terminId}`, r.location);

console.log('\n30f) Einschätzung — verdeckt und ohne Rangliste');
r = await req('/einschaetzung');
check('Werte sind zunächst verdeckt', r.status === 200 && !r.text.includes('name="erfahrung"'), String(r.status));
check('Warnung, nicht vor den Kindern zu öffnen', r.text.includes('Nicht vor den Kindern'));
r = await req('/einschaetzung?zeigen=1');
check('nach Klick sichtbar', r.text.includes('name="erfahrung"') && r.text.includes('name="anleiten"'));
check('kein Summenfeld je Kind', !/>Gesamt</.test(r.text) && !/>Summe</.test(r.text));
// Das eigentliche Mittel gegen die Rangliste: die Liste ist alphabetisch und
// nicht nach Werten sortierbar.
const namenAufSeite = [...r.text.matchAll(/class="einschaetzung-name">([^<]+)/g)].map((x) => x[1].trim());
const alphabetisch = [...namenAufSeite].sort((x, y) => x.localeCompare(y, 'de'));
check('alphabetisch statt nach Werten', namenAufSeite.length > 1 && namenAufSeite.join('|') === alphabetisch.join('|'),
  namenAufSeite.join(', '));

// Ein Klick je Wert: es kommt nur das eine Feld mit, die anderen bleiben stehen.
token = await csrf('/einschaetzung?zeigen=1');
r = await req(`/einschaetzung/${maxId}`, { method: 'POST', form: { _csrf: token, erfahrung: '5' } });
check('ein Klick setzt den Wert', r.status === 302 && (r.location || '').includes(`#kind-${maxId}`), r.location);
r = await req('/einschaetzung?zeigen=1');
check('Wert ist gesetzt und markiert', new RegExp(`name="erfahrung" value="5"[^>]*class="stufe stufe-an"`).test(r.text));
check('kein Speichern-Knopf mehr', !/>Speichern</.test(r.text.split('id="eignung"')[0]));

token = await csrf('/einschaetzung?zeigen=1');
await req(`/einschaetzung/${maxId}`, { method: 'POST', form: { _csrf: token, anleiten: '4' } });
r = await req('/einschaetzung?zeigen=1');
check('die anderen Merkmale bleiben stehen', new RegExp(`name="erfahrung" value="5"[^>]*class="stufe stufe-an"`).test(r.text));
r = await req('/verlauf');
check('Verlauf nennt die Änderung', r.text.includes('Einschätzung') || r.text.includes('einschaetzung'));
check('aber nicht die Werte', !/erfahrung.*5.*zupacken/i.test(r.text));

// Eignung und Trennwunsch
token = await csrf('/einschaetzung?zeigen=1');
r = await req(`/einschaetzung/${maxId}/eignung`, { method: 'POST', form: { _csrf: token, funktion: 'gruppenfuehrer', stufe: 'kann' } });
check('Eignung gesetzt', r.status === 302);
r = await req('/einschaetzung?zeigen=1');
check('Eignung wird angezeigt', /value="kann"[^>]*class="stufe stufe-an"/.test(r.text));
// Maschinist braucht in der JFW keine Eignung — der Platz ist der Schnupperplatz.
check('kein Maschinist bei den Eignungen', !/name="funktion" value="maschinist"/.test(r.text));

console.log('\n30g) Einteilung mit Funktionen');
token = await csrf('/einschaetzung?zeigen=1');
await req(`/anwesenheit/${terminId}/alle`, { method: 'POST', form: { _csrf: await csrf(`/anwesenheit/${terminId}`) , status: 'da' } });
r = await req(`/einteilung?termin=${terminId}&bilden=1&aufstellung=trupp&anzahl=2`);
check('Einteilung wird gebildet', r.status === 200 && r.text.includes('funktion'), String(r.status));
check('Funktionskürzel stehen dabei', />AF<|>AM<|>WM</.test(r.text));
check('Erklärung, was mitspielt', r.text.includes('einzeln') && r.text.includes('Führungsfunktionen'));

// Ohne "bilden" wird nichts gewürfelt — sonst ändert sich die Einteilung
// bei jedem Neuladen unter den Händen.
r = await req(`/einteilung?termin=${terminId}`);
check('ohne Knopfdruck keine neue Einteilung', !r.text.includes('Diese Einteilung übernehmen'));

console.log('\n30g2) Zwei Betreuer teilen gleichzeitig ein');
// Beide Handys erzeugen je einen Vorschlag. Speichert das zweite nach dem
// ersten, darf es die fremde Einteilung nicht stillschweigend ersetzen.
const einteilungsSeite = async () => {
  const seite = await req(`/einteilung?termin=${terminId}&bilden=1&aufstellung=trupp&anzahl=2`);
  const entschaerfen = (t) => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#34;/g, '"');
  return {
    teams: entschaerfen(seite.text.match(/name="teams" value="([^"]*)"/)[1]),
    stand: seite.text.match(/name="stand" value="([^"]*)"/)[1],
    token: seite.text.match(/name="_csrf" value="([^"]+)"/)[1],
  };
};

const handyA = await einteilungsSeite();
const handyB = await einteilungsSeite();
check('beide Seiten tragen denselben Stand', handyA.stand === handyB.stand, `${handyA.stand} / ${handyB.stand}`);

// A speichert zuerst.
r = await req(`/einteilung/${terminId}/speichern`, {
  method: 'POST',
  form: { _csrf: handyA.token, teams: handyA.teams, stand: handyA.stand },
});
check('A speichert ohne Rückfrage', r.status === 302, String(r.status));

// Die Erkennung vergleicht Zeitstempel in Sekunden — kurz warten, damit ein
// erneutes Speichern einen anderen traegt.
await new Promise((x) => setTimeout(x, 1100));

// B speichert mit dem Stand von vorhin — inzwischen veraltet.
r = await req(`/einteilung/${terminId}/speichern`, {
  method: 'POST',
  form: { _csrf: handyB.token, teams: handyB.teams, stand: handyB.stand },
});
check('B bekommt eine Rückfrage statt zu überschreiben', r.status === 200 && r.text.includes('Einteilung ersetzen?'), String(r.status));
check('mit der fremden Einteilung zum Ansehen', r.text.includes('Aktuell gespeichert'));
check('und der eigenen als Zahl', /Einheiten|Einheit/.test(r.text));

r = await req(`/einteilung?termin=${terminId}`);
check('gespeichert ist weiterhin die Einteilung von A', r.text.includes('Gespeicherte Einteilung'));

// B bestätigt: der Bestätigungsdialog trägt den frischen Stand.
const bestaetigung = await req(`/einteilung/${terminId}/speichern`, {
  method: 'POST',
  form: { _csrf: handyB.token, teams: handyB.teams, stand: handyB.stand },
});
const standNeu = bestaetigung.text.match(/name="stand" value="([^"]*)"/)[1];
check('der Dialog trägt den neuen Stand', standNeu !== handyB.stand, standNeu);
r = await req(`/einteilung/${terminId}/speichern`, {
  method: 'POST',
  form: { _csrf: handyB.token, teams: handyB.teams, stand: standNeu },
});
check('mit frischem Stand wird gespeichert', r.status === 302, String(r.status));
r = await req(`/einteilung?termin=${terminId}`);
check('jetzt steht Bs Einteilung da', r.text.includes('Gespeicherte Einteilung'));

console.log('\n30h) Einschätzungen bleiben unter Verschluss');
merkeCookie = cookie;
cookie = '';
for (const pfad of ['/einschaetzung', '/einteilung', '/anwesenheit', '/anwesenheit/quoten']) {
  r = await req(pfad);
  check(`${pfad} ohne Anmeldung gesperrt`, r.status === 302 && r.location === '/anmelden', `${r.status} ${r.location}`);
}
// Der Weg, der Kindern offensteht: die Spint-Seite per QR-Code.
r = await req('/s/' + spintToken);
check('QR-Seite nennt keine Einschätzung', r.status === 200 && !/erfahrung|zupacken|anleiten|Einschätzung/i.test(r.text));
check('QR-Seite nennt keine Anwesenheit', !/anwesend|Anwesenheit/i.test(r.text));
cookie = merkeCookie;

// Auch die API gibt nichts davon her.
a = await apiGet('/api/v1/mitglieder');
check('API nennt keine Einschätzung', !/erfahrung|zupacken|anleiten/i.test(JSON.stringify(a.json)));

console.log('\n31) Wiederherstellung bei der Ersteinrichtung');
// Zweiter Server mit leerer Datenbank — dort wird die Sicherung eingespielt.
const zweiterOrdner = mkdtempSync(path.join(tmpdir(), 'jf-restore-test-'));
const PORT2 = 3988;
const BASE2 = `http://127.0.0.1:${PORT2}`;
const server2 = spawn(process.execPath, ['server.js'], {
  cwd: WURZEL,
  env: {
    ...process.env,
    PORT: String(PORT2),
    DATA_DIR: zweiterOrdner,
    SESSION_SECRET: 'test2',
    // Hier absichtlich ein Befehl, der scheitert — damit auch der Fehlerfall
    // des Herunterfahrens geprueft wird (fehlende polkit-Regel auf dem Pi).
    ABSCHALT_BEFEHL: JSON.stringify([process.execPath, abschaltHelfer, '--fehler']),
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => {
  server2.kill();
  try { rmSync(zweiterOrdner, { recursive: true, force: true }); } catch { /* Windows */ }
});
for (let v = 0; ; v++) {
  try { await fetch(BASE2 + '/einrichtung'); break; }
  catch (e) { if (v > 100) throw new Error('zweiter Server startet nicht'); await new Promise((x) => setTimeout(x, 100)); }
}

let cookie2 = '';
const req2Neu = async (pfad, opts = {}) => {
  const h = cookie2 ? { cookie: cookie2 } : {};
  const res4 = await fetch(BASE2 + pfad, { redirect: 'manual', ...opts, headers: { ...h, ...(opts.headers || {}) } });
  for (const c of res4.headers.getSetCookie?.() || []) cookie2 = c.split(';')[0];
  return { status: res4.status, location: res4.headers.get('location'), text: await res4.text() };
};

let r2 = await req2Neu('/einrichtung');
check('zweite Instanz zeigt die Ersteinrichtung', r2.status === 200 && r2.text.includes('Ersteinrichtung'));
check('bietet „Mit Sicherung fortsetzen“ an', r2.text.includes('Mit Sicherung fortsetzen'));
const token2 = r2.text.match(/name="_csrf" value="([^"]+)"/)[1];

const hochladen = async (datei, passwort, tok = token2) => {
  const fd = new FormData();
  fd.append('_csrf', tok);
  fd.append('passwort', passwort);
  fd.append('sicherung', new Blob([datei]), 'sicherung.db.enc');
  const res4 = await fetch(BASE2 + '/einrichtung/sicherung', {
    method: 'POST', body: fd, headers: cookie2 ? { cookie: cookie2 } : {}, redirect: 'manual',
  });
  for (const c of res4.headers.getSetCookie?.() || []) cookie2 = c.split(';')[0];
  return { status: res4.status, location: res4.headers.get('location'), text: await res4.text() };
};

r2 = await hochladen(sicRumpf, 'falschesPasswort');
check('falsches Passwort wird abgelehnt', r2.status === 400 && r2.text.includes('Passwort passt nicht'));

r2 = await hochladen(Buffer.from('kein gueltiges Format'), SICHERUNGSPASSWORT);
check('fremde Datei wird abgelehnt', r2.status === 400 && r2.text.includes('keine verschlüsselte Sicherung'));

r2 = await hochladen(sicRumpf, SICHERUNGSPASSWORT);
check('Sicherung wird eingespielt', r2.status === 302 && r2.location === '/anmelden', `${r2.status} ${r2.location}`);

r2 = await req2Neu('/einrichtung');
check('Ersteinrichtung danach gesperrt', r2.status === 302 && r2.location === '/', r2.location);

// Mit den Zugangsdaten aus der Sicherung anmelden
r2 = await req2Neu('/anmelden');
const token2b = r2.text.match(/name="_csrf" value="([^"]+)"/)[1];
r2 = await req2Neu('/anmelden', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: token2b, username: 'jugendwart', password: 'geheim1234' }).toString(),
});
check('Anmeldung mit den alten Zugangsdaten', r2.status === 302 && r2.location === '/', `${r2.status} ${r2.location}`);

r2 = await req2Neu('/mitglieder');
check('Mitglieder sind zurück', r2.text.includes('Max Muster') && r2.text.includes('Lena Muster'));
r2 = await req2Neu('/');
check('Spinte sind zurück', r2.text.includes('Umkleide Jungs'));
r2 = await req2Neu('/lager');
check('Ausrüstung ist zurück', r2.text.includes('112000801') || r2.text.includes('IM-LAGER-1'));
r2 = await req2Neu('/ausruestungsarten');
check('Arten und Größen sind zurück', r2.text.includes('112000') && r2.text.includes('116, 122'));
r2 = await req2Neu('/verlauf');
check('Verlauf ist zurück', r2.status === 200 && r2.text.includes('angelegt'));
r2 = await req2Neu('/stammdaten');
check('Stammdaten sind zurück', r2.text.includes('Jugendfeuerwehr Ebertsheim'));
// Der eigentliche Grund, warum das Logo in der Datenbank liegt und nicht als
// Datei daneben: so ist es nach der Wiederherstellung ohne Zutun wieder da.
const logoZurueck = await fetch(BASE2 + '/logo', { headers: cookie2 ? { cookie: cookie2 } : {} });
check('Logo ist zurück', logoZurueck.status === 200 && (await logoZurueck.arrayBuffer()).byteLength === PNG.length,
  String(logoZurueck.status));
r2 = await req2Neu('/etiketten');
check('Etiketten lassen sich sofort drucken', r2.status === 200 && r2.text.includes('Jugendfeuerwehr Ebertsheim'));

console.log('\n32) Pi herunterfahren');
// Erst als Betreuer: der darf das nicht.
cookie = '';
token = await csrf('/anmelden');
await req('/anmelden', { method: 'POST', form: { _csrf: token, username: 'tim', password: 'passwort123' } });
r = await req('/system');
check('Betreuer kommt nicht an die Systemseite', r.status === 403, String(r.status));
token = await csrf('/');
r = await req('/system/herunterfahren', { method: 'POST', form: { _csrf: token } });
check('Betreuer kann nicht herunterfahren', r.status === 403, String(r.status));
check('nichts passiert', !existsSync(abschaltNachweis));

cookie = '';
token = await csrf('/anmelden');
await req('/anmelden', { method: 'POST', form: { _csrf: token, username: 'jugendwart', password: 'geheim1234' } });
r = await req('/system');
check('Jugendwart sieht die Systemseite', r.status === 200 && r.text.includes('Herunterfahren'), String(r.status));
check('Seite zeigt die Betriebszeit', r.text.includes('läuft seit'));
check('ohne Zeitschaltung ein Hinweis darauf', r.text.includes('Noch keine automatische Sicherung'));

// Den Stand schreibt sonst scripts/sicherung-automatisch.sh auf dem Pi.
const standDatei = path.join(datenordner, 'sicherung-status.json');
writeFileSync(
  standDatei,
  JSON.stringify({
    zeitpunkt: new Date().toISOString(),
    ergebnis: 'ok',
    meldung: '',
    ziel: '/mnt/jf-sicherung',
    datenbank: 'spinte-2026-01-01-0330.db.enc',
    wlan: 'wlan-2026-01-01-0330.tar.gz.enc',
    staende: 7,
  })
);
r = await req('/system');
check('Stand der nächtlichen Sicherung wird angezeigt', r.text.includes('Zuletzt gesichert'));
check('Ziel und Anzahl stehen dabei', r.text.includes('/mnt/jf-sicherung') && r.text.includes('7 Stände'));
check('die WLAN-Sicherung wird genannt', r.text.includes('wlan-2026-01-01-0330.tar.gz.enc'));

writeFileSync(
  standDatei,
  JSON.stringify({
    zeitpunkt: new Date().toISOString(),
    ergebnis: 'warnung',
    meldung: 'USB-Stick nicht eingehängt — auf die Speicherkarte ausgewichen.',
    ziel: '/opt/jf-spinte/data/sicherungen',
    datenbank: 'spinte-2026-01-01-0330.db.enc',
    wlan: '',
    staende: 3,
  })
);
r = await req('/system');
check('fehlender Stick wird gemeldet', r.text.includes('USB-Stick nicht eingehängt') && r.text.includes('hinweis-warn'));
rmSync(standDatei, { force: true });

r = await req('/system/herunterfahren', { method: 'POST', form: { _csrf: 'falsch' } });
check('Herunterfahren ohne gültiges Token abgelehnt', r.status === 403, String(r.status));
check('immer noch nichts passiert', !existsSync(abschaltNachweis));

token = await csrf('/system');
r = await req('/system/herunterfahren', { method: 'POST', form: { _csrf: token } });
check('Abschiedsseite wird ausgeliefert', r.status === 200 && r.text.includes('fährt herunter'), String(r.status));
check('der Befehl wurde wirklich ausgeführt', existsSync(abschaltNachweis));
r = await req('/verlauf');
check('Herunterfahren steht im Verlauf', r.text.includes('heruntergefahren'));

// Auf dem zweiten Server scheitert der Befehl — so wie auf einem Pi, dem die
// polkit-Regel fehlt. Der Fehler muss lesbar auf der Seite landen.
r2 = await req2Neu('/system');
check('zweite Instanz zeigt die Systemseite', r2.status === 200, String(r2.status));
const tokenAb = r2.text.match(/name="_csrf" value="([^"]+)"/)[1];
r2 = await req2Neu('/system/herunterfahren', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: tokenAb }).toString(),
});
check('gescheitertes Herunterfahren leitet zurück', r2.status === 302 && r2.location === '/system', `${r2.status} ${r2.location}`);
r2 = await req2Neu('/system');
check('Grund steht auf der Seite', r2.text.includes('Interactive authentication required'));
r2 = await req2Neu('/verlauf');
check('Fehlschlag steht im Verlauf', r2.text.includes('fehlgeschlagen'));

console.log('\n33) Ausmustern eines Teils mit offener Bestellung');
// Der Fall aus dem Alltag: Handschuhe sind verloren, Ersatz ist bestellt, und
// dann mustert jemand das alte Teil aus. Die Bestellung darf dabei nicht aus
// dem Blick geraten — sonst steht der Spint ohne Handschuhe da und niemand
// weiss mehr, dass welche unterwegs sind.
token = await csrf(`/spint/${boys01.id}/bearbeiten`);
await req('/ausruestung/neu', {
  method: 'POST',
  form: {
    _csrf: token, zurueck: `/spint/${boys01.id}/bearbeiten`, locker_id: String(boys01.id),
    // Größe 10: in der Reihe (7–10) gültig, aber nichts davon im Lager — sonst
    // schlägt der Tausch einen Fundort vor, statt eine Bestellung anzulegen.
    type_id: '4', size: '10', note: 'Testhandschuhe verloren',
  },
});
r = await req(`/spint/${boys01.id}/bearbeiten`);
const verlorenId = idAusZeile(r.text, 'Testhandschuhe verloren');
check('Handschuhe angelegt', !!verlorenId, String(verlorenId));

token = await csrf(`/ausruestung/${verlorenId}/tauschen`);
r = await req(`/ausruestung/${verlorenId}/tauschen`, {
  method: 'POST',
  form: { _csrf: token, to_size: '10', reason: 'verloren', note: 'Ersatz bestellt' },
});
check('Ersatz bestellt', r.status === 302 && r.location === '/aufgaben', `${r.status} ${r.location}`);

r = await req(`/spint/${boys01.id}/bearbeiten`);
check('Bestellung hängt am Teil', r.text.includes('chip-offen'));

token = await csrf(`/spint/${boys01.id}/bearbeiten`);
r = await req(`/ausruestung/${verlorenId}/ausmustern`, {
  method: 'POST',
  form: { _csrf: token, zurueck: `/spint/${boys01.id}/bearbeiten` },
});
check('Ausmustern führt zurück zum Spint', r.status === 302, String(r.status));

r = await req(`/spint/${boys01.id}/bearbeiten`);
check('das Teil ist aus dem Spint verschwunden', !r.text.includes('Testhandschuhe verloren'));
check('die Bestellung bleibt trotzdem sichtbar', r.text.includes('Offen für diesen Spint'));
check('und nennt weiterhin die Art', /offeneaufgaben[\s\S]*?Handschuhe/.test(r.text));
r = await req('/aufgaben');
check('die Aufgabe steht weiter offen', r.text.includes('Ersatz bestellt'));

// Auch am Spint selbst, ohne Anmeldung.
merkeAnmeldung = cookie;
cookie = '';
r = await req('/s/' + spintToken);
check('auch ohne Anmeldung sichtbar', r.status === 200 && r.text.includes('Schon unterwegs'), String(r.status));
cookie = merkeAnmeldung;

console.log('\n34) Verlorenes taucht wieder auf');
// Ein Knopf statt zweier Schritte an zwei Orten: Bestellung zurücknehmen und
// das ausgemusterte Teil zurück in den Spint.
r = await req(`/spint/${boys01.id}/bearbeiten`);
check('„Doch gefunden“ steht am Spint', r.text.includes('Doch gefunden'));
const gefundenId = Number(r.text.match(/\/aufgaben\/(\d+)\/gefunden/)?.[1]);
check('Aufgabe dazu gefunden', !!gefundenId, String(gefundenId));

token = await csrf(`/spint/${boys01.id}/bearbeiten`);
r = await req(`/aufgaben/${gefundenId}/gefunden`, {
  method: 'POST',
  form: { _csrf: token, zurueck: `/spint/${boys01.id}/bearbeiten` },
});
check('führt zurück zum Spint', r.status === 302 && r.location === `/spint/${boys01.id}/bearbeiten`, `${r.status} ${r.location}`);

r = await req(`/spint/${boys01.id}/bearbeiten`);
check('das Teil liegt wieder im Spint', r.text.includes('Testhandschuhe verloren'));
check('die Bestellung ist verschwunden', !r.text.includes('Offen für diesen Spint'));
r = await req('/aufgaben');
check('Aufgabe nicht mehr offen', !r.text.includes('Ersatz bestellt'));
r = await req('/aufgaben?status=abgebrochen');
check('sie steht als abgebrochen im Archiv', r.text.includes('Ersatz bestellt'));
check('mit Vermerk, dass es wieder auftauchte', r.text.includes('wieder aufgetaucht'));
r = await req('/ausgemustert');
check('nicht mehr unter „Ausgemustert“', !r.text.includes('Testhandschuhe verloren'));
r = await req('/verlauf');
check('der Verlauf hält es fest', r.text.includes('wieder aufgetaucht'));

console.log('\n35) Übungszeit in den Stammdaten');
r = await req('/stammdaten');
check('Felder für Beginn und Ende', r.text.includes('name="dienst_beginn"') && r.text.includes('name="dienst_ende"'));
check('Voreinstellung 17:45 bis 19:30', r.text.includes('value="17:45"') && r.text.includes('value="19:30"'));

const stammSpeichern = async (form) => {
  const t = await csrf('/stammdaten');
  return req('/stammdaten', {
    method: 'POST',
    form: { _csrf: t, organisation: 'Jugendfeuerwehr Testheim', abteilung: 'Jugendfeuerwehr', slogan: '', ...form },
  });
};

// Uhrzeit relativ zu jetzt, damit der Test unabhängig von der Tageszeit läuft.
const uhrzeitIn = (minuten) => {
  const gesamt = (new Date().getHours() * 60 + new Date().getMinutes() + minuten + 1440) % 1440;
  return `${String(Math.floor(gesamt / 60)).padStart(2, '0')}:${String(gesamt % 60).padStart(2, '0')}`;
};

await stammSpeichern({ dienst_beginn: '18.00', dienst_ende: '19:45' });
r = await req('/stammdaten');
check('18.00 wird als 18:00 verstanden', r.text.includes('value="18:00"'));
check('Ende übernommen', r.text.includes('value="19:45"'));

await stammSpeichern({ dienst_beginn: 'halb sechs', dienst_ende: '19:45' });
r = await req('/stammdaten');
check('unlesbare Uhrzeit ändert nichts', r.text.includes('value="18:00"'));

console.log('\n36) Aktualisierung über die Oberfläche');
r = await req('/system');
check('Systemseite nennt die Aktualisierung', r.text.includes('Aktualisierung'));
check('ohne Git der Hinweis zum Umstellen', r.text.includes('auf-git-umstellen.sh'));

token = await csrf('/system');
r = await req('/system/update/starten', { method: 'POST', form: { _csrf: token } });
check('Start ohne Git wird abgewiesen', r.status === 302 && r.location === '/system/update', `${r.status} ${r.location}`);
check('und legt keine Anforderung ab', !existsSync(updateMarke));
r = await req('/system/update');
check('mit Grund auf der Seite', r.text.includes('kein Git-Arbeitsverzeichnis'));

// Ein Repository nachstellen: ein "ferner" Stand mit einem Commit mehr als die
// Installation. Damit läuft dieselbe Prüfung wie auf dem Pi, nur ohne Netz.
const fern = path.join(datenordner, 'fern.git');
const g = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });
let gitDa = true;
try {
  execFileSync('git', ['init', '--bare', '--initial-branch=main', fern], { stdio: 'pipe' });
  execFileSync('git', ['clone', fern, gitOrdner], { stdio: 'pipe' });
  for (const ordner of [gitOrdner]) {
    g(['config', 'user.email', 'test@example.invalid'], ordner);
    g(['config', 'user.name', 'Test'], ordner);
  }
  writeFileSync(path.join(gitOrdner, 'stand.txt'), 'erster Stand\n');
  g(['add', '.'], gitOrdner);
  g(['commit', '-m', 'Erster Stand'], gitOrdner);
  g(['push', '-u', 'origin', 'main'], gitOrdner);

  const zweitkopie = path.join(datenordner, 'zweitkopie');
  execFileSync('git', ['clone', fern, zweitkopie], { stdio: 'pipe' });
  g(['config', 'user.email', 'test@example.invalid'], zweitkopie);
  g(['config', 'user.name', 'Test'], zweitkopie);
  writeFileSync(path.join(zweitkopie, 'stand.txt'), 'zweiter Stand\n');
  g(['commit', '-am', 'Etiketten schmaler gesetzt'], zweitkopie);
  g(['push', 'origin', 'main'], zweitkopie);
} catch (err) {
  gitDa = false;
  console.log('  ---- git nicht verfügbar, Update-Prüfung übersprungen:', err.message.split('\n')[0]);
}

if (gitDa) {
  r = await req('/system');
  check('mit Git verschwindet der Umstell-Hinweis', !r.text.includes('auf-git-umstellen.sh'));

  // Die Anwendung holt NICHT selbst vom Server — sie darf im Betrieb nicht in
  // .git schreiben. Vor dem Abgleich weiß sie deshalb nichts von der zweiten
  // Änderung, obwohl es sie im Repository längst gibt.
  r = await req('/system/update');
  check('ohne Abgleich meldet die Seite alles aktuell', r.text.includes('Alles aktuell'));
  check('und kennt die neue Änderung noch nicht', !r.text.includes('Etiketten schmaler gesetzt'));
  check('bietet aber das Nachfragen an', r.text.includes('Nach Updates suchen'));

  token = await csrf('/system/update');
  r = await req('/system/update/abgleichen', { method: 'POST', form: { _csrf: token } });
  check('Abgleich wird angefordert', r.status === 302 && r.location === '/system/update', `${r.status} ${r.location}`);
  check('die Markierung liegt bereit', existsSync(updateMarke));
  check(
    'und sagt in Zeile 1, dass nur nachgesehen werden soll',
    readFileSync(updateMarke, 'utf8').split('\n')[0].trim() === 'pruefen',
    readFileSync(updateMarke, 'utf8').split('\n')[0]
  );
  r = await req('/system/update');
  check('solange steht „Sehe nach" auf der Seite', r.text.includes('Suche nach Updates'));

  // Ab hier den Helfer nachstellen: er holt vom Server und meldet das Ergebnis.
  unlinkSync(updateMarke);
  execFileSync('git', ['-C', gitOrdner, 'fetch', '--quiet', 'origin', 'main'], { stdio: 'pipe' });
  writeFileSync(
    updateAbgleich,
    JSON.stringify({ zeitpunkt: new Date().toISOString(), schritt: 'abgleich', ergebnis: 'ok', meldung: 'Nachgesehen.' })
  );

  // Jetzt ist Übungszeit: die Seite soll vom Neustart abraten.
  await stammSpeichern({ dienst_beginn: uhrzeitIn(5), dienst_ende: uhrzeitIn(30) });
  r = await req('/system/update');
  check('nach dem Abgleich wird die Änderung aufgelistet', r.text.includes('Etiketten schmaler gesetzt'), r.status + '');
  check('mit dem Zeitpunkt des Abgleichs', r.text.includes('Zuletzt gesucht'));
  check('als eine einzige Änderung gezählt', r.text.includes('<h2>1 Änderung</h2>'));
  check('mit Knopf zum Einspielen', r.text.includes('Jetzt aktualisieren'));
  check('warnt während der Übungszeit', r.text.includes('Ungünstiger Zeitpunkt'));
  check('und nennt das Zeitfenster', r.text.includes('ist Übungszeit'));

  // Außerhalb der Übungszeit soll der Hinweis verschwinden.
  await stammSpeichern({ dienst_beginn: uhrzeitIn(240), dienst_ende: uhrzeitIn(300) });
  r = await req('/system/update');
  check('außerhalb der Übungszeit kein Zeitfenster-Hinweis', !r.text.includes('ist Übungszeit'));
  check('und dann auch keine Warnung', !r.text.includes('Ungünstiger Zeitpunkt'));

  // Ist für heute schon Anwesenheit erfasst, läuft der Abend gerade — dann warnt
  // die Seite auch außerhalb der eingestellten Zeiten.
  const jetztDatum = new Date();
  const heuteISO = `${jetztDatum.getFullYear()}-${String(jetztDatum.getMonth() + 1).padStart(2, '0')}-${String(jetztDatum.getDate()).padStart(2, '0')}`;
  token = await csrf(`/anwesenheit/${terminId}`);
  r = await req('/anwesenheit/neu', { method: 'POST', form: { _csrf: token, datum: heuteISO, thema: 'Heute' } });
  const heuteTermin = Number((r.location || '').match(/\/anwesenheit\/(\d+)/)?.[1]);
  token = await csrf(`/anwesenheit/${heuteTermin}`);
  await req(`/anwesenheit/${heuteTermin}/alle`, { method: 'POST', form: { _csrf: token, status: 'da' } });
  r = await req('/system/update');
  check('die heute erfasste Anwesenheit zählt', r.text.includes('schon Anwesenheit erfasst'));

  token = r.text.match(/name="_csrf" value="([^"]+)"/)[1];
  r = await req('/system/update/starten', { method: 'POST', form: { _csrf: token } });
  check('Start wird angenommen', r.status === 302 && r.location === '/system/update', `${r.status} ${r.location}`);
  check('legt die Anforderung für systemd ab', existsSync(updateMarke));
  check('mit Namen des Auslösers darin', readFileSync(updateMarke, 'utf8').includes('Max Wart'));

  r = await req('/system/update');
  check('die Seite zeigt „Läuft gerade“', r.text.includes('Läuft gerade'));
  check('und wird vom Skript beobachtet', r.text.includes('data-update-laeuft'));
  check('kein zweiter Knopf zum Starten', !r.text.includes('Jetzt aktualisieren'));

  r = await req('/system/update/status.json');
  let stand = JSON.parse(r.text);
  check('Status als JSON für die Anzeige', stand.laeuft === true && stand.status.schritt === 'angefordert');

  token = await csrf('/system');
  r = await req('/system/update/starten', { method: 'POST', form: { _csrf: token } });
  r = await req('/system/update');
  check('zweiter Start läuft ins Leere', r.text.includes('Es läuft bereits eine Aktualisierung'));

  // Ab hier den Helfer nachstellen: Markierung weg, Ergebnis hinterlegt.
  unlinkSync(updateMarke);
  writeFileSync(updateStatus, JSON.stringify({
    zeitpunkt: new Date().toISOString(), schritt: 'zurueck', ergebnis: 'zurueckgesetzt',
    meldung: 'Die Seite antwortete nach zwei Versuchen nicht.', vorher: 'abc1234', nachher: 'abc1234',
  }));
  r = await req('/system/update/status.json');
  stand = JSON.parse(r.text);
  check('danach läuft nichts mehr', stand.laeuft === false);
  r = await req('/system/update');
  check('das Zurücksetzen steht auf der Seite', r.text.includes('Zurückgesetzt'));
  check('mit dem Grund dazu', r.text.includes('nach zwei Versuchen nicht'));
  check('und dem Weg zur Sicherung', r.text.includes('/restore'));
}

console.log('\n37) Sicherung in die laufende Installation einspielen');
// Erst ein Stand zum Zurückholen, dann etwas kaputt machen, dann zurück.
token = await csrf('/sicherung');
let stand37 = await holen(SICHERUNGSPASSWORT);
check('frische Sicherung gezogen', stand37.status === 200 && stand37.rumpf.length > 1000, String(stand37.status));

const ablage = path.join(datenordner, 'sicherungen');
mkdirSync(ablage, { recursive: true });
const sicherungsdatei = path.join(ablage, 'spinte-2026-08-08-1200.db.enc');
writeFileSync(sicherungsdatei, stand37.rumpf);

r = await req('/restore');
check('Seite erreichbar', r.status === 200 && r.text.includes('Sicherung einspielen'), String(r.status));
check('findet die abgelegte Sicherung', r.text.includes('spinte-2026-08-08-1200.db.enc'));
check('und nennt den Fundort', r.text.includes('Speicherkarte'));

// Jetzt ein Mitglied löschen — das muss die Sicherung zurückbringen.
token = await csrf('/mitglieder');
r = await req('/mitglieder/neu', { method: 'POST', form: { _csrf: token, name: 'Nur Kurz Da', gender: 'm', birthday: '1.1.15' } });
r = await req('/mitglieder');
check('Mitglied nach der Sicherung angelegt', r.text.includes('Nur Kurz Da'));

token = await csrf('/restore');
r = await req('/restore', { method: 'POST', form: { _csrf: token, pfad: sicherungsdatei, passwort: SICHERUNGSPASSWORT } });
check('ohne Bestätigung wird nichts ersetzt', r.status === 302 && r.location === '/restore', `${r.status} ${r.location}`);
r = await req('/restore');
check('mit Nachfrage nach der Bestätigung', r.text.includes('bestätigen'));

token = await csrf('/restore');
r = await req('/restore', { method: 'POST', form: { _csrf: token, verstanden: 'ja', passwort: SICHERUNGSPASSWORT } });
r = await req('/restore');
check('ohne Datei und ohne Auswahl ein Hinweis', r.text.includes('Bitte eine Sicherung auswählen'));

token = await csrf('/restore');
r = await req('/restore', {
  method: 'POST',
  form: { _csrf: token, verstanden: 'ja', pfad: sicherungsdatei, passwort: 'FalschesPasswort123' },
});
r = await req('/restore');
check('falsches Passwort wird erkannt', r.text.includes('Passwort passt nicht'));
r = await req('/mitglieder');
check('und lässt die Daten unangetastet', r.text.includes('Nur Kurz Da'));

token = await csrf('/restore');
r = await req('/restore', {
  method: 'POST',
  form: { _csrf: token, verstanden: 'ja', pfad: path.join(ablage, 'gibt-es-nicht.db.enc'), passwort: SICHERUNGSPASSWORT },
});
r = await req('/restore');
check('erfundener Pfad wird abgelehnt', r.text.includes('nicht (mehr) auffindbar'));

token = await csrf('/restore');
r = await req('/restore', {
  method: 'POST',
  form: { _csrf: token, verstanden: 'ja', pfad: sicherungsdatei, passwort: SICHERUNGSPASSWORT },
});
check('Einspielen meldet ab', r.status === 302 && r.location === '/anmelden', `${r.status} ${r.location}`);

r = await req('/mitglieder');
check('die Sitzung ist wirklich beendet', r.status === 302 && r.location === '/anmelden', String(r.status));

token = await csrf('/anmelden');
r = await req('/anmelden', { method: 'POST', form: { _csrf: token, username: 'jugendwart', password: 'geheim1234' } });
check('Anmeldung mit den Daten aus der Sicherung', r.status === 302, String(r.status));
r = await req('/mitglieder');
check('das später angelegte Mitglied ist weg', !r.text.includes('Nur Kurz Da'));
check('die alten Mitglieder sind wieder da', r.text.includes('Max Muster'));

r = await req('/restore');
check('die Sicherheitskopie liegt daneben', /vor-restore\.db\.enc/.test(r.text));
r = await req('/verlauf');
check('der Verlauf hält das Einspielen fest', r.text.includes('Sicherung eingespielt'));

console.log('\n38) Handbuch in der Oberfläche');
r = await req('/handbuch');
check('Handbuch erreichbar', r.status === 200 && r.text.includes('Handbuch'), String(r.status));
check('Überschriften bekommen Anker', /<h2 id="der-übungsabend">/.test(r.text));
check('Bilder zeigen auf die eigene Adresse', r.text.includes('src="/handbuch/bilder/uebersicht.png"'));
check('Tabellen werden gesetzt', r.text.includes('<table>') && r.text.includes('<th>'));
check('Codeblöcke bleiben Code', r.text.includes('<pre class="befehl"'));
check('kein rohes Markdown mehr', !r.text.includes('](bilder/'));
check('Inhaltsverzeichnis vorhanden', r.text.includes('class="dokunav"'));
// Verweise auf Dateien im Repository führen in der Oberfläche ins Leere und
// bleiben deshalb Text statt Link.
check('Verweis auf das README wird umgebogen', r.text.includes('href="/handbuch/readme"'));
check('Verweis auf eine Quelldatei bleibt Text', !r.text.includes('href="../scripts/doku-daten.js"'));

r = await req('/handbuch/readme');
check('Technische Beschreibung erreichbar', r.status === 200 && r.text.includes('Was die Seiten können'));
r = await req('/handbuch/datenbank');
check('Datenbank-Seite erreichbar', r.status === 200 && r.text.includes('Schema-Fassungen'));

const bild = await fetch(BASE + '/handbuch/bilder/uebersicht.png', { headers: { cookie } });
check('Bild wird ausgeliefert', bild.status === 200, String(bild.status));
check('als PNG', (bild.headers.get('content-type') || '').includes('png'));
r = await req('/handbuch/bilder/gibtsnicht.png');
check('unbekanntes Bild gibt 404', r.status === 404, String(r.status));
r = await req('/handbuch/bilder/server.js');
check('nur Bilder werden ausgeliefert', r.status === 404, String(r.status));

r = await req('/');
check('das Menü verlinkt das Handbuch', r.text.includes('href="/handbuch"'));

merkeAnmeldung = cookie;
cookie = '';
r = await req('/handbuch');
check('ohne Anmeldung gesperrt', r.status === 302 && r.location === '/anmelden', `${r.status} ${r.location}`);
r = await req('/handbuch/bilder/uebersicht.png');
check('auch die Bilder sind gesperrt', r.status === 302, String(r.status));
cookie = merkeAnmeldung;

console.log('\n39) Sicherung aus einer neueren Fassung');
// Eine Sicherung mit höherer Schema-Fassung nachbauen: entschlüsseln, Nummer
// hochsetzen, wieder verschlüsseln. Genau so käme sie von einer Installation,
// die schon aktualisiert wurde.
token = await csrf('/sicherung');
const echt = await holen(SICHERUNGSPASSWORT);
check('Sicherung für den Versuch gezogen', echt.status === 200, String(echt.status));

const salzAlt = echt.rumpf.subarray(8, 16);
const abAlt = cryptoMod.pbkdf2Sync(SICHERUNGSPASSWORT, salzAlt, 10000, 48, 'sha256');
const entschl = cryptoMod.createDecipheriv('aes-256-cbc', abAlt.subarray(0, 32), abAlt.subarray(32, 48));
const roh = Buffer.concat([entschl.update(echt.rumpf.subarray(16)), entschl.final()]);

const bastelOrdner = mkdtempSync(path.join(tmpdir(), 'jf-zukunft-'));
const bastelDatei = path.join(bastelOrdner, 'zukunft.db');
writeFileSync(bastelDatei, roh);
const gebastelt = new DB(bastelDatei);
gebastelt.prepare('INSERT INTO schema_version (version, name) VALUES (?, ?)').run(99, 'Aus der Zukunft');
gebastelt.close();

const salzNeu = cryptoMod.randomBytes(8);
const abNeu = cryptoMod.pbkdf2Sync(SICHERUNGSPASSWORT, salzNeu, 10000, 48, 'sha256');
const verschl = cryptoMod.createCipheriv('aes-256-cbc', abNeu.subarray(0, 32), abNeu.subarray(32, 48));
const zukunftDatei = path.join(ablage, 'spinte-2026-12-24-1800-s99.db.enc');
writeFileSync(
  zukunftDatei,
  Buffer.concat([Buffer.from('Salted__'), salzNeu, verschl.update(readFileSync(bastelDatei)), verschl.final()])
);
rmSync(bastelOrdner, { recursive: true, force: true });

r = await req('/restore');
check('die neuere Sicherung steht in der Liste', r.text.includes('spinte-2026-12-24-1800-s99.db.enc'));

token = await csrf('/restore');
r = await req('/restore', {
  method: 'POST',
  form: { _csrf: token, verstanden: 'ja', pfad: zukunftDatei, passwort: SICHERUNGSPASSWORT },
});
check('sie wird nicht eingespielt', r.status === 302 && r.location === '/restore', `${r.status} ${r.location}`);
r = await req('/restore');
check('mit Hinweis auf die neuere Fassung', r.text.includes('neueren Fassung'));
check('und den beiden Nummern', r.text.includes('99') && r.text.includes('Schema'));
r = await req('/mitglieder');
check('die Daten sind unangetastet', r.text.includes('Max Muster'));

// Die passende Sicherung geht weiterhin — der Schutz sperrt nicht alles aus.
token = await csrf('/restore');
r = await req('/restore', {
  method: 'POST',
  form: { _csrf: token, verstanden: 'ja', pfad: sicherungsdatei, passwort: SICHERUNGSPASSWORT },
});
check('die passende Sicherung dagegen schon', r.status === 302 && r.location === '/anmelden', `${r.status} ${r.location}`);
token = await csrf('/anmelden');
await req('/anmelden', { method: 'POST', form: { _csrf: token, username: 'jugendwart', password: 'geheim1234' } });

server2.kill();

console.log(fails === 0 ? '\nAlles grün.\n' : `\n${fails} Fehler.\n`);
process.exit(fails ? 1 : 0);
