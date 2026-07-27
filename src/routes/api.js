'use strict';

const express = require('express');
const { db } = require('../db');
const m = require('../model');
const sizes = require('../sizes');
const barcode = require('../barcode');
const backup = require('../backup');
const settings = require('../settings');
const api = require('../api-auth');
const { formatGermanDate, parseGermanDate } = require('../dates');

const router = express.Router();
const lesen = api.verlangt('lesen');
const schreiben = api.verlangt('schreiben');

// Die Feldnamen der Datenbank sind englisch, die Oberflaeche deutsch. Nach
// aussen zaehlt die deutsche Fassung — so ist ohne Blick in den Quelltext klar,
// was gemeint ist.

const alsSpint = (l) => ({
  id: l.id,
  nummer: l.code,
  bereich: l.area_name || null,
  bereich_id: l.area_id || null,
  bezeichnung: l.label || null,
  standort: l.location || null,
  mitglied: l.member_name || null,
  mitglied_id: l.member_id || null,
  notiz: l.note || null,
  qr_pfad: l.token ? `/s/${l.token}` : null,
});

const alsTeil = (e) => ({
  id: e.id,
  art: e.type_name,
  art_id: e.type_id,
  groesse: e.size || null,
  inventarnummer: e.inventory_no || null,
  zustand: e.condition,
  notiz: e.note || null,
  ausgemustert: !!e.retired,
  ort: {
    art: e.retired ? 'ausgemustert' : e.locker_id ? 'spint' : e.storage_id ? 'lagerort' : 'lager',
    spint_id: e.locker_id || null,
    spint_nummer: e.locker_code || null,
    lagerort_id: e.storage_id || null,
    lagerort: e.storage_name || null,
    mitglied: e.member_name || null,
  },
});

const alsMitglied = (mem) => ({
  id: mem.id,
  name: mem.name,
  geschlecht: mem.gender || null,
  geburtstag: formatGermanDate(mem.birthday) || null,
  telefon: mem.phone || null,
  notiz: mem.note || null,
  aktiv: !!mem.active,
  spint_id: mem.locker_id || null,
  spint_nummer: mem.locker_code || null,
});

const alsLagerort = (s) => ({
  id: s.id,
  name: s.name,
  standort: s.location || null,
  notiz: s.note || null,
  teile: s.item_count,
  qr_pfad: s.token ? `/l/${s.token}` : null,
});

const alsAufgabe = (t) => ({
  id: t.id,
  art: t.kind,
  status: t.status,
  ausruestungsart: t.type_name || null,
  mitglied: t.member_name || null,
  spint_nummer: t.locker_code || null,
  von_groesse: t.from_size || null,
  nach_groesse: t.to_size || null,
  grund: t.reason || null,
  notiz: t.note || null,
  angelegt: t.created_at,
  angelegt_von: t.created_by || null,
  erledigt: t.done_at || null,
  erledigt_von: t.done_by || null,
});

// --------------------------------------------------------------- Übersicht

router.get('/', lesen, (req, res) => {
  res.json({
    name: 'Spintverwaltung Jugendfeuerwehr',
    version: 1,
    berechtigung: req.apiToken.scope,
    endpunkte: {
      lesen: [
        'GET /api/v1/status',
        'GET /api/v1/spinte',
        'GET /api/v1/spinte/:id',
        'GET /api/v1/mitglieder',
        'GET /api/v1/ausruestung?art=&groesse=&spint=&lagerort=&nummer=&ausgemustert=',
        'GET /api/v1/ausruestung/:id',
        'GET /api/v1/lagerorte',
        'GET /api/v1/lagerorte/:id',
        'GET /api/v1/aufgaben?status=offen|erledigt|abgebrochen|alle',
        'GET /api/v1/arten',
        'GET /api/v1/groessen',
        'GET /api/v1/stammdaten',
        'GET /api/v1/suche?q=',
        'GET /api/v1/sicherung  (Kopfzeile X-Sicherung-Passwort nötig)',
      ],
      schreiben: [
        'POST /api/v1/ausruestung',
        'PATCH /api/v1/ausruestung/:id',
        'POST /api/v1/aufgaben',
        'PATCH /api/v1/aufgaben/:id',
        'POST /api/v1/arten',
        'PATCH /api/v1/arten/:id',
        'DELETE /api/v1/arten/:id',
        'POST /api/v1/groessen',
        'PUT /api/v1/groessen/:schema',
        'DELETE /api/v1/groessen/:schema',
        'PATCH /api/v1/stammdaten',
      ],
    },
  });
});

