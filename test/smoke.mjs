// Durchlauf durch die wichtigsten Abläufe gegen einen frisch gestarteten Server
// mit leerer Datenbank. Aufruf: npm test
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const datenordner = mkdtempSync(path.join(tmpdir(), 'jf-spinte-test-'));

const server = spawn(process.execPath, ['server.js'], {
  cwd: WURZEL,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: datenordner, SESSION_SECRET: 'test' },
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
check('QR-Seite rendert SVG mit id-Link', r.text.includes('<svg') && r.text.includes(`/spint/${boys01.id}`));

console.log('\n8) Öffentlicher Zugriff (abgemeldet)');
const merk = cookie;
cookie = '';
r = await req(`/spint/${boys01.id}`);
check('Spint ohne Login lesbar', r.status === 200 && r.text.includes('Max Muster'));
check('kein Bearbeiten-Knopf', !r.text.includes(`/spint/${boys01.id}/bearbeiten`));
r = await req(`/spint/${boys01.id}/bearbeiten`);
check('Bearbeiten leitet zum Login', r.status === 302 && r.location === '/anmelden', r.location);
r = await req('/bereiche');
check('Bereiche-Seite nur mit Login', r.status === 302);
r = await req('/spint/9999');
check('unbekannter Spint → 404', r.status === 404);
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

console.log(fails === 0 ? '\nAlles grün.\n' : `\n${fails} Fehler.\n`);
process.exit(fails ? 1 : 0);
