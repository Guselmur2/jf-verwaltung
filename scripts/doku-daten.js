'use strict';

// Baut den Bestand auf, mit dem die Bilder in docs/ entstanden sind.
//
//   DATA_DIR=data-doku node scripts/doku-daten.js --force
//
// Alle Namen, Daten und Einschaetzungen sind frei erfunden. Das ist kein
// Zufall, sondern Voraussetzung: die Bilder liegen in einem oeffentlichen
// Repository, und dort haben Namen und Kleidergroessen echter Kinder nichts zu
// suchen. Wer die Doku neu bauen will, nimmt diesen Bestand — nicht den eigenen.
//
// Der Bestand ist absichtlich "gebraucht": halb gefuellte Spinte, offene
// Aufgaben, ein verlorenes Paar Handschuhe, Anwesenheit ueber ein Vierteljahr.
// Auf leeren Seiten sieht man nicht, was die Software kann.

process.env.DATA_DIR = process.env.DATA_DIR || require('path').join(__dirname, '..', 'data-doku');

const { db, init, DB_FILE } = require('../src/db');

init();

const auth = require('../src/auth');
const { neuerToken } = require('../src/tokens');
const force = process.argv.includes('--force');

if (auth.hasUsers() && !force) {
  console.error(`In ${DB_FILE} stehen schon Daten. Mit --force wird neu aufgebaut.`);
  process.exit(1);
}

if (force) {
  db.exec(`
    DELETE FROM team_mitglieder; DELETE FROM teams; DELETE FROM anwesenheit;
    DELETE FROM termine; DELETE FROM einschaetzung; DELETE FROM funktion_eignung;
    DELETE FROM trennen; DELETE FROM tasks; DELETE FROM equipment; DELETE FROM lockers;
    DELETE FROM storages; DELETE FROM gender_area; DELETE FROM areas;
    DELETE FROM members; DELETE FROM users; DELETE FROM audit_log; DELETE FROM sessions;
    DELETE FROM api_tokens; DELETE FROM settings; DELETE FROM assets;
  `);
}

// --------------------------------------------------------------- Hilfsmittel