router.get('/status', lesen, (req, res) => {
  const s = m.stats();
  res.json({
    spinte: s.lockers,
    spinte_frei: s.lockersFree,
    mitglieder: s.members,
    ausruestung: s.equipment,
    im_lager: s.storage,
    defekt: s.defect,
    offene_aufgaben: s.tasks,
    bereiche_getrennt: m.showAreas(),
    zeit: new Date().toISOString(),
  });
});

// ------------------------------------------------------------------ Lesen

router.get('/spinte', lesen, (req, res) => {
  res.json({ anzahl: m.allLockers().length, daten: m.allLockers().map(alsSpint) });
});

router.get('/spinte/:id(\\d+)', lesen, (req, res) => {
  const l = m.q.lockerById.get(req.params.id);
  if (!l) return res.status(404).json({ fehler: 'Spint nicht gefunden.' });
  const bereich = l.area_id ? m.q.areaById.get(l.area_id) : null;
  const mem = l.member_id ? m.q.memberById.get(l.member_id) : null;
  res.json({
    ...alsSpint({ ...l, area_name: bereich?.name, member_name: mem?.name }),
    inhalt: m.equipmentOfLocker(l.id).map(alsTeil),
  });
});

router.get('/mitglieder', lesen, (req, res) => {
  const alle = req.query.alle === '1';
  const daten = m.members({ includeInactive: alle }).map(alsMitglied);
  res.json({ anzahl: daten.length, daten });
});

const TEIL_SQL = `SELECT e.*, t.name AS type_name, l.id AS locker_id, l.code AS locker_code,
                         st.name AS storage_name, mem.name AS member_name
                    FROM equipment e
                    JOIN equipment_types t ON t.id = e.type_id
                    LEFT JOIN lockers l ON l.id = e.locker_id
                    LEFT JOIN storages st ON st.id = e.storage_id
                    LEFT JOIN members mem ON mem.id = l.member_id`;

router.get('/ausruestung', lesen, (req, res) => {
  const where = [];
  const p = {};
  if (req.query.art) {
    where.push('(t.name = @art COLLATE NOCASE OR t.id = @artId)');
    p.art = req.query.art;
    p.artId = Number(req.query.art) || -1;
  }
  if (req.query.groesse) {
    where.push('e.size = @groesse COLLATE NOCASE');
    p.groesse = req.query.groesse;
  }
  if (req.query.spint) {
    where.push('e.locker_id = @spint');
    p.spint = Number(req.query.spint);
  }
  if (req.query.lagerort) {
    where.push('e.storage_id = @lagerort');
    p.lagerort = Number(req.query.lagerort);
  }
  if (req.query.nummer) {
    // Auch die Kurzform der Inventarnummer findet das Teil.
    const kandidaten = barcode.candidates(req.query.nummer);
    where.push('TRIM(e.inventory_no) IN (' + kandidaten.map((_, i) => `@nr${i}`).join(',') + ') COLLATE NOCASE');
    kandidaten.forEach((k, i) => {
      p[`nr${i}`] = k;
    });
  }
  where.push(req.query.ausgemustert === '1' ? 'e.retired = 1' : 'e.retired = 0');

  const daten = db
    .prepare(`${TEIL_SQL} WHERE ${where.join(' AND ')} ORDER BY t.sort_order, e.size, e.inventory_no`)
    .all(p)
    .map(alsTeil);
  res.json({ anzahl: daten.length, daten });
});

