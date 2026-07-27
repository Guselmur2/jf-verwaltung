'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');
const sizes = require('../sizes');

const router = express.Router();
const login = auth.requireLogin;

function clean(body) {
  return {
    name: (body.name || '').trim(),
    has_size: body.has_size ? 1 : 0,
    has_inventory: body.has_inventory ? 1 : 0,
    size_scheme: (body.size_scheme || '').trim() || null,
    barcode_prefix: (body.barcode_prefix || '').trim() || null,
    barcode_digits: Number(body.barcode_digits) > 0 ? Number(body.barcode_digits) : null,
    sort_order: Number(body.sort_order) || 100,
  };
}

router.get('/ausruestungsarten', login, (req, res) => {
  const types = m.allTypes().map((t) => ({
    ...t,
    count: db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE type_id = ?').get(t.id).n,
  }));
  res.render('arten', { title: 'Ausrüstungsarten', types, schemes: sizes.schemes(), error: null });
});

router.post('/ausruestungsarten/neu', login, (req, res) => {
  const data = clean(req.body);
  if (!data.name) {
    req.session.flash = { type: 'warn', text: 'Bitte einen Namen angeben.' };
    return res.redirect('/ausruestungsarten');
  }

  try {
    const info = db
      .prepare(
        'INSERT INTO equipment_types (name, has_size, has_inventory, size_scheme, ' +
          'barcode_prefix, barcode_digits, sort_order) ' +
          'VALUES (@name, @has_size, @has_inventory, @size_scheme, ' +
          '@barcode_prefix, @barcode_digits, @sort_order)'
      )
      .run(data);
    audit.log(req, 'art', info.lastInsertRowid, 'angelegt', data.name);
    req.session.flash = { type: 'ok', text: `Art "${data.name}" angelegt.` };
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    req.session.flash = { type: 'warn', text: `Die Art "${data.name}" gibt es schon.` };
  }
  res.redirect('/ausruestungsarten');
});

router.post('/ausruestungsarten/:id/bearbeiten', login, (req, res) => {
  const type = m.q.typeById.get(req.params.id);
  if (!type) return res.redirect('/ausruestungsarten');

  const data = clean(req.body);
  if (!data.name) data.name = type.name;

  try {
    db.prepare(
      'UPDATE equipment_types SET name = @name, has_size = @has_size, has_inventory = @has_inventory, ' +
        'size_scheme = @size_scheme, barcode_prefix = @barcode_prefix, ' +
        'barcode_digits = @barcode_digits, sort_order = @sort_order WHERE id = @id'
    ).run({ ...data, id: type.id });
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    req.session.flash = { type: 'warn', text: `Der Name "${data.name}" ist schon vergeben.` };
    return res.redirect('/ausruestungsarten');
  }

  const detail = audit.diff(
    { name: 'Name', has_size: 'Größe führen', has_inventory: 'Inv.-Nr. führen',
      size_scheme: 'Größenschema', barcode_prefix: 'Barcode-Präfix',
      barcode_digits: 'Stellen', sort_order: 'Reihenfolge' },
    type,
    data
  );
  if (detail) audit.log(req, 'art', type.id, 'geändert', detail);

  req.session.flash = { type: 'ok', text: 'Gespeichert.' };
  res.redirect('/ausruestungsarten');
});

router.post('/ausruestungsarten/:id/status', login, (req, res) => {
  const type = m.q.typeById.get(req.params.id);
  if (!type) return res.redirect('/ausruestungsarten');

  const active = type.active ? 0 : 1;
  db.prepare('UPDATE equipment_types SET active = ? WHERE id = ?').run(active, type.id);
  audit.log(req, 'art', type.id, active ? 'wieder aktiv' : 'stillgelegt', type.name);
  req.session.flash = {
    type: 'ok',
    text: active
      ? `"${type.name}" ist wieder auswählbar.`
      : `"${type.name}" wird nicht mehr angeboten. Vorhandene Teile bleiben erhalten.`,
  };
  res.redirect('/ausruestungsarten');
});

router.post('/ausruestungsarten/:id/loeschen', auth.requireJugendwart, (req, res) => {
  const type = m.q.typeById.get(req.params.id);
  if (!type) return res.redirect('/ausruestungsarten');

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE type_id = ?').get(type.id);
  if (n > 0) {
    req.session.flash = {
      type: 'warn',
      text: `"${type.name}" wird noch von ${n} Teil(en) verwendet. Stattdessen stilllegen.`,
    };
    return res.redirect('/ausruestungsarten');
  }

  db.prepare('DELETE FROM equipment_types WHERE id = ?').run(type.id);
  audit.log(req, 'art', type.id, 'gelöscht', type.name);
  req.session.flash = { type: 'ok', text: `"${type.name}" gelöscht.` };
  res.redirect('/ausruestungsarten');
});

/**
 * Die Größen eines Schemas als Liste bearbeiten. Eingabe ist eine durch Komma
 * getrennte Reihe — die Reihenfolge zählt, denn danach richtet sich, welche
 * Größe "eine Nummer größer" ist (nach 176 kommt 44).
 */
