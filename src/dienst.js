'use strict';

const { db } = require('./db');

// Alles rund um den Übungsabend: Anwesenheit, Einschätzung der Kinder und der
// Ausgleich der Teams. Bewusst getrennt von model.js — die Einschätzungen sind
// die heikelsten Daten in dieser Software, und es hilft, wenn man an einer
// Stelle nachsehen kann, wer sie anfasst.

// ------------------------------------------------------------------ Termine

const STATUS = { da: 'da', entschuldigt: 'entschuldigt', fehlt: 'fehlt' };
const STATUS_REIHE = ['da', 'entschuldigt', 'fehlt'];

// Puffer um den Uebungsabend herum. Vorne wenig — da wird aufgebaut und die
// Anwesenheit erfasst. Hinten grosszuegig, weil ein Abend selten puenktlich
// endet und danach noch eingeraeumt und nachgetragen wird.
const VORLAUF_MIN = 10;
const NACHLAUF_MIN = 45;

function minutenAusUhrzeit(text, ersatz) {
  const m = String(text ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return ersatz;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Das Zeitfenster, in dem man den Pi besser in Ruhe laesst — Dienstzeit aus
 * den Stammdaten, davor und danach ein Puffer. Endet der Dienst nach
 * Mitternacht, wird trotzdem richtig gerechnet.
 */
function dienstfenster(jetzt = new Date()) {
  const stamm = require('./settings').alle();
  const beginn = minutenAusUhrzeit(stamm.dienst_beginn, 17 * 60 + 45) - VORLAUF_MIN;
  let ende = minutenAusUhrzeit(stamm.dienst_ende, 19 * 60 + 30) + NACHLAUF_MIN;
  if (ende <= beginn) ende += 24 * 60; // ueber Mitternacht

  // Das Fenster kann in beide Richtungen ueber Mitternacht reichen: nach hinten,
  // wenn der Dienst spaet endet, und nach vorn, wenn er kurz nach Mitternacht
  // beginnt (dann ist beginn negativ). Beide Seiten muessen zaehlen.
  const minuten = jetzt.getHours() * 60 + jetzt.getMinutes();
  const drin = [minuten, minuten + 24 * 60, minuten - 24 * 60].some((m) => m >= beginn && m <= ende);

  const alsText = (m) => {
    const g = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(g / 60)).padStart(2, '0')}:${String(g % 60).padStart(2, '0')}`;
  };

  return {
    drin,
    von: alsText(beginn),
    bis: alsText(ende),
    dienst_beginn: stamm.dienst_beginn,
    dienst_ende: stamm.dienst_ende,
    vorlauf: VORLAUF_MIN,
    nachlauf: NACHLAUF_MIN,
  };
}

/** Heute als ISO-Datum, nach lokaler Zeit (nicht UTC — sonst kippt es abends). */
function heute() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function termine(grenze = 50) {
  return db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM anwesenheit a WHERE a.termin_id = t.id AND a.status = 'da') AS da,
              (SELECT COUNT(*) FROM anwesenheit a WHERE a.termin_id = t.id) AS erfasst,
              (SELECT COUNT(*) FROM teams k WHERE k.termin_id = t.id) AS teams
         FROM termine t
        ORDER BY t.datum DESC
        LIMIT ?`
    )
    .all(grenze);
}

function terminById(id) {
  return db.prepare('SELECT * FROM termine WHERE id = ?').get(id) || null;
}

function terminByDatum(datum) {
  return db.prepare('SELECT * FROM termine WHERE datum = ?').get(datum) || null;
}

/** Neuester Termin — darauf landet man, wenn man "Anwesenheit" aufruft. */
function letzterTermin() {
  return db.prepare('SELECT * FROM termine ORDER BY datum DESC LIMIT 1').get() || null;
}

/** Legt einen Termin an oder liefert den vorhandenen zu diesem Datum. */
function terminAnlegen({ datum, thema = null, note = null, von = null }) {
  const vorhanden = terminByDatum(datum);
  if (vorhanden) return vorhanden;
  const info = db
    .prepare('INSERT INTO termine (datum, thema, note, created_by) VALUES (?, ?, ?, ?)')
    .run(datum, thema, note, von);
  return terminById(info.lastInsertRowid);
}

function terminAendern(id, { thema, note }) {
  db.prepare('UPDATE termine SET thema = ?, note = ? WHERE id = ?').run(thema || null, note || null, id);
  return terminById(id);
}

function terminLoeschen(id) {
  return db.prepare('DELETE FROM termine WHERE id = ?').run(id).changes > 0;
}

// -------------------------------------------------------------- Anwesenheit

/**
 * Alle aktiven Mitglieder mit ihrem Status zu diesem Termin. Kein Eintrag
 * bedeutet "noch nicht angetippt" — das ist etwas anderes als "fehlt".
 */