router.get('/ausruestung/:id(\\d+)', lesen, (req, res) => {
  const e = db.prepare(`${TEIL_SQL} WHERE e.id = ?`).get(req.params.id);
  if (!e) return res.status(404).json({ fehler: 'Ausrüstung nicht gefunden.' });
  res.json(alsTeil(e));
});

router.get('/lagerorte', lesen, (req, res) => {
  const daten = m.storagesAll().map(alsLagerort);
  res.json({ anzahl: daten.length, daten });
});

router.get('/lagerorte/:id(\\d+)', lesen, (req, res) => {
  const s = m.q.storageById.get(req.params.id);
  if (!s) return res.status(404).json({ fehler: 'Lagerort nicht gefunden.' });
  const inhalt = m.storageContents(s.id);
  res.json({
    ...alsLagerort({ ...s, item_count: inhalt.total }),
    zusammenfassung: inhalt.gruppen.map((g) => ({
      art: g.type_name,
      anzahl: g.count,
      groessen: g.sizeList.map((x) => ({ groesse: x.size, anzahl: x.n })),
    })),
    inhalt: inhalt.items.map(alsTeil),
  });
});

router.get('/aufgaben', lesen, (req, res) => {
  const status = ['offen', 'erledigt', 'abgebrochen', 'alle'].includes(req.query.status)
    ? req.query.status
    : 'offen';
  const daten = m.tasksList(status).map(alsAufgabe);
  res.json({ anzahl: daten.length, status, daten });
});

router.get('/arten', lesen, (req, res) => {
  const daten = m.allTypes().map((t) => ({
    id: t.id,
    name: t.name,
    fuehrt_groesse: !!t.has_size,
    fuehrt_inventarnummer: !!t.has_inventory,
    groessenschema: t.size_scheme || null,
    groessen: sizes.sizesOfType(t.id).map((s) => s.wert),
    barcode_praefix: t.barcode_prefix || null,
    barcode_stellen: t.barcode_digits || null,
    aktiv: !!t.active,
  }));
  res.json({ anzahl: daten.length, daten });
});

router.get('/suche', lesen, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ fehler: 'Parameter q fehlt.' });
  const r = m.search(q);
  res.json({
    suchbegriff: q,
    spinte: r.lockers.map(alsSpint),
    mitglieder: r.members.map(alsMitglied),
    ausruestung: r.equipment.map(alsTeil),
    lagerorte: r.storages.map(alsLagerort),
  });
});

// ------------------------------------------------------------- Sicherung