router.post('/groessen/:scheme/speichern', login, (req, res) => {
  const scheme = db.prepare('SELECT * FROM size_schemes WHERE name = ?').get(req.params.scheme);
  if (!scheme) return res.redirect('/ausruestungsarten');

  // Eingaben je Gruppe: Feldname "werte_<Gruppe>".
  const gruppen = [];
  for (const [feld, wert] of Object.entries(req.body)) {
    if (!feld.startsWith('werte_')) continue;
    gruppen.push({
      gruppe: feld.slice('werte_'.length),
      werte: String(wert)
        .split(/[,;\s]+/)
        .map((w) => w.trim())
        .filter(Boolean),
    });
  }
  if (!gruppen.length) return res.redirect('/ausruestungsarten');

  const gesamt = gruppen.reduce((n, g) => n + g.werte.length, 0);
  if (gesamt === 0) {
    req.session.flash = { type: 'warn', text: 'Mindestens eine Größe muss übrig bleiben.' };
    return res.redirect('/ausruestungsarten');
  }
  // Doppelte würden den eindeutigen Index sprengen.
  const gesehen = new Set();
  for (const g of gruppen) {
    for (const w of g.werte) {
      const k = w.toLowerCase();
      if (gesehen.has(k)) {
        req.session.flash = { type: 'warn', text: `Die Größe „${w}“ steht mehrfach in der Liste.` };
        return res.redirect('/ausruestungsarten');
      }
      gesehen.add(k);
    }
  }

  const einfuegen = db.prepare('INSERT INTO sizes (scheme, gruppe, wert, sort_order) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM sizes WHERE scheme = ?').run(scheme.name);
    let sort = 10;
    for (const g of gruppen) {
      for (const w of g.werte) einfuegen.run(scheme.name, g.gruppe, w, (sort += 10));
    }
  })();

  audit.log(req, 'groessen', null, 'geändert', `${scheme.label}: ${gesamt} Größen`);
  req.session.flash = { type: 'ok', text: `Größen für „${scheme.label}“ gespeichert.` };
  res.redirect('/ausruestungsarten');
});

/**
 * Neues Größenschema anlegen. Die Größen kommen als Zeilen der Form
 *   Körpergröße: 122/128, 134/140, …
 * damit sich auch mehrere Gruppen in einem Feld angeben lassen.
 */
router.post('/groessen/neu', login, (req, res) => {
  const name = (req.body.name || '').trim().toLowerCase();
  const bezeichnung = (req.body.bezeichnung || '').trim();

  const warnen = (text) => {
    req.session.flash = { type: 'warn', text };
    res.redirect('/ausruestungsarten');
  };

  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) {
    return warnen('Der Kurzname darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten, z. B. „jacke“.');
  }
  if (db.prepare('SELECT 1 FROM size_schemes WHERE name = ?').get(name)) {
    return warnen(`Das Größenschema „${name}“ gibt es schon.`);
  }

  const gruppen = [];
  const gesehen = new Set();
  for (const zeile of String(req.body.groessen || '').split(/\r?\n/)) {
    if (!zeile.trim()) continue;
    const teil = zeile.split(':');
    const gruppe = teil.length > 1 ? teil.shift().trim() : 'Größen';
    const werte = teil
      .join(':')
      .split(/[,;]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    for (const w of werte) {
      if (gesehen.has(w.toLowerCase())) return warnen(`Die Größe „${w}“ steht mehrfach in der Liste.`);
      gesehen.add(w.toLowerCase());
    }
    if (werte.length) gruppen.push({ gruppe, werte });
  }
  if (!gesehen.size) return warnen('Bitte mindestens eine Größe angeben.');

  const einfuegen = db.prepare('INSERT INTO sizes (scheme, gruppe, wert, sort_order) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('INSERT INTO size_schemes (name, label, note) VALUES (?, ?, ?)').run(
      name,
      bezeichnung || name,
      (req.body.hinweis || '').trim() || null
    );
    let sort = 10;
    for (const g of gruppen) for (const w of g.werte) einfuegen.run(name, g.gruppe, w, (sort += 10));
  })();

  audit.log(req, 'groessen', null, 'angelegt', `${bezeichnung || name}: ${gesehen.size} Größen`);
  req.session.flash = { type: 'ok', text: `Größenschema „${bezeichnung || name}“ mit ${gesehen.size} Größen angelegt.` };
  res.redirect('/ausruestungsarten');
});

router.post('/groessen/:scheme/loeschen', auth.requireJugendwart, (req, res) => {
  const scheme = db.prepare('SELECT * FROM size_schemes WHERE name = ?').get(req.params.scheme);
  if (!scheme) return res.redirect('/ausruestungsarten');

  const nutzer = db.prepare('SELECT name FROM equipment_types WHERE size_scheme = ?').all(scheme.name);
  if (nutzer.length) {
    req.session.flash = {
      type: 'warn',
      text: `„${scheme.label}“ wird noch verwendet von: ${nutzer.map((t) => t.name).join(', ')}.`,
    };
    return res.redirect('/ausruestungsarten');
  }

  db.prepare('DELETE FROM size_schemes WHERE name = ?').run(scheme.name);
  audit.log(req, 'groessen', null, 'gelöscht', scheme.label);
  req.session.flash = { type: 'ok', text: `Größenschema „${scheme.label}“ gelöscht.` };
  res.redirect('/ausruestungsarten');
});

module.exports = router;
