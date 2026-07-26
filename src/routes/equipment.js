'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');

const router = express.Router();
const login = auth.requireLogin;

const FIELDS = { size: 'Größe', inventory_no: 'Inv.-Nr.', condition: 'Zustand', note: 'Notiz' };
const CONDITIONS = ['gut', 'gebraucht', 'defekt'];

/** Nur seiteninterne Ziele zulassen, damit die Weiterleitung nicht entfuehrt werden kann. */
function backTo(req, fallback = '/') {
  const target = req.body.zurueck || '';
  return /^\/[^/\\]/.test(target) ? target : fallback;
}

function clean(body) {
  const condition = CONDITIONS.includes(body.condition) ? body.condition : 'gut';
  return {
    type_id: Number(body.type_id) || null,
    size: (body.size || '').trim() || null,
    inventory_no: (body.inventory_no || '').trim() || null,
    condition,
    note: (body.note || '').trim() || null,
  };
}

function withType(item) {
  return { ...item, type_name: m.q.typeById.get(item.type_id)?.name };
}

function lockerLabel(lockerId) {
  if (!lockerId) return 'Lager';
  const l = m.q.lockerById.get(lockerId);
  return l ? `Spint ${l.code}` : 'Lager';
}

router.post('/ausruestung/neu', login, (req, res) => {
  const data = clean(req.body);
  const lockerId = req.body.locker_id ? Number(req.body.locker_id) : null;

  if (!data.type_id || !m.q.typeById.get(data.type_id)) {
    req.session.flash = { type: 'warn', text: 'Bitte eine Ausrüstungsart auswählen.' };
    return res.redirect(backTo(req));
  }

  const info = db
    .prepare(
      'INSERT INTO equipment (type_id, size, inventory_no, condition, note, locker_id) ' +
        'VALUES (@type_id, @size, @inventory_no, @condition, @note, @locker_id)'
    )
    .run({ ...data, locker_id: lockerId });

  const label = m.describe(withType(data));
  audit.log(req, 'ausruestung', info.lastInsertRowid, 'angelegt', `${label} → ${lockerLabel(lockerId)}`);
  req.session.flash = { type: 'ok', text: `${label} angelegt.` };
  res.redirect(backTo(req));
});

router.post('/ausruestung/:id/bearbeiten', login, (req, res) => {
  const item = m.q.equipmentById.get(req.params.id);
  if (!item) return res.redirect(backTo(req));

  const data = clean(req.body);
  if (!data.type_id) data.type_id = item.type_id;

  db.prepare(
    'UPDATE equipment SET type_id = @type_id, size = @size, inventory_no = @inventory_no, ' +
      'condition = @condition, note = @note WHERE id = @id'
  ).run({ ...data, id: item.id });

  const detail = audit.diff(
    { ...FIELDS, type_name: 'Art' },
    withType(item),
    withType(data)
  );
  if (detail) audit.log(req, 'ausruestung', item.id, 'geändert', `${m.describe(withType(data))} — ${detail}`);

  req.session.flash = { type: 'ok', text: 'Gespeichert.' };
  res.redirect(backTo(req));
});

router.post('/ausruestung/:id/verschieben', login, (req, res) => {
  const item = m.q.equipmentById.get(req.params.id);
  if (!item) return res.redirect(backTo(req));

  const target = req.body.locker_id ? Number(req.body.locker_id) : null;
  if (target && !m.q.lockerById.get(target)) {
    req.session.flash = { type: 'warn', text: 'Dieser Spint existiert nicht.' };
    return res.redirect(backTo(req));
  }

  db.prepare('UPDATE equipment SET locker_id = ? WHERE id = ?').run(target, item.id);
  audit.log(
    req,
    'ausruestung',
    item.id,
    'verschoben',
    `${m.describe(withType(item))}: ${lockerLabel(item.locker_id)} → ${lockerLabel(target)}`
  );
  req.session.flash = { type: 'ok', text: `${m.describe(withType(item))} → ${lockerLabel(target)}.` };
  res.redirect(backTo(req));
});

router.post('/ausruestung/:id/ausmustern', login, (req, res) => {
  const item = m.q.equipmentById.get(req.params.id);
  if (!item) return res.redirect(backTo(req));

  db.prepare('UPDATE equipment SET retired = 1, locker_id = NULL WHERE id = ?').run(item.id);
  audit.log(req, 'ausruestung', item.id, 'ausgemustert', m.describe(withType(item)));
  req.session.flash = { type: 'ok', text: `${m.describe(withType(item))} ausgemustert.` };
  res.redirect(backTo(req));
});

router.post('/ausruestung/:id/reaktivieren', login, (req, res) => {
  const item = m.q.equipmentById.get(req.params.id);
  if (!item) return res.redirect(backTo(req));

  db.prepare('UPDATE equipment SET retired = 0 WHERE id = ?').run(item.id);
  audit.log(req, 'ausruestung', item.id, 'reaktiviert', m.describe(withType(item)));
  req.session.flash = { type: 'ok', text: `${m.describe(withType(item))} liegt wieder im Lager.` };
  res.redirect(backTo(req));
});

router.get('/ausgemustert', login, (req, res) => {
  const items = db
    .prepare(
      `SELECT e.*, t.name AS type_name FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
        WHERE e.retired = 1
        ORDER BY t.sort_order, e.inventory_no`
    )
    .all();
  res.render('ausgemustert', { title: 'Ausgemustert', items });
});

module.exports = router;