/** Datum vor n Tagen als ISO — der Bestand soll immer "gerade eben" aussehen. */
function vorTagen(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const typ = {};
for (const t of db.prepare('SELECT id, name FROM equipment_types').all()) typ[t.name] = t.id;

// Ein Logo, damit der Kopf der Seiten und die Etiketten vollstaendig aussehen.
// Erfundenes Wappen, kein echtes Abzeichen einer Wehr.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <path d="M60 4 108 20v46c0 26-20 42-48 50C32 108 12 92 12 66V20z" fill="#c0261f"/>
  <path d="M60 12 100 25v41c0 21-16 35-40 42-24-7-40-21-40-42V25z" fill="#fff"/>
  <path d="M60 22 94 33v33c0 17-13 28-34 34-21-6-34-17-34-34V33z" fill="#1c2a4a"/>
  <path d="M60 40c8 9 4 14 8 18 3-2 4-5 4-8 5 6 7 12 7 17 0 10-8 17-19 17s-19-7-19-17c0-9 6-18 19-27z"
        fill="#ffb300"/>
  <text x="60" y="104" font-family="system-ui, sans-serif" font-size="13" font-weight="700"
        text-anchor="middle" fill="#fff">JF</text>
</svg>`;

// --------------------------------------------------------------------- Daten

db.transaction(() => {
  // Zwei Betreuer, damit die Rollen sichtbar werden.
  auth.createUser({ name: 'Anna Musterwart', username: 'jugendwart', password: 'doku1234', role: 'jugendwart' });
  auth.createUser({ name: 'Bernd Beispiel', username: 'betreuer', password: 'doku1234', role: 'betreuer' });

  for (const [k, w] of Object.entries({
    organisation: 'Jugendfeuerwehr Musterbach',
    abteilung: 'Jugendfeuerwehr',
    slogan: 'Wir sind die Helden von morgen!',
    dienst_beginn: '17:45',
    dienst_ende: '19:30',
  })) {
    db.prepare('INSERT INTO settings (schluessel, wert) VALUES (?, ?)').run(k, w);
  }
  db.prepare("INSERT INTO assets (name, mime, daten) VALUES ('logo', 'image/svg+xml', ?)").run(Buffer.from(LOGO));

  // ------------------------------------------------------- Bereiche, Spinte
  const bereich = db.prepare('INSERT INTO areas (name, numbering, sort_order) VALUES (?, ?, ?)');
  const jungs = bereich.run('Umkleide Jungs', 'eigen', 100).lastInsertRowid;
  const maedels = bereich.run('Umkleide Mädels', 'eigen', 110).lastInsertRowid;
  db.prepare('INSERT INTO gender_area (gender, area_id) VALUES (?, ?)').run('m', jungs);
  db.prepare('INSERT INTO gender_area (gender, area_id) VALUES (?, ?)').run('w', maedels);

  const mitgliedAnlegen = db.prepare('INSERT INTO members (name, birthday, gender, phone, note) VALUES (?, ?, ?, ?, ?)');
  // Alle Namen erfunden. Geburtsjahre 2010–2016, also 10–16 Jahre.
  const KINDER = [
    ['Ben Adler', '2011-03-14', 'm', '0151 1230001', ''],
    ['Finn Wagner', '2012-07-02', 'm', '', ''],
    ['Jonas Kern', '2010-11-23', 'm', '0151 1230003', 'Fährt mit dem Rad, kommt manchmal später.'],
    ['Luis Brandt', '2013-01-30', 'm', '', ''],
    ['Mika Sommer', '2014-05-18', 'm', '', 'Erst seit Februar dabei.'],
    ['Noah Reiter', '2011-09-09', 'm', '0151 1230006', ''],
    ['Paul Fuchs', '2012-12-05', 'm', '', ''],
    ['Tim Vogel', '2015-04-21', 'm', '', 'Schnuppert noch.'],
    ['Emma Lindner', '2010-08-16', 'w', '0151 1230009', ''],
    ['Ida Petersen', '2012-02-11', 'w', '', ''],
    ['Lea Bruns', '2011-06-27', 'w', '0151 1230011', ''],
    ['Mia Falk', '2013-10-03', 'w', '', ''],
    ['Nele Sander', '2014-12-19', 'w', '', ''],
    ['Zoe Herrmann', '2016-02-08', 'w', '', 'Kommt aus der Kinderfeuerwehr.'],
  ];
  const kind = {};
  for (const k of KINDER) kind[k[0]] = mitgliedAnlegen.run(...k).lastInsertRowid;

  const spintAnlegen = db.prepare(
    'INSERT INTO lockers (code, token, area_id, member_id, location, note) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const spint = {};
  const spintFuer = (code, ber, name, ort, note = '') => {
    spint[name || `${ber}-${code}`] = spintAnlegen.run(
      code, neuerToken(), ber, name ? kind[name] : null, ort, note
    ).lastInsertRowid;
  };
  spintFuer('01', jungs, 'Ben Adler', 'Umkleide links');
  spintFuer('02', jungs, 'Finn Wagner', 'Umkleide links');
  spintFuer('03', jungs, 'Jonas Kern', 'Umkleide links');
  spintFuer('04', jungs, 'Luis Brandt', 'Umkleide links');
  spintFuer('05', jungs, 'Mika Sommer', 'Umkleide rechts');
  spintFuer('06', jungs, 'Noah Reiter', 'Umkleide rechts');
  spintFuer('07', jungs, 'Paul Fuchs', 'Umkleide rechts');
  spintFuer('08', jungs, null, 'Umkleide rechts', 'Tür klemmt, Schloss neu.');
  spintFuer('01', maedels, 'Emma Lindner', 'Umkleide vorn');
  spintFuer('02', maedels, 'Ida Petersen', 'Umkleide vorn');
  spintFuer('03', maedels, 'Lea Bruns', 'Umkleide vorn');
  spintFuer('04', maedels, 'Mia Falk', 'Umkleide hinten');
  spintFuer('05', maedels, 'Nele Sander', 'Umkleide hinten');
  spintFuer('06', maedels, null, 'Umkleide hinten');

  // ------------------------------------------------------------- Lagerorte
  const lagerAnlegen = db.prepare(
    'INSERT INTO storages (name, token, location, note, is_default, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const schrank = lagerAnlegen.run('Schrank 1', neuerToken(), 'Gerätehaus, Raum 2', 'Jacken und Hosen', 1, 100).lastInsertRowid;
  const regal = lagerAnlegen.run('Regal Schuhe', neuerToken(), 'Keller, hinten links', '', 0, 110).lastInsertRowid;
  const kiste = lagerAnlegen.run('Kiste Helme', neuerToken(), 'Gerätehaus, Raum 2', '', 0, 120).lastInsertRowid;

  // ------------------------------------------------------------ Ausrüstung
  const teilAnlegen = db.prepare(
    'INSERT INTO equipment (type_id, size, inventory_no, condition, note, locker_id, storage_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  let nr = 1000;
  const inSpint = (art, groesse, spintId, zustand = 'gut', note = '') =>
    teilAnlegen.run(
      typ[art], groesse, typ[art] === typ.Handschuhe ? null : `JF-${++nr}`, zustand, note, spintId, null
    ).lastInsertRowid;
  const imLager = (art, groesse, ort, zustand = 'gut', note = '') =>
    teilAnlegen.run(
      typ[art], groesse, typ[art] === typ.Handschuhe ? null : `JF-${++nr}`, zustand, note, null, ort
    ).lastInsertRowid;

  // Spinte: absichtlich unvollständig — so zeigt die Übersicht, was fehlt.
  const AUSSTATTUNG = [
    ['Ben Adler', { Jacke: '158', Hose: '158', Helm: null, Handschuhe: '8', Schuhe: '39' }],
    ['Finn Wagner', { Jacke: '152', Hose: '152', Helm: null, Handschuhe: '7' }],
    ['Jonas Kern', { Jacke: '170', Hose: '170', Helm: null, Handschuhe: '9', Schuhe: '42' }],
    ['Luis Brandt', { Jacke: '146', Hose: '146' }],
    ['Mika Sommer', { Jacke: '134', Handschuhe: '6' }],
    ['Noah Reiter', { Jacke: '164', Hose: '164', Helm: null, Schuhe: '40' }],
    ['Paul Fuchs', { Jacke: '152', Hose: '146', Helm: null }],
    ['Emma Lindner', { Jacke: '176', Hose: '176', Helm: null, Handschuhe: '8', Schuhe: '39' }],
    ['Ida Petersen', { Jacke: '152', Hose: '152', Handschuhe: '7' }],
    ['Lea Bruns', { Jacke: '164', Hose: '164', Helm: null, Schuhe: '38' }],
    ['Mia Falk', { Jacke: '140', Hose: '140' }],
    ['Nele Sander', { Jacke: '134' }],
  ];
  for (const [name, sachen] of AUSSTATTUNG) {
    for (const [art, groesse] of Object.entries(sachen)) inSpint(art, groesse, spint[name]);
  }

  // Ein gebrauchtes und ein defektes Teil, damit die Zustände vorkommen.
  db.prepare("UPDATE equipment SET condition = 'gebraucht' WHERE inventory_no = 'JF-1004'").run();
  db.prepare("UPDATE equipment SET condition = 'defekt', note = 'Reißverschluss klemmt' WHERE inventory_no = 'JF-1018'").run();

  // Lager: Nachschub in verschiedenen Größen.
  for (const g of ['128', '134', '140', '146', '152', '158', '164', '170']) imLager('Jacke', g, schrank);
  for (const g of ['128', '140', '152', '158', '164']) imLager('Hose', g, schrank);
  for (const g of ['36', '37', '38', '40', '41', '43']) imLager('Schuhe', g, regal);
  for (let i = 0; i < 4; i++) imLager('Helm', null, kiste);
  // Handschuhe ohne Inventarnummer, mehrere Paare je Größe (Massen-Einbuchung).
  for (const [g, anzahl] of [['6', 3], ['7', 4], ['8', 2], ['9', 2]]) {
    for (let i = 0; i < anzahl; i++) imLager('Handschuhe', g, schrank);
  }

  // Ein ausgemustertes Teil.
  const alt = imLager('Jacke', '128', schrank, 'defekt', 'Naht aufgegangen, nicht reparabel');
  db.prepare('UPDATE equipment SET retired = 1 WHERE id = ?').run(alt);

  // ------------------------------------------------------------- Aufgaben
  const aufgabe = db.prepare(
    'INSERT INTO tasks (kind, status, equipment_id, type_id, member_id, locker_id, from_size, to_size, ' +
      'reason, note, created_at, created_by, done_at, done_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  // Offen: Mika ist aus der Jacke gewachsen, im Lager liegt nichts Passendes.
  aufgabe.run('tausch', 'offen', null, typ.Jacke, kind['Mika Sommer'], spint['Mika Sommer'],
    '134', '140', 'zu klein', 'Nächste Bestellung mitnehmen.', `${vorTagen(6)} 19:12`, 'Anna Musterwart', null, null);
  // Offen: Handschuhe verloren.
  aufgabe.run('bestellung', 'offen', null, typ.Handschuhe, kind['Tim Vogel'], null,
    null, '6', 'verloren', 'Beim Zeltlager liegen geblieben.', `${vorTagen(3)} 18:40`, 'Bernd Beispiel', null, null);
  // Erledigt: schon besorgt.
  aufgabe.run('tausch', 'erledigt', null, typ.Hose, kind['Paul Fuchs'], spint['Paul Fuchs'],
    '140', '146', 'zu klein', '', `${vorTagen(27)} 18:55`, 'Anna Musterwart', `${vorTagen(13)} 19:30`, 'Anna Musterwart');

  // -------------------------------------------------- Übungsabende, Anwesenheit
  const terminAnlegen = db.prepare('INSERT INTO termine (datum, thema, created_by) VALUES (?, ?, ?)');
  const anwesend = db.prepare('INSERT INTO anwesenheit (termin_id, member_id, status) VALUES (?, ?, ?)');
  const ABENDE = [
    [70, 'Schlauchkunde'],
    [56, 'Knoten und Stiche'],
    [42, 'Löschangriff nach FwDV 3'],
    [28, 'Erste Hilfe'],
    [14, 'Gerätekunde TSF-W'],
    [7, 'Wasserentnahme aus offenem Gewässer'],
    [0, 'Löschangriff üben'],   // heute — damit die Anwesenheitsliste "live" aussieht
  ];
  const namen = KINDER.map((k) => k[0]);
  const termine = [];
  ABENDE.forEach(([tage, thema], abend) => {
    const t = terminAnlegen.run(vorTagen(tage), thema, 'Anna Musterwart').lastInsertRowid;
    termine.push(t);
    namen.forEach((name, i) => {
      // Zoe kommt erst seit dem vierten Abend dazu, Tim schnuppert seit dem fünften.
      if (name === 'Zoe Herrmann' && abend < 3) return;
      if (name === 'Tim Vogel' && abend < 4) return;
      // Ein wiederholbares Muster statt Zufall: die Doku soll reproduzierbar sein.
      const rest = (i * 3 + abend * 5) % 11;
      const status = rest === 0 ? 'entschuldigt' : rest === 7 ? 'fehlt' : 'da';
      anwesend.run(t, kind[name], status);
    });
  });

  // Teams vom letzten Abend — daraus ergibt sich, wer welche Funktion zuletzt
  // hatte, und die Einteilung kann Wiederholungen vermeiden.
  const teamAnlegen = db.prepare('INSERT INTO teams (termin_id, nummer, name) VALUES (?, ?, ?)');
  const teamMitglied = db.prepare('INSERT INTO team_mitglieder (team_id, member_id, funktion) VALUES (?, ?, ?)');
  // Absichtlich der Abend VOR heute: so gibt es einen Verlauf, aus dem die
  // Einteilung ablesen kann, wer welche Funktion zuletzt hatte — und die Seite
  // fuer heute ist noch frei.
  const letzter = termine[termine.length - 2];
  const t1 = teamAnlegen.run(letzter, 1, 'Gruppe 1').lastInsertRowid;
  for (const [name, f] of [
    ['Jonas Kern', 'gruppenfuehrer'], ['Tim Vogel', 'maschinist'], ['Nele Sander', 'melder'],
    ['Ben Adler', 'angriff_f'], ['Mika Sommer', 'angriff_m'],
    ['Lea Bruns', 'wasser_f'], ['Mia Falk', 'wasser_m'],
  ]) teamMitglied.run(t1, kind[name], f);
  const t2 = teamAnlegen.run(letzter, 2, 'Gruppe 2').lastInsertRowid;
  for (const [name, f] of [
    ['Emma Lindner', 'gruppenfuehrer'], ['Zoe Herrmann', 'maschinist'], ['Luis Brandt', 'melder'],
    ['Noah Reiter', 'angriff_f'], ['Finn Wagner', 'angriff_m'],
    ['Ida Petersen', 'wasser_f'], ['Paul Fuchs', 'wasser_m'],
  ]) teamMitglied.run(t2, kind[name], f);

  // ------------------------------------------------- Einschätzung und Eignung
  const einschaetzen = db.prepare(
    'INSERT INTO einschaetzung (member_id, erfahrung, zupacken, anleiten, geaendert_von) VALUES (?, ?, ?, ?, ?)'
  );
  // Drei Achsen, keine Gesamtnote — bewusst durchmischt, damit man sieht, dass
  // hier keine Rangliste entsteht.
  const WERTE = {
    'Ben Adler': [4, 4, 3], 'Finn Wagner': [3, 4, 2], 'Jonas Kern': [5, 3, 5],
    'Luis Brandt': [3, 2, 3], 'Mika Sommer': [2, 5, 2], 'Noah Reiter': [4, 3, 4],
    'Paul Fuchs': [3, 3, 3], 'Tim Vogel': [1, 3, 1], 'Emma Lindner': [5, 4, 5],
    'Ida Petersen': [3, 5, 3], 'Lea Bruns': [4, 2, 4], 'Mia Falk': [2, 4, 2],
    'Nele Sander': [2, 3, 2], 'Zoe Herrmann': [1, 4, 2],
  };
  for (const [name, w] of Object.entries(WERTE)) einschaetzen.run(kind[name], ...w, 'Anna Musterwart');

  const eignung = db.prepare('INSERT INTO funktion_eignung (member_id, funktion, stufe) VALUES (?, ?, ?)');
  // Gruppenführer können wirklich nur wenige — genau darum geht es.
  eignung.run(kind['Jonas Kern'], 'gruppenfuehrer', 'kann');
  eignung.run(kind['Emma Lindner'], 'gruppenfuehrer', 'kann');
  eignung.run(kind['Ben Adler'], 'gruppenfuehrer', 'uebt');
  eignung.run(kind['Lea Bruns'], 'gruppenfuehrer', 'uebt');
  for (const name of ['Ben Adler', 'Jonas Kern', 'Noah Reiter', 'Emma Lindner', 'Lea Bruns']) {
    eignung.run(kind[name], 'truppfuehrer', 'kann');
  }
  for (const name of ['Finn Wagner', 'Ida Petersen', 'Paul Fuchs']) {
    eignung.run(kind[name], 'truppfuehrer', 'uebt');
  }

  // Ein Paar, das nicht zusammen ins Team soll.
  const a = Math.min(kind['Mika Sommer'], kind['Luis Brandt']);
  const b = Math.max(kind['Mika Sommer'], kind['Luis Brandt']);
  db.prepare('INSERT INTO trennen (a_id, b_id, grund) VALUES (?, ?, ?)').run(a, b, 'Albern zusammen nur herum.');

  // -------------------------------------------------------------- Protokoll
  const protokoll = db.prepare(
    'INSERT INTO audit_log (ts, username, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const [tage, name, entity, action, detail] of [
    [27, 'Anna Musterwart', 'ausruestung', 'Tausch angelegt', 'Hose 140 → 146 (zu klein)'],
    [21, 'Bernd Beispiel', 'ausruestung', 'ins Lager gelegt', '6 Paar Handschuhe, Größe 7'],
    [14, 'Anna Musterwart', 'mitglied', 'angelegt', 'Zoe Herrmann'],
    [13, 'Anna Musterwart', 'aufgabe', 'erledigt', 'Hose 146 für Paul Fuchs'],
    [7, 'Bernd Beispiel', 'spint', 'Teil hinzugefügt', 'Handschuhe Größe 8'],
    [3, 'Bernd Beispiel', 'ausruestung', 'Bestellung angelegt', 'Handschuhe 6 (verloren)'],
  ]) {
    protokoll.run(`${vorTagen(tage)} 19:04`, name, entity, null, action, detail);
  }

  // Ein API-Zugang, damit die Seite nicht leer ist. Der Hash gehört zu einem
  // Token, den es nur hier gibt — er taucht in keinem Bild auf.
  db.prepare(
    "INSERT INTO api_tokens (name, token_hash, scope, created_by) VALUES ('Auswertung Excel', ?, 'lesen', 'Anna Musterwart')"
  ).run(require('crypto').createHash('sha256').update('doku-nur-beispiel').digest('hex'));
})();

const zahl = (sql) => db.prepare(sql).get().n;
console.log(`Bestand fuer die Doku in ${DB_FILE}`);
console.log(`  ${zahl('SELECT COUNT(*) AS n FROM members')} Mitglieder`);
console.log(`  ${zahl('SELECT COUNT(*) AS n FROM lockers')} Spinte`);
console.log(`  ${zahl('SELECT COUNT(*) AS n FROM equipment')} Ausruestungsteile`);
console.log(`  ${zahl('SELECT COUNT(*) AS n FROM termine')} Uebungsabende`);
console.log('');
console.log('  Anmeldung: jugendwart / doku1234   (Betreuer: betreuer / doku1234)');