function anwesenheit(terminId) {
  return db
    .prepare(
      `SELECT m.id, m.name, m.gender, a.status
         FROM members m
         LEFT JOIN anwesenheit a ON a.member_id = m.id AND a.termin_id = @termin
        WHERE m.active = 1
        ORDER BY m.name COLLATE NOCASE`
    )
    .all({ termin: terminId });
}

/** Setzt einen Status. status = null loescht den Eintrag wieder. */
function statusSetzen(terminId, memberId, status) {
  if (!status) {
    db.prepare('DELETE FROM anwesenheit WHERE termin_id = ? AND member_id = ?').run(terminId, memberId);
    return null;
  }
  if (!STATUS[status]) throw Object.assign(new Error(`Unbekannter Status "${status}".`), { code: 'STATUS' });
  db.prepare(
    "INSERT INTO anwesenheit (termin_id, member_id, status, geaendert) VALUES (?, ?, ?, datetime('now')) " +
      "ON CONFLICT(termin_id, member_id) DO UPDATE SET status = excluded.status, geaendert = excluded.geaendert"
  ).run(terminId, memberId, status);
  return status;
}

/** Der naechste Status beim Antippen: da → entschuldigt → fehlt → nichts. */
function naechsterStatus(aktuell) {
  const i = STATUS_REIHE.indexOf(aktuell);
  if (i === -1) return 'da';
  return STATUS_REIHE[i + 1] || null;
}

/** Alle auf einmal setzen — "alle da" als Startpunkt, dann die Lücken tippen. */
function alleSetzen(terminId, status) {
  const mitglieder = db.prepare('SELECT id FROM members WHERE active = 1').all();
  db.transaction(() => {
    for (const m of mitglieder) statusSetzen(terminId, m.id, status);
  })();
  return mitglieder.length;
}

/**
 * Anwesenheitsquote je Kind. Bezugsgroesse ist die Zahl der Termine, bei denen
 * fuer das Kind ueberhaupt etwas erfasst wurde — wer erst seit Herbst dabei
 * ist, soll nicht an den Terminen davor gemessen werden.
 */
function quoten() {
  const gesamt = db.prepare('SELECT COUNT(*) AS n FROM termine').get().n;
  const zeilen = db
    .prepare(
      `SELECT m.id, m.name,
              SUM(CASE WHEN a.status = 'da' THEN 1 ELSE 0 END) AS da,
              SUM(CASE WHEN a.status = 'entschuldigt' THEN 1 ELSE 0 END) AS entschuldigt,
              SUM(CASE WHEN a.status = 'fehlt' THEN 1 ELSE 0 END) AS fehlt,
              COUNT(a.status) AS erfasst
         FROM members m
         LEFT JOIN anwesenheit a ON a.member_id = m.id
        WHERE m.active = 1
        GROUP BY m.id
        ORDER BY m.name COLLATE NOCASE`
    )
    .all();
  return {
    termine: gesamt,
    zeilen: zeilen.map((z) => ({
      ...z,
      quote: z.erfasst ? Math.round((z.da / z.erfasst) * 100) : null,
    })),
  };
}

// ------------------------------------------------------------ Einschaetzung

const MERKMALE = [
  { feld: 'erfahrung', label: 'Erfahrung', hilfe: 'wie viel kann er/sie schon' },
  { feld: 'zupacken', label: 'Zupacken', hilfe: 'körperlich, praktisch, Schlauch und Leiter' },
  { feld: 'anleiten', label: 'Anleiten', hilfe: 'übernimmt, hilft anderen, bleibt ruhig' },
];

const MITTE = 3;

/**
 * Einschaetzungen aller aktiven Kinder, immer alphabetisch.
 *
 * Bewusst NICHT nach Werten sortierbar: eine nach Punkten geordnete Liste waere
 * eine Rangliste, und die soll hier nicht entstehen. Aus demselben Grund gibt
 * es auch keine Gesamtsumme je Kind in der Anzeige.
 */
function einschaetzungen() {
  return db
    .prepare(
      `SELECT m.id, m.name,
              COALESCE(e.erfahrung, ${MITTE}) AS erfahrung,
              COALESCE(e.zupacken,  ${MITTE}) AS zupacken,
              COALESCE(e.anleiten,  ${MITTE}) AS anleiten,
              e.member_id IS NOT NULL AS erfasst,
              e.geaendert, e.geaendert_von
         FROM members m
         LEFT JOIN einschaetzung e ON e.member_id = m.id
        WHERE m.active = 1
        ORDER BY m.name COLLATE NOCASE`
    )
    .all();
}

function begrenze(wert) {
  const n = Math.round(Number(wert));
  if (!Number.isFinite(n)) return MITTE;
  return Math.min(5, Math.max(1, n));
}

