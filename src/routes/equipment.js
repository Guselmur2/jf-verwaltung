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
const MAX_ANZAHL = 100;

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

/**
 * Liest das Ablage-Ziel aus dem Formular. Ein einziges Feld statt zweier,
 * damit Spint und Lagerort sich nicht widersprechen koennen.
 *   "spint:12" | "lager:3" | "lager" (ohne Ort)
 * Faellt auf die alten Einzelfelder zurueck, die einige Formulare noch senden.
 */
function parseZiel(body) {
  const ziel = (body.ziel || '').trim();
  if (ziel) {
    const [art, id] = ziel.split(':');
    if (art === 'spint' && id) return { lockerId: Number(id), storageId: null };
    if (art === 'lager') return { lockerId: null, storageId: id ? Number(id) : null };
    return null;
  }
  if (body.locker_id) return { lockerId: Number(body.locker_id), storageId: null };
  if (body.storage_id) return { lockerId: null, storageId: Number(body.storage_id) };
  return { lockerId: null, storageId: null };
}

function zielGueltig(ziel) {
  if (!ziel) return false;
  if (ziel.lockerId && !m.q.lockerById.get(ziel.lockerId)) return false;
  if (ziel.storageId && !m.q.storageById.get(ziel.storageId)) return false;
  return true;
}

router.post('/ausruestung/neu', login, (req, res) => {
  const data = clean(req.body);
  const ziel = parseZiel(req.body);
  const anzahl = Math.min(Math.max(Number(req.body.anzahl) || 1, 1), MAX_ANZAHL);

  if (!data.type_id || !m.q.typeById.get(data.type_id)) {
    req.session.flash = { type: 'warn', text: 'Bitte eine Ausrüstungsart auswählen.' };
    return res.redirect(backTo(req));
  }
  if (!zielGueltig(ziel)) {
    req.session.flash = { type: 'warn', text: 'Der gewählte Ablageort existiert nicht.' };
    return res.redirect(backTo(req));
  }
  // Mehrere Teile auf einmal koennen keine gemeinsame Inventarnummer haben.
  if (anzahl > 1 && data.inventory_no) {
    req.session.flash = {
      type: 'warn',
      text: 'Bei mehr als einem Stück bitte die Inventarnummer leer lassen — die Nummern trägt man je Teil einzeln nach.',
    };
    return res.redirect(backTo(req));
  }

  const insert = db.prepare(
    'INSERT INTO equipment (type_id, size, inventory_no, condition, note, locker_id, storage_id) ' +
      'VALUES (@type_id, @size, @inventory_no, @condition, @note, @locker_id, @storage_id)'
  );
  const zeile = { ...data, locker_id: ziel.lockerId, storage_id: ziel.lockerId ? null : ziel.storageId };

  let ersteId = null;
  db.transaction(() => {
    for (let i = 0; i < anzahl; i++) {
      const info = insert.run(zeile);
      if (ersteId === null) ersteId = info.lastInsertRowid;
    }
  })();

  const ort = m.placementLabel(zeile);
  const label = m.describe(withType(data));
  const menge = anzahl > 1 ? `${anzahl} × ` : '';
  audit.log(req, 'ausruestung', ersteId, 'angelegt', `${menge}${label} → ${ort}`);
  req.session.flash = { type: 'ok', text: `${menge}${label} angelegt.` };
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

  const detail = audit.diff({ ...FIELDS, type_name: 'Art' }, withType(item), withType(data));
  if (detail) audit.log(req, 'ausruestung', item.id, 'geändert', `${m.describe(withType(data))} — ${detail}`);

  req.session.flash = { type: 'ok', text: 'Gespeichert.' };
  res.redirect(backTo(req));
});

router.post('/ausruestung/:id/verschieben', login, (req, res) => {
  const item = m.q.equipmentById.get(req.params.id);
  if (!item) return res.redirect(backTo(req));

  const ziel = parseZiel(req.body);
  if (!zielGueltig(ziel)) {
    req.session.flash = { type: 'warn', text: 'Der gewählte Ablageort existiert nicht.' };
    return res.redirect(backTo(req));
  }

  const vorher = m.placementLabel(item);
  m.setPlacement(item.id, ziel);
  const nachher = m.placementLabel(m.q.equipmentById.get(item.id));

  audit.log(req, 'ausruestung', item.id, 'verschoben', `${m.describe(withType(item))}: ${vorher} → ${nachher}`);
  req.session.flash = { type: 'ok', text: `${m.describe(withType(item))} → ${nachher}.` };
  res.redirect(backTo(req));
});

router.post('/ausruestung/:id/ausmustern', login, (req, res) => {
  const item = m.q.equipmentById.get(req.params.id);
  if (!item) return res.redirect(backTo(req));

  db.prepare('UPDATE equipment SET retired = 1, locker_id = NULL, storage_id = NULL WHERE id = ?').run(item.id);
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
  res.render('ausgemustert', { title: 'Ausgemustert', items, storages: m.storagesAll() });
});

module.exports = router;