router.get('/sicherung', lesen, async (req, res, next) => {
  // Das Passwort kommt in einer Kopfzeile, nicht im Adressteil — sonst stuende
  // es in jedem Protokoll und in der Verlaufsliste.
  const passwort = req.get('x-sicherung-passwort') || '';
  const fehler = backup.passwortPruefen(passwort);
  if (fehler) {
    return res.status(400).json({
      fehler,
      hinweis: 'Passwort in der Kopfzeile "X-Sicherung-Passwort" senden. Unverschlüsselt gibt es die Sicherung nicht.',
    });
  }

  try {
    const s = await backup.erstellen(passwort);
    res.download(s.pfad, s.name, (err) => {
      backup.aufraeumen(s.ordner);
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  }
});

router.get('/sicherung/info', lesen, (req, res) => res.json(backup.info()));

// Stammdaten der Wehr — das, was auf den Spint-Etiketten steht.
router.get('/stammdaten', lesen, (req, res) => {
  const d = settings.alle();
  res.json({
    organisation: d.organisation,
    abteilung: d.abteilung,
    slogan: d.slogan,
    logo: d.hatLogo ? { vorhanden: true, adresse: '/logo', stand: d.logoStand } : { vorhanden: false },
  });
});

// -------------------------------------------------------------- Schreiben

router.patch('/stammdaten', schreiben, (req, res) => {
  const b = req.body || {};
  const unbekannt = Object.keys(b).filter((f) => !settings.FELDER.includes(f));
  if (unbekannt.length) {
    return res.status(400).json({
      fehler: `Unbekanntes Feld: ${unbekannt.join(', ')}.`,
      erlaubt: settings.FELDER,
    });
  }
  const geaendert = settings.speichern(b);
  res.json({ geaendert, stammdaten: settings.alle() });
});

router.post('/ausruestung', schreiben, (req, res) => {
  const b = req.body || {};
  const typ = db
    .prepare('SELECT * FROM equipment_types WHERE id = @id OR name = @name COLLATE NOCASE')
    .get({ id: Number(b.art_id) || -1, name: b.art || '' });
  if (!typ) return res.status(400).json({ fehler: 'Ausrüstungsart nicht gefunden (Feld "art" oder "art_id").' });

  const nummer = barcode.expand(typ.id, b.inventarnummer) || null;
  if (nummer) {
    const belegt = m.inventarNummerVergeben(nummer);
    if (belegt) return res.status(409).json({ fehler: m.konfliktText(nummer, belegt) });
  }

  const groesse = (b.groesse || '').trim() || null;
  if (groesse && !sizes.isKnown(typ.id, groesse) && b.groesse_ok !== true) {
    return res.status(409).json({
      fehler: `Die Größe „${groesse}“ gibt es bei ${typ.name} nicht.`,
      vorschlag: sizes.nearest(typ.id, groesse)?.wert || null,
      bekannte_groessen: sizes.sizesOfType(typ.id).map((s) => s.wert),
      hinweis: 'Mit "groesse_ok": true trotzdem übernehmen.',
    });
  }

  const zustand = ['gut', 'gebraucht', 'defekt'].includes(b.zustand) ? b.zustand : 'gut';
  const spint = b.spint_id ? Number(b.spint_id) : null;
  const lagerort = b.lagerort_id ? Number(b.lagerort_id) : null;
  if (spint && !m.q.lockerById.get(spint)) return res.status(400).json({ fehler: 'Spint nicht gefunden.' });
  if (lagerort && !m.q.storageById.get(lagerort)) return res.status(400).json({ fehler: 'Lagerort nicht gefunden.' });

  const anzahl = Math.min(Math.max(Number(b.anzahl) || 1, 1), 100);
  if (anzahl > 1 && nummer) {
    return res.status(400).json({ fehler: 'Bei mehreren Stücken darf keine Inventarnummer gesetzt sein.' });
  }

  const insert = db.prepare(
    'INSERT INTO equipment (type_id, size, inventory_no, condition, note, locker_id, storage_id) ' +
      'VALUES (@type_id, @size, @inventory_no, @condition, @note, @locker_id, @storage_id)'
  );
  const zeile = {
    type_id: typ.id,
    size: groesse,
    inventory_no: nummer,
    condition: zustand,
    note: (b.notiz || '').trim() || null,
    locker_id: spint,
    storage_id: spint ? null : lagerort,
  };

  const ids = [];
  db.transaction(() => {
    for (let i = 0; i < anzahl; i++) ids.push(insert.run(zeile).lastInsertRowid);
  })();

  db.prepare(
    "INSERT INTO audit_log (username, entity, entity_id, action, detail) VALUES (?, 'ausruestung', ?, 'angelegt', ?)"
  ).run(`API: ${req.apiToken.name}`, ids[0], `${anzahl} × ${typ.name}${groesse ? ' Gr. ' + groesse : ''}`);

  res.status(201).json({ angelegt: ids.length, ids });
});

router.patch('/ausruestung/:id(\\d+)', schreiben, (req, res) => {
  const item = m.q.equipmentById.get(req.params.id);
  if (!item) return res.status(404).json({ fehler: 'Ausrüstung nicht gefunden.' });
  const b = req.body || {};

  const felder = {};
  if (b.groesse !== undefined) felder.size = String(b.groesse).trim() || null;
  if (b.notiz !== undefined) felder.note = String(b.notiz).trim() || null;
  if (b.zustand !== undefined) {
    if (!['gut', 'gebraucht', 'defekt'].includes(b.zustand)) {
      return res.status(400).json({ fehler: 'zustand muss gut, gebraucht oder defekt sein.' });
    }
    felder.condition = b.zustand;
  }
  if (b.inventarnummer !== undefined) {
    const nummer = barcode.expand(item.type_id, b.inventarnummer) || null;
    if (nummer) {
      const belegt = m.inventarNummerVergeben(nummer, item.id);
      if (belegt) return res.status(409).json({ fehler: m.konfliktText(nummer, belegt) });
    }
    felder.inventory_no = nummer;
  }

  if (Object.keys(felder).length) {
    const setz = Object.keys(felder)
      .map((k) => `${k} = @${k}`)
      .join(', ');
    db.prepare(`UPDATE equipment SET ${setz} WHERE id = @id`).run({ ...felder, id: item.id });
  }

  // Umlagern ist ein eigener Vorgang, damit Spint und Lagerort sich nicht widersprechen.
  if (b.spint_id !== undefined || b.lagerort_id !== undefined) {
    const spint = b.spint_id ? Number(b.spint_id) : null;
    const lagerort = b.lagerort_id ? Number(b.lagerort_id) : null;
    if (spint && !m.q.lockerById.get(spint)) return res.status(400).json({ fehler: 'Spint nicht gefunden.' });
    if (lagerort && !m.q.storageById.get(lagerort)) return res.status(400).json({ fehler: 'Lagerort nicht gefunden.' });
    m.setPlacement(item.id, { lockerId: spint, storageId: lagerort });
  }

  db.prepare(
    "INSERT INTO audit_log (username, entity, entity_id, action, detail) VALUES (?, 'ausruestung', ?, 'geändert', 'über die API')"
  ).run(`API: ${req.apiToken.name}`, item.id);

  const neu = db.prepare(`${TEIL_SQL} WHERE e.id = ?`).get(item.id);
  res.json(alsTeil(neu));
});

// ------------------------------------------------- Arten und Größen pflegen

function artFelder(b, alt = {}) {
  const zahl = (v) => (Number(v) > 0 ? Number(v) : null);
  return {
    name: (b.name ?? alt.name ?? '').trim(),
    has_size: b.fuehrt_groesse === undefined ? (alt.has_size ?? 1) : b.fuehrt_groesse ? 1 : 0,
    has_inventory:
      b.fuehrt_inventarnummer === undefined ? (alt.has_inventory ?? 1) : b.fuehrt_inventarnummer ? 1 : 0,
    size_scheme: b.groessenschema === undefined ? (alt.size_scheme ?? null) : (b.groessenschema || null),
    barcode_prefix: b.barcode_praefix === undefined ? (alt.barcode_prefix ?? null) : (String(b.barcode_praefix).trim() || null),
    barcode_digits: b.barcode_stellen === undefined ? (alt.barcode_digits ?? null) : zahl(b.barcode_stellen),
    sort_order: b.reihenfolge === undefined ? (alt.sort_order ?? 100) : Number(b.reihenfolge) || 100,
    active: b.aktiv === undefined ? (alt.active ?? 1) : b.aktiv ? 1 : 0,
  };
}

function schemaGueltig(name) {
  return !name || !!db.prepare('SELECT 1 FROM size_schemes WHERE name = ?').get(name);
}

router.post('/arten', schreiben, (req, res) => {
  const d = artFelder(req.body || {});
  if (!d.name) return res.status(400).json({ fehler: 'Feld "name" fehlt.' });
  if (!schemaGueltig(d.size_scheme)) {
    return res.status(400).json({ fehler: 'Unbekanntes Größenschema.', bekannt: sizes.schemes().map((s) => s.name) });
  }

  try {
    const info = db
      .prepare(
        'INSERT INTO equipment_types (name, has_size, has_inventory, size_scheme, barcode_prefix, barcode_digits, sort_order, active) ' +
          'VALUES (@name, @has_size, @has_inventory, @size_scheme, @barcode_prefix, @barcode_digits, @sort_order, @active)'
      )
      .run(d);
    db.prepare("INSERT INTO audit_log (username, entity, entity_id, action, detail) VALUES (?, 'art', ?, 'angelegt', ?)")
      .run(`API: ${req.apiToken.name}`, info.lastInsertRowid, d.name);
    res.status(201).json({ id: info.lastInsertRowid, ...d });
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    res.status(409).json({ fehler: `Die Art „${d.name}“ gibt es schon.` });
  }
});

router.patch('/arten/:id(\\d+)', schreiben, (req, res) => {
  const alt = m.q.typeById.get(req.params.id);
  if (!alt) return res.status(404).json({ fehler: 'Ausrüstungsart nicht gefunden.' });

  const d = artFelder(req.body || {}, alt);
  if (!d.name) return res.status(400).json({ fehler: 'Der Name darf nicht leer sein.' });
  if (!schemaGueltig(d.size_scheme)) {
    return res.status(400).json({ fehler: 'Unbekanntes Größenschema.', bekannt: sizes.schemes().map((s) => s.name) });
  }

  try {
    db.prepare(
      'UPDATE equipment_types SET name = @name, has_size = @has_size, has_inventory = @has_inventory, ' +
        'size_scheme = @size_scheme, barcode_prefix = @barcode_prefix, barcode_digits = @barcode_digits, ' +
        'sort_order = @sort_order, active = @active WHERE id = @id'
    ).run({ ...d, id: alt.id });
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    return res.status(409).json({ fehler: `Der Name „${d.name}“ ist schon vergeben.` });
  }

  db.prepare("INSERT INTO audit_log (username, entity, entity_id, action, detail) VALUES (?, 'art', ?, 'geändert', 'über die API')")
    .run(`API: ${req.apiToken.name}`, alt.id);
  res.json({ id: alt.id, ...d, groessen: sizes.sizesOfType(alt.id).map((s) => s.wert) });
});

router.delete('/arten/:id(\\d+)', schreiben, (req, res) => {
  const art = m.q.typeById.get(req.params.id);
  if (!art) return res.status(404).json({ fehler: 'Ausrüstungsart nicht gefunden.' });

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE type_id = ?').get(art.id);
  if (n > 0) {
    return res.status(409).json({
      fehler: `„${art.name}“ wird noch von ${n} Teil(en) verwendet.`,
      hinweis: 'Stattdessen mit PATCH und "aktiv": false stilllegen.',
    });
  }
  db.prepare('DELETE FROM equipment_types WHERE id = ?').run(art.id);
  db.prepare("INSERT INTO audit_log (username, entity, entity_id, action, detail) VALUES (?, 'art', ?, 'gelöscht', ?)")
    .run(`API: ${req.apiToken.name}`, art.id, art.name);
  res.json({ geloescht: art.name });
});

router.get('/groessen', lesen, (req, res) => {
  const daten = sizes.schemes().map((s) => ({
    schema: s.name,
    bezeichnung: s.label,
    hinweis: s.note || null,
    gruppen: [...new Set(s.sizes.map((x) => x.gruppe || 'Größen'))].map((g) => ({
      gruppe: g,
      groessen: s.sizes.filter((x) => (x.gruppe || 'Größen') === g).map((x) => x.wert),
    })),
  }));
  res.json({ anzahl: daten.length, daten });
});

/**
 * Prueft die Gruppen-Angabe einer Groessenreihe. Liefert entweder {fehler} oder
 * die bereinigten Gruppen samt Gesamtzahl.
 */
function pruefeGruppen(rohe) {
  const gruppen = Array.isArray(rohe) ? rohe : null;
  if (!gruppen || !gruppen.length) {
    return {
      fehler: 'Feld "gruppen" fehlt.',
      beispiel: { gruppen: [{ gruppe: 'Körpergröße', groessen: ['116', '122'] }] },
    };
  }

  const gesehen = new Set();
  const sauber = [];
  for (const g of gruppen) {
    const werte = (Array.isArray(g.groessen) ? g.groessen : []).map((w) => String(w).trim()).filter(Boolean);
    for (const w of werte) {
      if (gesehen.has(w.toLowerCase())) return { fehler: `Die Größe „${w}“ steht mehrfach in der Liste.` };
      gesehen.add(w.toLowerCase());
    }
    sauber.push({ gruppe: String(g.gruppe || 'Größen').trim(), werte });
  }
  if (!gesehen.size) return { fehler: 'Mindestens eine Größe muss übrig bleiben.' };
  return { sauber, anzahl: gesehen.size };
}

/** Schreibt die Groessen eines Schemas neu. Die Reihenfolge bleibt erhalten. */
function schreibeGroessen(schemaName, gruppen) {
  const einfuegen = db.prepare('INSERT INTO sizes (scheme, gruppe, wert, sort_order) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM sizes WHERE scheme = ?').run(schemaName);
    let sort = 10;
    for (const g of gruppen) for (const w of g.werte) einfuegen.run(schemaName, g.gruppe, w, (sort += 10));
  })();
}