/** Speichert die drei Merkmale eines Kindes. Liefert die geaenderten Felder. */
function einschaetzungSetzen(memberId, werte, von = null) {
  const alt = db.prepare('SELECT * FROM einschaetzung WHERE member_id = ?').get(memberId);
  const neu = {};
  for (const { feld } of MERKMALE) {
    neu[feld] = feld in werte ? begrenze(werte[feld]) : alt ? alt[feld] : MITTE;
  }

  db.prepare(
    'INSERT INTO einschaetzung (member_id, erfahrung, zupacken, anleiten, geaendert, geaendert_von) ' +
      "VALUES (@id, @erfahrung, @zupacken, @anleiten, datetime('now'), @von) " +
      'ON CONFLICT(member_id) DO UPDATE SET erfahrung = excluded.erfahrung, zupacken = excluded.zupacken, ' +
      'anleiten = excluded.anleiten, geaendert = excluded.geaendert, geaendert_von = excluded.geaendert_von'
  ).run({ id: memberId, ...neu, von });

  const geaendert = MERKMALE.map((m) => m.feld).filter((f) => !alt || alt[f] !== neu[f]);
  return { werte: neu, geaendert };
}

// ------------------------------------------------------- "nicht zusammen"

const paarKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function trennPaare() {
  return db
    .prepare(
      `SELECT t.a_id, t.b_id, t.grund, ma.name AS a_name, mb.name AS b_name
         FROM trennen t
         JOIN members ma ON ma.id = t.a_id
         JOIN members mb ON mb.id = t.b_id
        ORDER BY ma.name COLLATE NOCASE, mb.name COLLATE NOCASE`
    )
    .all();
}

function trennenSetzen(aId, bId, grund = null) {
  const a = Math.min(Number(aId), Number(bId));
  const b = Math.max(Number(aId), Number(bId));
  if (!a || !b || a === b) return false;
  db.prepare('INSERT OR REPLACE INTO trennen (a_id, b_id, grund) VALUES (?, ?, ?)').run(a, b, grund || null);
  return true;
}

function trennenEntfernen(aId, bId) {
  const a = Math.min(Number(aId), Number(bId));
  const b = Math.max(Number(aId), Number(bId));
  return db.prepare('DELETE FROM trennen WHERE a_id = ? AND b_id = ?').run(a, b).changes > 0;
}

// -------------------------------------------------------------- Funktionen

// Die Gruppe nach FwDV 3. Nicht frei konfigurierbar, weil sie genormt ist —
// eine Gruppe hat neun Plaetze, eine Staffel sechs, ein Trupp drei.
//
// eignung: diese Funktion setzt einen Eintrag in funktion_eignung voraus.
// Melder und Truppmann kann jeder, Fuehrungsfunktionen nicht.
const FUNKTIONEN = [
  { key: 'gruppenfuehrer', kurz: 'GF', label: 'Gruppenführer', eignung: 'gruppenfuehrer' },
  // Maschinist braucht in der Jugendfeuerwehr keine Eignung: Fahren und Pumpe
  // bedienen machen die Betreuer, die Kinder assistieren. Der Platz ist im
  // Gegenteil der beste fuer jemanden, der erst schnuppert — hier steht ein
  // Betreuer eins zu eins daneben. Darum "schnuppern" statt "eignung".
  { key: 'maschinist', kurz: 'MA', label: 'Maschinist', schnuppern: true },
  { key: 'melder', kurz: 'Me', label: 'Melder' },
  { key: 'angriff_f', kurz: 'AF', label: 'Angriffstruppführer', eignung: 'truppfuehrer' },
  { key: 'angriff_m', kurz: 'AM', label: 'Angriffstruppmann' },
  { key: 'wasser_f', kurz: 'WF', label: 'Wassertruppführer', eignung: 'truppfuehrer' },
  { key: 'wasser_m', kurz: 'WM', label: 'Wassertruppmann' },
  { key: 'schlauch_f', kurz: 'SF', label: 'Schlauchtruppführer', eignung: 'truppfuehrer' },
  { key: 'schlauch_m', kurz: 'SM', label: 'Schlauchtruppmann' },
];

const FUNKTION = Object.fromEntries(FUNKTIONEN.map((f) => [f.key, f]));

// Die Eignungen, die man je Kind pflegen kann. Nur die Fuehrungsfunktionen —
// alles andere kann jeder, und was man nicht pflegen muss, pflegt man auch nicht
// falsch.
const EIGNUNGEN = [
  { key: 'gruppenfuehrer', label: 'Gruppenführer' },
  { key: 'truppfuehrer', label: 'Truppführer' },
];

// Die Plaetze stehen in der Reihenfolge, in der sie besetzt werden — und damit
// auch in der Reihenfolge, in der sie wegfallen, wenn eine Einheit kleiner ist
// als die Aufstellung. Der Gruppenfuehrer steht zuerst: eine Einheit ohne
// Fuehrung ist keine Einheit. Der Melder faellt zuerst weg, danach der
// Schlauchtrupp — damit bleiben die vorderen Trupps vollstaendig.
const AUFSTELLUNGEN = {
  frei: { label: 'Freie Teams', plaetze: null },
  gruppe: {
    label: 'Gruppe (9)',
    plaetze: ['gruppenfuehrer', 'maschinist', 'angriff_f', 'angriff_m', 'wasser_f', 'wasser_m', 'schlauch_f', 'schlauch_m', 'melder'],
  },
  staffel: {
    label: 'Staffel (6)',
    plaetze: ['gruppenfuehrer', 'maschinist', 'angriff_f', 'angriff_m', 'wasser_f', 'wasser_m'],
  },
  trupp: { label: 'Trupp (3)', plaetze: ['angriff_f', 'angriff_m', 'wasser_m'] },
};

