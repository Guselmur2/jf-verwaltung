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

const aufgabeId = Number(r.text.match(/\/aufgaben\/(\d+)\/erledigt/)?.[1]);
token = await csrf('/aufgaben');
r = await req(`/aufgaben/${aufgabeId}/erledigt`, { method: 'POST', form: { _csrf: token } });
check('Aufgabe abhakbar', r.status === 302);
r = await req('/aufgaben');
check('erledigte Aufgabe nicht mehr offen', !r.text.includes('wächst schnell'));
r = await req('/aufgaben?status=erledigt');
check('erledigte Aufgabe im Archiv', r.text.includes('wächst schnell'));

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

console.log(fails === 0 ? '\nAlles grün.\n' : `\n${fails} Fehler.\n`);
process.exit(fails ? 1 : 0);
