'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');
const { neuerToken, istToken } = require('../tokens');

const router = express.Router();
const login = auth.requireLogin;

function clean(body) {
  return {
    name: (body.name || '').trim(),
    location: (body.location || '').trim() || null,
    note: (body.note || '').trim() || null,
    sort_order: Number(body.sort_order) || 100,
  };
}

function nextSort() {
  return (db.prepare('SELECT MAX(sort_order) AS mx FROM storages').get().mx || 90) + 10;
}

const LAGER_WEG = {
  title: 'Lagerort unbekannt',
  message: 'Zu diesem QR-Code gibt es keinen Lagerort mehr. Vielleicht wurde er gelöscht.',
};

function lagerortSeite(res, storage) {
  res.render('lagerort', { title: storage.name, storage, ...m.storageContents(storage.id) });
}

// Ziel des QR-Codes am Schrank — ohne Anmeldung nur ueber den Token erreichbar.
router.get('/l/:token', (req, res) => {
  if (!istToken(req.params.token)) return res.status(404).render('fehler', LAGER_WEG);
  const storage = m.storageByToken(req.params.token);
  if (!storage) return res.status(404).render('fehler', LAGER_WEG);
  lagerortSeite(res, storage);
});

// Gleiche Seite ueber die interne Nummer, nur fuer angemeldete Betreuer.
router.get('/lagerort/:id(\\d+)', login, (req, res) => {
  const storage = m.q.storageById.get(req.params.id);
  if (!storage) return res.status(404).render('fehler', LAGER_WEG);
  lagerortSeite(res, storage);
});

router.get('/lagerorte', login, (req, res) => {
  res.render('lagerorte', { title: 'Lagerorte', storages: m.storagesAll(), error: null });
});

router.post('/lagerorte/neu', login, (req, res) => {
  const data = clean(req.body);
  if (!data.name) {
    req.session.flash = { type: 'warn', text: 'Bitte einen Namen angeben, z. B. „Schrank 1“.' };
    return res.redirect('/lagerorte');
  }
  try {
    const info = db
      .prepare(
        'INSERT INTO storages (name, token, location, note, sort_order) ' +
          'VALUES (@name, @token, @location, @note, @sort_order)'
      )
      .run({ ...data, token: neuerToken(), sort_order: Number(req.body.sort_order) || nextSort() });
    audit.log(req, 'lagerort', info.lastInsertRowid, 'angelegt', data.name);
    req.session.flash = { type: 'ok', text: `Lagerort „${data.name}“ angelegt.` };
    res.redirect(`/lagerort/${info.lastInsertRowid}`);
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    req.session.flash = { type: 'warn', text: `„${data.name}“ gibt es schon.` };
    res.redirect('/lagerorte');
  }
});

router.post('/lagerort/:id/bearbeiten', login, (req, res) => {
  const storage = m.q.storageById.get(req.params.id);
  if (!storage) return res.redirect('/lagerorte');

  const data = clean(req.body);
  if (!data.name) data.name = storage.name;

  try {
    db.prepare(
      'UPDATE storages SET name = @name, location = @location, note = @note, sort_order = @sort_order WHERE id = @id'
    ).run({ ...data, id: storage.id });
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    req.session.flash = { type: 'warn', text: `Der Name „${data.name}“ ist schon vergeben.` };
    return res.redirect('/lagerorte');
  }

  const detail = audit.diff(
    { name: 'Name', location: 'Standort', note: 'Notiz', sort_order: 'Reihenfolge' },
    storage,
    data
  );
  if (detail) audit.log(req, 'lagerort', storage.id, 'geändert', detail);
  req.session.flash = { type: 'ok', text: 'Gespeichert.' };
  res.redirect('/lagerorte');
});

router.post('/lagerort/:id/loeschen', login, (req, res) => {
  const storage = m.q.storageById.get(req.params.id);
  if (!storage) return res.redirect('/lagerorte');

  const { total } = m.storageContents(storage.id);
  // Inhalt geht nicht verloren, er liegt danach im Lager ohne Ort.
  db.transaction(() => {
    db.prepare('UPDATE equipment SET storage_id = NULL WHERE storage_id = ?').run(storage.id);
    db.prepare('DELETE FROM storages WHERE id = ?').run(storage.id);
  })();

  audit.log(
    req,
    'lagerort',
    storage.id,
    'gelöscht',
    `${storage.name}${total ? `, ${total} Teile ohne Ort ins Lager` : ''}`
  );
  req.session.flash = {
    type: 'ok',
    text: `Lagerort „${storage.name}“ gelöscht.${total ? ' Der Inhalt liegt jetzt im Lager ohne Ort.' : ''}`,
  };
  res.redirect('/lagerorte');
});

module.exports = router;