/** Eignungen je Kind als Map: memberId → { funktion: stufe }. */
function eignungen() {
  const map = new Map();
  for (const z of db.prepare('SELECT member_id, funktion, stufe FROM funktion_eignung').all()) {
    if (!map.has(z.member_id)) map.set(z.member_id, {});
    map.get(z.member_id)[z.funktion] = z.stufe;
  }
  return map;
}

function eignungSetzen(memberId, funktion, stufe) {
  if (!stufe) {
    db.prepare('DELETE FROM funktion_eignung WHERE member_id = ? AND funktion = ?').run(memberId, funktion);
    return null;
  }
  if (!['kann', 'uebt'].includes(stufe)) throw Object.assign(new Error('Unbekannte Stufe.'), { code: 'STUFE' });
  db.prepare(
    'INSERT INTO funktion_eignung (member_id, funktion, stufe) VALUES (?, ?, ?) ' +
      'ON CONFLICT(member_id, funktion) DO UPDATE SET stufe = excluded.stufe'
  ).run(memberId, funktion, stufe);
  return stufe;
}

/** Kinder mit ihren Eignungen — fuer die Pflegeseite, immer alphabetisch. */
function eignungsListe() {
  const map = eignungen();
  return db
    .prepare('SELECT id, name FROM members WHERE active = 1 ORDER BY name COLLATE NOCASE')
    .all()
    .map((m) => ({ ...m, eignung: map.get(m.id) || {} }));
}

// Gewichte der Rollenverteilung. Die Zahlen entscheiden, wie stark Rotation
// gegen Eignung zieht — hier steckt die Absicht "sie sollen dazulernen".
const E_KANN = 0; //  macht das selbstaendig
const E_UEBT = 30; // soll es lernen, kommt dran wenn die Routinierten pausieren

// Was es kostet, eine Funktion ohne Eignung zu besetzen — je Funktion
// verschieden. Pauschal gleiche Kosten waren ein Fehler: dann sass ein Kind mit
// Gruppenfuehrer-Eignung auf dem Maschinisten, waehrend ein anderes ohne jede
// Eignung den Gruppenfuehrer machte — beide Fehlbesetzungen kosteten dasselbe,
// also war die Wahl willkuerlich.
const E_FEHLT_GEWICHT = { gruppenfuehrer: 1000, truppfuehrer: 400 };
const E_FEHLT = 500; // Vorgabe, falls eine neue Funktion dazukommt

// Schnupperplaetze (Maschinist) gehen eher an die mit wenig Erfahrung — dort
// steht ein Betreuer eins zu eins daneben. Je hoeher die Erfahrung, desto
// teurer der Platz, damit die Routinierten woanders gebraucht werden.
const W_SCHNUPPER = 10;
const R_JE_MAL = 8; //   je frueheres Mal auf diesem Platz, mal Frische
const R_NEU = -5; //     kleiner Anreiz fuer eine Funktion, die das Kind noch nie hatte
const ROTATION_TERMINE = 5;

/**
 * Wie oft hatte wer welche Funktion in den letzten Terminen?
 * Liefert Map "memberId:funktion" → Gewicht (frischer zaehlt schwerer).
 */
function funktionsVerlauf(anzahlTermine = ROTATION_TERMINE, ausserTerminId = null) {
  const termineListe = db
    .prepare(
      `SELECT DISTINCT t.id FROM termine t
         JOIN teams k ON k.termin_id = t.id
        WHERE (@ausser IS NULL OR t.id <> @ausser)
        ORDER BY t.datum DESC LIMIT @grenze`
    )
    .all({ grenze: anzahlTermine, ausser: ausserTerminId });

  const gewichte = new Map();
  termineListe.forEach((t, index) => {
    const frische = Math.max(1, anzahlTermine - index);
    const zeilen = db
      .prepare(
        `SELECT tm.member_id, tm.funktion FROM team_mitglieder tm
           JOIN teams k ON k.id = tm.team_id
          WHERE k.termin_id = ? AND tm.funktion IS NOT NULL`
      )
      .all(t.id);
    for (const z of zeilen) {
      const key = `${z.member_id}:${z.funktion}`;
      gewichte.set(key, (gewichte.get(key) || 0) + R_JE_MAL * frische);
    }
  });
  return gewichte;
}

