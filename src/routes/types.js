'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');

const router = express.Router();
const login = auth.requireLogin;

function clean(body) {
  return {
    name: (body.name || '').trim(),
    has_size: body.has_size ? 1 : 0,
    has_inventory: body.has_inventory ? 1 : 0,
    sort_order: Number(body.sort_order) || 100,
  };
}

router.get('/ausruestungsarten', login, (req, res) => {
  const types = m.allTypes().map((t) => ({
    ...t,
    count: db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE type_id = ?').get(t.id).n,
  }));
  res.render('arten', { title: 'Ausrüstungsarten', types, error: null });
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
        'INSERT INTO equipment_types (name, has_size, has_inventory, sort_order) VALUES (@name, @has_size, @has_inventory, @sort_order)'
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
      'UPDATE equipment_types SET name = @name, has_size = @has_size, has_inventory = @has_inventory, sort_order = @sort_order WHERE id = @id'
    ).run({ ...data, id: type.id });
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    req.session.flash = { type: 'warn', text: `Der Name "${data.name}" ist schon vergeben.` };
    return res.redirect('/ausruestungsarten');
  }

  const detail = audit.diff(
    { name: 'Name', has_size: 'Größe führen', has_inventory: 'Inv.-Nr. führen', sort_order: 'Reihenfolge' },
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

module.exports = router;
