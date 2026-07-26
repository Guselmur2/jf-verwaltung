'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');
const { neuerToken } = require('../tokens');

const router = express.Router();
const login = auth.requireLogin;

const FIELDS = { code: 'Nummer', label: 'Bezeichnung', location: 'Standort', note: 'Notiz' };

function clean(body) {
  return {
    code: (body.code || '').trim(),
    label: (body.label || '').trim() || null,
    location: (body.location || '').trim() || null,
    note: (body.note || '').trim() || null,
    area_id: body.area_id ? Number(body.area_id) : null,
    member_id: body.member_id ? Number(body.member_id) : null,
  };
}

// Gemeinsame Daten fuer das Bearbeiten-Formular.
function formData(locker, extra = {}) {
  const areaId = extra.area_id ?? locker?.area_id ?? m.primaryArea()?.id ?? null;
  const area = areaId ? m.q.areaById.get(areaId) : null;
  return {
    locker,
    areas: m.areasAll(),
    area_id: areaId,
    vorschlag: locker ? locker.code : m.suggestNextCode(area),
    members: m.assignableMembers(locker?.member_id ?? null, areaId),
    items: locker ? m.equipmentOfLocker(locker.id) : [],
    types: m.activeTypes(),
    storage: locker ? m.storageEquipment() : [],
    storagePlaces: m.storagesAll(),
    error: null,
    ...extra,
  };
}

router.get('/spinte/neu', login, (req, res) => {
  const area = m.primaryArea() ? m.ensureDefaultArea() : null;
  res.render('spint-bearbeiten', {
    title: 'Neuer Spint',
    ...formData(null, {
      area_id: area?.id ?? null,
      vorschlag: area ? m.suggestNextCode(area) : m.suggestNextCode(null),
    }),
  });
});

router.post('/spinte/neu', login, (req, res) => {
  const data = clean(req.body);
  // Ohne ausgewaehlten Bereich landet der Spint im (Standard-)Hauptbereich.
  const area = data.area_id ? m.q.areaById.get(data.area_id) : m.ensureDefaultArea();
  data.area_id = area ? area.id : null;

  const rerender = (error, status = 400) =>
    res.status(status).render('spint-bearbeiten', {
      title: 'Neuer Spint',
      ...formData(null, { ...data, area_id: data.area_id, vorschlag: data.code, error }),
    });

  if (!data.code) return rerender('Die Spint-Nummer darf nicht leer sein.');

  try {
    const info = db
      .prepare(
        'INSERT INTO lockers (code, token, label, location, note, area_id, member_id) ' +
          'VALUES (@code, @token, @label, @location, @note, @area_id, @member_id)'
      )
      .run({ ...data, token: neuerToken() });
    audit.log(req, 'spint', info.lastInsertRowid, 'angelegt', `Spint ${data.code}${area ? ` (${area.name})` : ''}`);
    req.session.flash = { type: 'ok', text: `Spint ${data.code} angelegt.` };
    res.redirect(`/spint/${info.lastInsertRowid}/bearbeiten`);
  } catch (err) {
    rerender(conflictMessage(err, data));
  }
});

router.get('/spint/:id/bearbeiten', login, (req, res) => {
  const locker = m.q.lockerById.get(req.params.id);
  if (!locker) return res.status(404).render('fehler', { title: 'Spint unbekannt', message: 'Diesen Spint gibt es nicht.' });

  res.render('spint-bearbeiten', {
    title: `Spint ${locker.code} bearbeiten`,
    ...formData(locker, { vorschlag: locker.code }),
  });
});

router.post('/spint/:id/bearbeiten', login, (req, res) => {
  const locker = m.q.lockerById.get(req.params.id);
  if (!locker) return res.status(404).render('fehler', { title: 'Spint unbekannt', message: 'Diesen Spint gibt es nicht.' });

  const data = clean(req.body);
  if (!data.code) data.code = locker.code;
  const area = data.area_id ? m.q.areaById.get(data.area_id) : m.q.areaById.get(locker.area_id);
  data.area_id = area ? area.id : locker.area_id;

  const rerender = (error) =>
    res.status(400).render('spint-bearbeiten', {
      title: `Spint ${locker.code} bearbeiten`,
      ...formData({ ...locker, ...data }, { vorschlag: data.code, error }),
    });

  try {
    db.prepare(
      'UPDATE lockers SET code = @code, label = @label, location = @location, note = @note, ' +
        'area_id = @area_id, member_id = @member_id WHERE id = @id'
    ).run({ ...data, id: locker.id });
  } catch (err) {
    return rerender(conflictMessage(err, data));
  }

  const before = { ...locker, member: memberName(locker.member_id), area: areaName(locker.area_id) };
  const after = { ...data, member: memberName(data.member_id), area: areaName(data.area_id) };
  const detail = audit.diff({ ...FIELDS, member: 'Besitzer', area: 'Bereich' }, before, after);
  if (detail) audit.log(req, 'spint', locker.id, 'geändert', detail);

  req.session.flash = { type: 'ok', text: 'Spint gespeichert.' };
  res.redirect(`/spint/${locker.id}`);
});

router.post('/spint/:id/loeschen', login, (req, res) => {
  const locker = m.q.lockerById.get(req.params.id);
  if (!locker) return res.redirect('/');

  const items = m.equipmentOfLocker(locker.id);
  db.transaction(() => {
    // Inhalt geht zurueck ins Lager, statt mit dem Spint zu verschwinden.
    db.prepare('UPDATE equipment SET locker_id = NULL WHERE locker_id = ?').run(locker.id);
    db.prepare('DELETE FROM lockers WHERE id = ?').run(locker.id);
  })();

  audit.log(
    req,
    'spint',
    locker.id,
    'gelöscht',
    `Spint ${locker.code}${items.length ? `, ${items.length} Teile ins Lager verschoben` : ''}`
  );
  req.session.flash = { type: 'ok', text: `Spint ${locker.code} gelöscht. Inhalt liegt jetzt im Lager.` };
  res.redirect('/');
});

function memberName(id) {
  return id ? m.q.memberById.get(id)?.name || '' : '';
}
function areaName(id) {
  return id ? m.q.areaById.get(id)?.name || '' : '';
}

// SQLite nennt in der Meldung die Spalte, nicht den Index.
function conflictMessage(err, data) {
  if (!/UNIQUE/i.test(err.message)) throw err;
  if (/member_id/.test(err.message)) {
    return 'Dieses Mitglied hat bereits einen anderen Spint. Bitte dort zuerst entfernen.';
  }
  return `Die Nummer „${data.code}“ ist in diesem Bereich schon vergeben.`;
}

module.exports = router;