router.post('/groessen', schreiben, (req, res) => {
  const b = req.body || {};
  const name = String(b.schema || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) {
    return res.status(400).json({
      fehler: 'Feld "schema" fehlt oder ist ungültig.',
      hinweis: 'Kurzname aus Kleinbuchstaben, Ziffern und Bindestrich, z. B. "jacke".',
    });
  }
  if (db.prepare('SELECT 1 FROM size_schemes WHERE name = ?').get(name)) {
    return res.status(409).json({ fehler: `Das Größenschema „${name}“ gibt es schon.` });
  }

  const geprueft = pruefeGruppen(b.gruppen);
  if (geprueft.fehler) return res.status(400).json(geprueft);

  db.prepare('INSERT INTO size_schemes (name, label, note) VALUES (?, ?, ?)').run(
    name,
    String(b.bezeichnung || name).trim(),
    (b.hinweis || '').trim() || null
  );
  schreibeGroessen(name, geprueft.sauber);

  db.prepare("INSERT INTO audit_log (username, entity, entity_id, action, detail) VALUES (?, 'groessen', NULL, 'angelegt', ?)")
    .run(`API: ${req.apiToken.name}`, `${name}: ${geprueft.anzahl} Größen`);

  res.status(201).json({
    schema: name,
    bezeichnung: String(b.bezeichnung || name).trim(),
    anzahl: geprueft.anzahl,
    gruppen: geprueft.sauber.map((g) => ({ gruppe: g.gruppe, groessen: g.werte })),
  });
});

