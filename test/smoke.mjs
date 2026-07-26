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

// Sucht auf der Spint-Bearbeiten-Seite die Ausrüstungs-id in der Zeile, die
// <text> enthält (z. B. eine Inventarnummer).
function idAusZeile(html, text) {
  for (const block of html.split('class="teilzeile"')) {
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

console.log('\n11) Lagerorte mit QR-Code');
token = await csrf('/lagerorte');
r = await req('/lagerorte/neu', { method: 'POST', form: { _csrf: token, name: 'Schrank 1', location: 'Gerätehaus' } });
const schrank = Number((r.location || '').match(/\/lagerort\/(\d+)/)?.[1]);
check('Lagerort angelegt', !!schrank, r.location);

token = await csrf('/lagerorte');
r = await req('/lagerorte/neu', { method: 'POST', form: { _csrf: token, name: 'Schrank 1' } });
check('doppelter Name wird abgelehnt', r.status === 302 && (await req('/lagerorte')).text.includes('gibt es schon'));

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

r = await req(`/lagerort/${schrank}`);
check('Lagerort zeigt 10 × Jacke', r.text.includes('10 ×') && r.text.includes('Jacke'));
check('Lagerort zeigt 20 × Schuhe', r.text.includes('20 ×') && r.text.includes('Schuhe'));
check('Lagerort zeigt Größen', r.text.includes('Gr. 176') && r.text.includes('Gr. 38'));

const angemeldet = cookie;
cookie = '';
r = await req(`/lagerort/${schrank}`);
check('Lagerort ohne Login lesbar (QR-Ziel)', r.status === 200 && r.text.includes('Schrank 1'));
cookie = angemeldet;

r = await req('/qr');
check('QR-Seite enthält Lagerort-Etikett', r.text.includes(`/lagerort/${schrank}`) && r.text.includes('Lagerorte'));

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
  form: { _csrf: token, to_size: '188', reason: 'zu klein', note: 'wächst schnell' },
});
check('ohne Lagertreffer wird Aufgabe angelegt', r.status === 302 && r.location === '/aufgaben', r.location);

r = await req('/aufgaben');
check('Aufgabe erscheint im Tab', r.text.includes('188') && r.text.includes('wächst schnell'));
check('Aufgabe nennt das Mitglied', r.text.includes('Max Muster'));
check('Zähler in der Navigation', r.text.includes('zaehler'));

const aufgabeId = Number(r.text.match(/\/aufgaben\/(\d+)\/erledigt/)?.[1]);
token = await csrf('/aufgaben');
r = await req(`/aufgaben/${aufgabeId}/erledigt`, { method: 'POST', form: { _csrf: token } });
check('Aufgabe abhakbar', r.status === 302);
r = await req('/aufgaben');
check('erledigte Aufgabe nicht mehr offen', !r.text.includes('wächst schnell'));
r = await req('/aufgaben?status=erledigt');
check('erledigte Aufgabe im Archiv', r.text.includes('wächst schnell'));

console.log('\n16) Kontrolle: Skip bei Verlust');
// Zweite Jacke Gr. 182 ins Lager, damit es etwas zu tauschen gibt.
token = await csrf('/lager');
await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '1', size: '182', anzahl: '2' },
});

const fund182 = { _csrf: token, size: '182', storage_id: String(schrank), condition: 'gut' };
r = await req(`/ausruestung/${ersatzId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fund182, alt_pruefung: '', neu_pruefung: 'NEU-182-A', verbleib: 'lager' },
});
check('ohne Eingabe am alten Teil wird abgelehnt', r.status === 400 && r.text.includes('Inventarnummer des alten Teils'));

r = await req(`/ausruestung/${ersatzId}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fund182, alt_fehlt: '1', skip_grund: 'verloren', neu_pruefung: 'NEU-182-A', verbleib: 'lager' },
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
// Genau ein Lagerteil in Gr. 194, und das hat eine Inventarnummer. Damit gibt es
// kein nummernloses Teil mehr, dem eine falsche Nummer zugewiesen werden könnte.
token = await csrf('/lager');
await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: `lager:${schrank}`, type_id: '1', size: '194', inventory_no: 'LAGER-194' },
});

r = await req(`/spint/${boys01.id}/bearbeiten`);
const jacke182 = idAusZeile(r.text, 'NEU-182-A');
const fund194 = { _csrf: token, size: '194', storage_id: String(schrank), condition: 'gut' };

r = await req(`/ausruestung/${jacke182}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fund194, alt_pruefung: 'NEU-182-A', neu_pruefung: 'FALSCHE-NUMMER', verbleib: 'lager' },
});
check('fremde Nummer am neuen Teil wird abgelehnt',
  r.status === 400 && r.text.includes('gehört zu keinem Teil an dieser Fundstelle'), String(r.status));

r = await req(`/ausruestung/${jacke182}/tauschen/ausfuehren`, {
  method: 'POST',
  form: { ...fund194, alt_pruefung: 'NEU-182-A', neu_pruefung: 'lager-194', verbleib: 'lager' },
});
check('richtige Nummer wird akzeptiert (Groß-/Kleinschreibung egal)', r.status === 302, String(r.status));

console.log('\n15) Größenschritte im Formular');
r = await req(`/ausruestung/${ersatzId}/tauschen`);
check('Vorschlag aus 176: eine Nummer größer = 182', r.text.includes('182'));
check('Vorschlag aus 176: eine Nummer kleiner = 170', r.text.includes('170'));

// Schuhe: 38 + 2 Nummern = 40
r = await req(`/spint/${boys01.id}/bearbeiten`);
token = await csrf('/lager');
r = await req('/ausruestung/neu', {
  method: 'POST',
  form: { _csrf: token, zurueck: '/lager', ziel: 'lager', type_id: '5', size: '38', anzahl: '1' },
});
r = await req('/lager?q=38');
const schuhId = Number(r.text.match(/\/ausruestung\/(\d+)\/verschieben/)?.[1]);
r = await req(`/ausruestung/${schuhId}/tauschen`);
check('Schuh 38: zwei Nummern größer = 40', r.text.includes('40'));

console.log(fails === 0 ? '\nAlles grün.\n' : `\n${fails} Fehler.\n`);
process.exit(fails ? 1 : 0);