/** Kosten, ein Kind auf einen Platz zu setzen. Kleiner ist besser. */
function platzKosten(mitglied, funktionKey, eignungMap, verlauf) {
  const f = FUNKTION[funktionKey];
  let k = 0;

  if (f && f.eignung) {
    const stufe = (eignungMap.get(mitglied.id) || {})[f.eignung];
    if (stufe === 'kann') k += E_KANN;
    else if (stufe === 'uebt') k += E_UEBT;
    else k += E_FEHLT_GEWICHT[f.eignung] || E_FEHLT;
  }

  // Schnupperplatz: wer noch wenig kann, ist hier am besten aufgehoben.
  if (f && f.schnuppern) k += (mitglied.erfahrung - 1) * W_SCHNUPPER;

  const bisher = verlauf.get(`${mitglied.id}:${funktionKey}`) || 0;
  k += bisher;
  if (!bisher) k += R_NEU;
  return k;
}

/**
 * Verteilt die Kinder eines Teams auf die Plaetze der Aufstellung.
 *
 * Erst reihum den jeweils guenstigsten Platz besetzen, dann Plaetze tauschen,
 * solange es besser wird. Bei hoechstens neun Plaetzen ist das sofort fertig.
 */
function plaetzeVerteilen(team, plaetze, eignungMap, verlauf) {
  // Nur so viele Plaetze wie Kinder — sonst wandert beim Optimieren ein leerer
  // Platz nach vorn, weil "unbesetzt" nichts kostet und "ungeeignet" viel. So
  // stand eine Einheit ohne Gruppenfuehrer da, waehrend hinten jemand ohne
  // Eignung auf dem Wassertruppfuehrer sass. Lieber die hinteren Plaetze
  // weglassen und das melden.
  const genutzt = plaetze.slice(0, team.length);
  const unbesetzt = plaetze.slice(team.length);
  const zuteilung = genutzt.map((p, i) => ({ funktion: p, mitglied: team[i] }));

  const gesamt = () =>
    zuteilung.reduce((s, z) => s + platzKosten(z.mitglied, z.funktion, eignungMap, verlauf), 0);

  let aktuell = gesamt();
  let besser = true;
  while (besser) {
    besser = false;
    for (let i = 0; i < zuteilung.length && !besser; i++) {
      for (let j = i + 1; j < zuteilung.length && !besser; j++) {
        const a = zuteilung[i].mitglied;
        const b = zuteilung[j].mitglied;
        zuteilung[i].mitglied = b;
        zuteilung[j].mitglied = a;
        const neu = gesamt();
        if (neu < aktuell) {
          aktuell = neu;
          besser = true;
        } else {
          zuteilung[i].mitglied = a;
          zuteilung[j].mitglied = b;
        }
      }
    }
  }

  // "Neu fuer das Kind" nur melden, wenn es ueberhaupt eine Vorgeschichte gibt.
  // Beim ersten Einteilen waere sonst jedes Kind auf jedem Platz "neu" — lauter
  // Hinweise, die nichts sagen.
  const hatVorgeschichte = (id) => [...verlauf.keys()].some((k) => k.startsWith(`${id}:`));

  const besetzt = zuteilung.map((z) => {
    const f = FUNKTION[z.funktion];
    const stufe = f && f.eignung ? (eignungMap.get(z.mitglied.id) || {})[f.eignung] : null;
    return {
      ...z.mitglied,
      funktion: z.funktion,
      funktion_kurz: f ? f.kurz : null,
      funktion_label: f ? f.label : null,
      // Damit der Betreuer weiss, wo er hinschauen muss.
      uebt: stufe === 'uebt',
      ohne_eignung: !!(f && f.eignung && !stufe),
      neu_fuer_kind:
        hatVorgeschichte(z.mitglied.id) && !(verlauf.get(`${z.mitglied.id}:${z.funktion}`) || 0),
    };
  });

  return {
    besetzt,
    // Plaetze, fuer die diese Einheit zu klein ist — der Betreuer soll es sehen
    // und nicht raten muessen.
    unbesetzt: unbesetzt.map((k) => FUNKTION[k]).filter(Boolean),
  };
}

// ------------------------------------------------------------------- Teams

// Gewichte der Zielkonflikte. Ein verbotenes Paar ist teurer als jede
// Unwucht — lieber ein etwas schieferes Team als die zwei zusammen, bei denen
// es immer laut wird.
const W_VERBOTEN = 1000;
const W_MERKMAL = 10;

// Fehlt in einer Einheit jemand, der eine Fuehrungsfunktion uebernehmen kann,
// ist die Einheit nicht einsatzfaehig — das muss schon beim Bilden der Einheiten
// zaehlen, nicht erst beim Verteilen der Plaetze. Sonst steht am Ende ein Kind
// auf dem Gruppenfuehrer, das die Funktion gar nicht kann.
const BEDARF_GEWICHT = { gruppenfuehrer: 400, truppfuehrer: 120 };

/**
 * Wie oft waren zwei Kinder in den letzten Terminen zusammen im Team?
 * Frischer zaehlt schwerer — so mischt sich die Gruppe von Woche zu Woche,
 * ohne dass alte Paarungen fuer immer gesperrt sind.
 */