router.put('/groessen/:schema', schreiben, (req, res) => {
  const schema = db.prepare('SELECT * FROM size_schemes WHERE name = ?').get(req.params.schema);
  if (!schema) {
    return res.status(404).json({ fehler: 'Größenschema nicht gefunden.', bekannt: sizes.schemes().map((s) => s.name) });
  }

  // Erwartet: { "gruppen": [ { "gruppe": "Körpergröße", "groessen": ["116", …] } ] }
  const geprueft = pruefeGruppen(req.body?.gruppen);
  if (geprueft.fehler) return res.status(400).json(geprueft);

  // Bezeichnung und Hinweis lassen sich hier gleich mitpflegen.
  if (req.body.bezeichnung !== undefined || req.body.hinweis !== undefined) {
    db.prepare('UPDATE size_schemes SET label = ?, note = ? WHERE name = ?').run(
      req.body.bezeichnung !== undefined ? String(req.body.bezeichnung).trim() || schema.label : schema.label,
      req.body.hinweis !== undefined ? String(req.body.hinweis).trim() || null : schema.note,
      schema.name
    );
  }

  schreibeGroessen(schema.name, geprueft.sauber);

  db.prepare("INSERT INTO audit_log (username, entity, entity_id, action, detail) VALUES (?, 'groessen', NULL, 'geändert', ?)")
    .run(`API: ${req.apiToken.name}`, `${schema.label}: ${geprueft.anzahl} Größen`);

  res.json({
    schema: schema.name,
    anzahl: geprueft.anzahl,
    gruppen: geprueft.sauber.map((g) => ({ gruppe: g.gruppe, groessen: g.werte })),
  });
});