function letztePaarungen(anzahlTermine = 3, ausserTerminId = null) {
  const termineListe = db
    .prepare(
      `SELECT DISTINCT t.id FROM termine t
         JOIN teams k ON k.termin_id = t.id
        WHERE (@ausser IS NULL OR t.id <> @ausser)
        ORDER BY t.datum DESC LIMIT @grenze`
    )
    .all({ grenze: anzahlTermine, ausser: ausserTerminId });

  const gewichte = new Map();
  termineListe.forEach((t, index) => {
    const gewicht = Math.max(1, anzahlTermine - index); // neuester Termin zaehlt am meisten
    const teamsHier = db.prepare('SELECT id FROM teams WHERE termin_id = ?').all(t.id);
    for (const team of teamsHier) {
      const ids = db
        .prepare('SELECT member_id FROM team_mitglieder WHERE team_id = ?')
        .all(team.id)
        .map((r) => r.member_id);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = paarKey(ids[i], ids[j]);
          gewichte.set(key, (gewichte.get(key) || 0) + gewicht);
        }
      }
    }
  });
  return gewichte;
}

function kosten(teams, verboten, wiederholung, bedarf = [], eignungMap = new Map()) {
  let summe = 0;

  // Unwucht je Merkmal: Spannweite zwischen dem staerksten und schwaechsten Team.
  for (const { feld } of MERKMALE) {
    const werte = teams.map((team) => team.reduce((s, m) => s + m[feld], 0));
    summe += (Math.max(...werte) - Math.min(...werte)) * W_MERKMAL;
  }

  for (const team of teams) {
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const key = paarKey(team[i].id, team[j].id);
        if (verboten.has(key)) summe += W_VERBOTEN;
        summe += wiederholung.get(key) || 0;
      }
    }

    // Kann in dieser Einheit ueberhaupt jemand die Fuehrungsfunktionen?
    for (const b of bedarf) {
      const faehig = team.filter((m) => (eignungMap.get(m.id) || {})[b.eignung]).length;
      if (faehig < b.jeEinheit) {
        summe += (b.jeEinheit - faehig) * (BEDARF_GEWICHT[b.eignung] || 100);
      }
    }
  }
  return summe;
}

/** Reihum verteilen, am Ende umkehren — verteilt Starke gleichmaessig. */
function schlangenzug(liste, anzahlTeams) {
  const teams = Array.from({ length: anzahlTeams }, () => []);
  let i = 0;
  let vorwaerts = true;
  for (const m of liste) {
    teams[i].push(m);
    if (vorwaerts) {
      if (i + 1 < anzahlTeams) i += 1;
      else vorwaerts = false;
    } else if (i - 1 >= 0) {
      i -= 1;
    } else {
      vorwaerts = true;
    }
  }
  return teams;
}

function mischen(liste) {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Teilt die anwesenden Kinder in ausgeglichene Teams.
 *
 * Ausgeglichen heisst hier: jede der drei Achsen ist einzeln moeglichst
 * gleichmaessig verteilt. Nicht "gleich stark im Schnitt" — dann koennte ein
 * Team aus drei Kraeftigen ohne Erfahrung bestehen und ein anderes umgekehrt.
 *
 * Verfahren: mehrfach zufaellig starten, reihum verteilen, dann so lange Kinder
 * zwischen Teams tauschen, wie es besser wird. Bei 16 Kindern ist das in
 * Millisekunden erledigt und liefert praktisch immer das Optimum.
 */
function teamsBilden({
  mitglieder,
  anzahlTeams,
  verboten = new Set(),
  wiederholung = new Map(),
  bedarf = [],
  eignungMap = new Map(),
  versuche = 40,
}) {
  const n = mitglieder.length;
  const t = Math.max(1, Math.min(Number(anzahlTeams) || 2, n));
  if (!n) return { teams: [], kosten: 0, konflikte: [] };

  let bestes = null;
  let bestKosten = Infinity;

  for (let versuch = 0; versuch < versuche; versuch++) {
    // Zufaellig mischen, dann nach Gesamteindruck absteigend — bei gleichen
    // Werten (etwa lauter Voreinstellungen) entscheidet der Zufall, damit
    // "neu mischen" auch wirklich andere Teams ergibt.
    const gesamt = (m) => MERKMALE.reduce((s, k) => s + m[k.feld], 0);
    const sortiert = mischen(mitglieder).sort((a, b) => gesamt(b) - gesamt(a));
    const teams = schlangenzug(sortiert, t);

    let aktuell = kosten(teams, verboten, wiederholung, bedarf, eignungMap);
    let besser = true;
    while (besser) {
      besser = false;
      for (let a = 0; a < teams.length && !besser; a++) {
        for (let b = a + 1; b < teams.length && !besser; b++) {
          for (let i = 0; i < teams[a].length && !besser; i++) {
            for (let j = 0; j < teams[b].length && !besser; j++) {
              [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]];
              const neu = kosten(teams, verboten, wiederholung, bedarf, eignungMap);
              if (neu < aktuell) {
                aktuell = neu;
                besser = true; // von vorn, die Lage hat sich geaendert
              } else {
                [teams[a][i], teams[b][j]] = [teams[b][j], teams[a][i]]; // zurueck
              }
            }
          }
        }
      }
    }

    if (aktuell < bestKosten) {
      bestKosten = aktuell;
      bestes = teams.map((team) => [...team].sort((x, y) => x.name.localeCompare(y.name, 'de')));
    }
  }

  // Blieb ein verbotenes Paar uebrig, muss man das wissen — bei vielen
  // Trennwuenschen und wenigen Teams geht es manchmal nicht anders.
  const konflikte = [];
  bestes.forEach((team, index) => {
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        if (verboten.has(paarKey(team[i].id, team[j].id))) {
          konflikte.push({ team: index + 1, a: team[i].name, b: team[j].name });
        }
      }
    }
  });

  return { teams: bestes, kosten: bestKosten, konflikte };
}

/** Die anwesenden Kinder eines Termins samt Einschaetzung. */
function anwesendeMitWerten(terminId) {
  return db
    .prepare(
      `SELECT m.id, m.name,
              COALESCE(e.erfahrung, ${MITTE}) AS erfahrung,
              COALESCE(e.zupacken,  ${MITTE}) AS zupacken,
              COALESCE(e.anleiten,  ${MITTE}) AS anleiten
         FROM anwesenheit a
         JOIN members m ON m.id = a.member_id
         LEFT JOIN einschaetzung e ON e.member_id = m.id
        WHERE a.termin_id = ? AND a.status = 'da' AND m.active = 1
        ORDER BY m.name COLLATE NOCASE`
    )
    .all(terminId);
}

/** Wie viele Einheiten passen bei dieser Aufstellung zu so vielen Kindern? */
function einheitenVorschlag(anzahlKinder, aufstellungKey) {
  const a = AUFSTELLUNGEN[aufstellungKey];
  if (!a || !a.plaetze) return Math.max(2, Math.min(4, Math.round(anzahlKinder / 4) || 2));
  return Math.max(1, Math.round(anzahlKinder / a.plaetze.length) || 1);
}

/**
 * Einteilung fuer einen Termin: erst ausgeglichene Einheiten bilden, dann —
 * sofern eine Aufstellung gewaehlt ist — innerhalb jeder Einheit die Plaetze
 * besetzen. Beides getrennt, weil es zwei verschiedene Fragen sind: "wer mit
 * wem" und "wer macht was".
 */
function einteilung(terminId, { anzahlTeams, aufstellung = 'frei' } = {}) {
  const anwesend = anwesendeMitWerten(terminId);
  const auf = AUFSTELLUNGEN[aufstellung] ? aufstellung : 'frei';
  const plaetze = AUFSTELLUNGEN[auf].plaetze;
  const anzahl = Number(anzahlTeams) || einheitenVorschlag(anwesend.length, auf);

  const verboten = new Set(trennPaare().map((p) => paarKey(p.a_id, p.b_id)));
  const eignungMap = eignungen();

  // Wie viele Fuehrungsfaehige braucht jede Einheit? Ergibt sich aus der
  // Aufstellung: eine Gruppe hat einen Gruppenfuehrer und drei Truppfuehrer.
  // Das muss beim Bilden der Einheiten schon zaehlen — sonst landet am Ende
  // jemand auf dem Gruppenfuehrer, der die Funktion nicht kann.
  const bedarf = [];
  if (plaetze) {
    const zaehler = {};
    for (const p of plaetze) {
      const f = FUNKTION[p];
      if (f && f.eignung) zaehler[f.eignung] = (zaehler[f.eignung] || 0) + 1;
    }
    for (const [eignung, jeEinheit] of Object.entries(zaehler)) bedarf.push({ eignung, jeEinheit });
  }

  const gebildet = teamsBilden({
    mitglieder: anwesend,
    anzahlTeams: anzahl,
    verboten,
    wiederholung: letztePaarungen(3, terminId),
    bedarf,
    eignungMap,
  });

  if (!plaetze) {
    return {
      anwesend,
      aufstellung: auf,
      anzahlTeams: anzahl,
      teams: gebildet.teams.map((team) => team.map((m) => ({ ...m, funktion: null }))),
      konflikte: gebildet.konflikte,
      ohneFunktion: [],
      luecken: [],
      ohneEignung: [],
    };
  }

  const verlauf = funktionsVerlauf(ROTATION_TERMINE, terminId);
  const ohneFunktion = [];
  const luecken = [];

  const teams = gebildet.teams.map((team, index) => {
    // Mehr Kinder als Plaetze: die Ueberzaehligen bekommen keine Funktion.
    // Ehrlicher als sie irgendwo dazuzuschreiben — eine Gruppe hat neun Plaetze.
    const passend = team.slice(0, plaetze.length);
    for (const m of team.slice(plaetze.length)) ohneFunktion.push(m);
    const { besetzt, unbesetzt } = plaetzeVerteilen(passend, plaetze, eignungMap, verlauf);
    if (unbesetzt.length) luecken.push({ einheit: index + 1, plaetze: unbesetzt.map((f) => f.label) });
    return besetzt;
  });

  // Funktionen, fuer die niemand mit Eignung uebrig war. Kein Fehler, aber der
  // Betreuer muss es wissen — dort steht jemand, der es noch nicht kann.
  const ohneEignung = teams
    .flat()
    .filter((m) => m.ohne_eignung)
    .map((m) => ({ name: m.name, funktion: m.funktion_label }));

  return {
    anwesend,
    aufstellung: auf,
    anzahlTeams: anzahl,
    teams,
    konflikte: gebildet.konflikte,
    ohneFunktion,
    luecken,
    ohneEignung,
  };
}