router.delete('/groessen/:schema', schreiben, (req, res) => {
  const schema = db.prepare('SELECT * FROM size_schemes WHERE name = ?').get(req.params.schema);
  if (!schema) return res.status(404).json({ fehler: 'Größenschema nicht gefunden.' });

  const nutzer = db.prepare('SELECT name FROM equipment_types WHERE size_scheme = ?').all(schema.name);
  if (nutzer.length) {
    return res.status(409).json({
      fehler: `„${schema.label}“ wird noch verwendet.`,
      von: nutzer.map((t) => t.name),
    });
  }

  db.prepare('DELETE FROM size_schemes WHERE name = ?').run(schema.name);
  db.prepare("INSERT INTO audit_log (username, entity, entity_id, action, detail) VALUES (?, 'groessen', NULL, 'gelöscht', ?)")
    .run(`API: ${req.apiToken.name}`, schema.label);
  res.json({ geloescht: schema.name });
});

router.post('/aufgaben', schreiben, (req, res) => {
  const b = req.body || {};
  const typ = b.art_id || b.art
    ? db
        .prepare('SELECT * FROM equipment_types WHERE id = @id OR name = @name COLLATE NOCASE')
        .get({ id: Number(b.art_id) || -1, name: b.art || '' })
    : null;

  const notiz = (b.notiz || '').trim() || null;
  if (!typ && !notiz) return res.status(400).json({ fehler: 'Bitte "art" oder "notiz" angeben.' });

  const info = db
    .prepare(
      `INSERT INTO tasks (kind, type_id, to_size, from_size, reason, note, created_by)
       VALUES (@kind, @type_id, @to_size, @from_size, @reason, @note, @created_by)`
    )
    .run({
      kind: b.art_der_aufgabe === 'tausch' ? 'tausch' : 'bestellung',
      type_id: typ ? typ.id : null,
      to_size: (b.nach_groesse || '').trim() || null,
      from_size: (b.von_groesse || '').trim() || null,
      reason: (b.grund || 'sonstiges').trim(),
      note: notiz,
      created_by: `API: ${req.apiToken.name}`,
    });

  res.status(201).json(alsAufgabe(m.tasksList('alle').find((t) => t.id === info.lastInsertRowid)));
});

router.patch('/aufgaben/:id(\\d+)', schreiben, (req, res) => {
  const task = m.q.taskById.get(req.params.id);
  if (!task) return res.status(404).json({ fehler: 'Aufgabe nicht gefunden.' });

  const status = req.body?.status;
  if (!['offen', 'erledigt', 'abgebrochen'].includes(status)) {
    return res.status(400).json({ fehler: 'status muss offen, erledigt oder abgebrochen sein.' });
  }

  const fertig = status === 'offen' ? null : new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('UPDATE tasks SET status = ?, done_at = ?, done_by = ? WHERE id = ?').run(
    status,
    fertig,
    fertig ? `API: ${req.apiToken.name}` : null,
    task.id
  );
  res.json(alsAufgabe(m.tasksList('alle').find((t) => t.id === task.id)));
});

// Unbekannte API-Pfade als JSON beantworten, nicht als HTML-Fehlerseite.
router.use((req, res) => res.status(404).json({ fehler: 'Unbekannter Endpunkt.', hinweis: 'GET /api/v1/ zeigt alle.' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('API-Fehler:', err);
  res.status(500).json({ fehler: 'Interner Fehler.', meldung: err.message });
});

module.exports = router;