/** Speichert eine Aufteilung, damit sie spaeter nachvollziehbar bleibt. */
function teamsSpeichern(terminId, teams) {
  db.transaction(() => {
    const alte = db.prepare('SELECT id FROM teams WHERE termin_id = ?').all(terminId);
    for (const a of alte) db.prepare('DELETE FROM team_mitglieder WHERE team_id = ?').run(a.id);
    db.prepare('DELETE FROM teams WHERE termin_id = ?').run(terminId);

    const einfuegen = db.prepare('INSERT INTO team_mitglieder (team_id, member_id, funktion) VALUES (?, ?, ?)');
    teams.forEach((team, index) => {
      const info = db
        .prepare("INSERT INTO teams (termin_id, nummer, gespeichert) VALUES (?, ?, datetime('now'))")
        .run(terminId, index + 1);
      for (const m of team) einfuegen.run(info.lastInsertRowid, m.id, m.funktion || null);
    });
  })();
  return teams.length;
}

/**
 * Wann wurde die Einteilung dieses Termins zuletzt gespeichert? Leerer Text,
 * wenn noch nie. Der Speichern-Knopf vergleicht damit, ob zwischen Anzeigen
 * und Abschicken jemand anderes gespeichert hat — zwei Betreuer koennen die
 * Seite gleichzeitig offen haben.
 */
function teamsStand(terminId) {
  const r = db.prepare('SELECT MAX(gespeichert) AS stand FROM teams WHERE termin_id = ?').get(terminId);
  return (r && r.stand) || '';
}

/**
 * Gespeicherte Einteilung eines Termins — Namen und Funktionen, keine Werte.
 * Das ist die Ansicht, die man vorzeigen oder ausdrucken kann.
 */
function gespeicherteTeams(terminId) {
  const teams = db.prepare('SELECT * FROM teams WHERE termin_id = ? ORDER BY nummer').all(terminId);
  return teams.map((t) => ({
    ...t,
    mitglieder: db
      .prepare(
        `SELECT m.id, m.name, tm.funktion FROM team_mitglieder tm
           JOIN members m ON m.id = tm.member_id
          WHERE tm.team_id = ?`
      )
      .all(t.id)
      // Nach Platz in der Aufstellung, nicht alphabetisch: der Gruppenfuehrer
      // steht oben. Ohne Funktion (freie Teams) alphabetisch.
      .map((m) => ({
        ...m,
        funktion_kurz: m.funktion && FUNKTION[m.funktion] ? FUNKTION[m.funktion].kurz : null,
        funktion_label: m.funktion && FUNKTION[m.funktion] ? FUNKTION[m.funktion].label : null,
        rang: m.funktion ? FUNKTIONEN.findIndex((f) => f.key === m.funktion) : 99,
      }))
      .sort((a, b) => a.rang - b.rang || a.name.localeCompare(b.name, 'de')),
  }));
}

module.exports = {
  STATUS_REIHE,
  MERKMALE,
  MITTE,
  dienstfenster,
  VORLAUF_MIN,
  NACHLAUF_MIN,
  FUNKTIONEN,
  FUNKTION,
  EIGNUNGEN,
  AUFSTELLUNGEN,
  eignungen,
  eignungSetzen,
  eignungsListe,
  funktionsVerlauf,
  plaetzeVerteilen,
  einheitenVorschlag,
  einteilung,
  anwesendeMitWerten,
  heute,
  termine,
  terminById,
  terminByDatum,
  letzterTermin,
  terminAnlegen,
  terminAendern,
  terminLoeschen,
  anwesenheit,
  statusSetzen,
  naechsterStatus,
  alleSetzen,
  quoten,
  einschaetzungen,
  einschaetzungSetzen,
  trennPaare,
  trennenSetzen,
  trennenEntfernen,
  teamsBilden,
  teamsSpeichern,
  teamsStand,
  gespeicherteTeams,
  letztePaarungen,
  paarKey,
};
