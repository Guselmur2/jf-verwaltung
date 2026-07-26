'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');

const router = express.Router();
const jw = auth.requireJugendwart;

function areaGenderList(areaId, gmap) {
  return m.GENDERS.filter((g) => gmap[g] === areaId)
    .map((g) => m.GENDER_GROUP[g])
    .join(', ');
}

function nextSort() {
  return (db.prepare('SELECT MAX(sort_order) AS mx FROM areas').get().mx || 100) + 10;
}

// ------------------------------------------------ Einrichtung eines neuen Bereichs

// Wird nach dem Anlegen des ersten Mitglieds eines neuen Geschlechts angezeigt.
router.get('/bereiche/einrichten', jw, (req, res) => {
  const gender = req.query.geschlecht;
  if (!m.GENDERS.includes(gender)) return res.redirect('/bereiche');

  res.render('bereich-einrichten', {
    title: 'Umkleidebereich einrichten',
    gender,
    genderLabel: m.GENDER[gender],
    groupLabel: m.GENDER_GROUP[gender],
    areas: m.areasAll(),
    gmap: m.genderAreaMap(),
    vorschlag: m.DEFAULT_AREA_NAME[gender] || 'Umkleide',
  });
});

router.post('/bereiche/einrichten', jw, (req, res) => {
  const gender = req.query.geschlecht || req.body.geschlecht;
  if (!m.GENDERS.includes(gender)) return res.redirect('/bereiche');

  if (req.body.modus === 'eigen') {
    const name = (req.body.name || '').trim() || m.DEFAULT_AREA_NAME[gender] || 'Umkleide';
    const numbering = req.body.numbering === 'fortlaufend' ? 'fortlaufend' : 'eigen';
    const info = db
      .prepare('INSERT INTO areas (name, numbering, sort_order) VALUES (?, ?, ?)')
      .run(name, numbering, nextSort());
    m.setGenderArea(gender, info.lastInsertRowid);
    audit.log(
      req,
      'bereich',
      info.lastInsertRowid,
      'angelegt',
      `${name} für ${m.GENDER_GROUP[gender]}, Nummerierung ${numbering === 'eigen' ? 'neu ab 1' : 'fortlaufend'}`
    );
    req.session.flash = { type: 'ok', text: `Eigener Bereich „${name}“ für ${m.GENDER_GROUP[gender]} angelegt.` };
  } else {
    // Geteilt: einem bestehenden Bereich zuordnen.
    const areaId = Number(req.body.area_id) || m.primaryArea()?.id;
    const area = areaId ? m.q.areaById.get(areaId) : null;
    if (!area) {
      req.session.flash = { type: 'warn', text: 'Bereich nicht gefunden.' };
      return res.redirect('/bereiche');
    }
    m.setGenderArea(gender, area.id);
    audit.log(req, 'bereich', area.id, 'zugeordnet', `${m.GENDER_GROUP[gender]} → ${area.name}`);
    req.session.flash = { type: 'ok', text: `${m.GENDER_GROUP[gender]} teilen sich den Bereich „${area.name}“.` };
  }
  res.redirect('/mitglieder');
});

// ------------------------------------------------------------ Verwaltung

router.get('/bereiche', jw, (req, res) => {
  const gmap = m.genderAreaMap();
  const areas = m.areasAll().map((a) => ({
    ...a,
    genders: areaGenderList(a.id, gmap),
    locker_count: db.prepare('SELECT COUNT(*) AS n FROM lockers WHERE area_id = ?').get(a.id).n,
  }));
  res.render('bereiche', {
    title: 'Umkleidebereiche',
    areas,
    gmap,
    genders: m.GENDERS,
    gendersWithMembers: m.gendersWithMembers(),
  });
});

router.post('/bereiche/neu', jw, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    req.session.flash = { type: 'warn', text: 'Bitte einen Namen angeben.' };
    return res.redirect('/bereiche');
  }
  const numbering = req.body.numbering === 'fortlaufend' ? 'fortlaufend' : 'eigen';
  const info = db
    .prepare('INSERT INTO areas (name, numbering, sort_order) VALUES (?, ?, ?)')
    .run(name, numbering, nextSort());
  audit.log(req, 'bereich', info.lastInsertRowid, 'angelegt', name);
  req.session.flash = { type: 'ok', text: `Bereich „${name}“ angelegt.` };
  res.redirect('/bereiche');
});

router.post('/bereiche/:id/bearbeiten', jw, (req, res) => {
  const area = m.q.areaById.get(req.params.id);
  if (!area) return res.redirect('/bereiche');

  const name = (req.body.name || '').trim() || area.name;
  const numbering = req.body.numbering === 'fortlaufend' ? 'fortlaufend' : 'eigen';
  const sort = Number(req.body.sort_order) || area.sort_order;

  db.prepare('UPDATE areas SET name = ?, numbering = ?, sort_order = ? WHERE id = ?').run(
    name,
    numbering,
    sort,
    area.id
  );
  const detail = audit.diff(
    { name: 'Name', numbering: 'Nummerierung', sort_order: 'Reihenfolge' },
    area,
    { name, numbering, sort_order: sort }
  );
  if (detail) audit.log(req, 'bereich', area.id, 'geändert', detail);
  req.session.flash = { type: 'ok', text: 'Gespeichert.' };
  res.redirect('/bereiche');
});

// Geschlecht einem Bereich zuordnen.
router.post('/bereiche/zuordnung', jw, (req, res) => {
  const gender = req.body.gender;
  const areaId = Number(req.body.area_id);
  if (!m.GENDERS.includes(gender) || !m.q.areaById.get(areaId)) return res.redirect('/bereiche');

  m.setGenderArea(gender, areaId);
  audit.log(req, 'bereich', areaId, 'zugeordnet', `${m.GENDER_GROUP[gender]} → ${m.q.areaById.get(areaId).name}`);
  req.session.flash = { type: 'ok', text: `${m.GENDER_GROUP[gender]} → ${m.q.areaById.get(areaId).name}.` };
  res.redirect('/bereiche');
});

router.post('/bereiche/:id/loeschen', jw, (req, res) => {
  const area = m.q.areaById.get(req.params.id);
  if (!area) return res.redirect('/bereiche');

  const lockerCount = db.prepare('SELECT COUNT(*) AS n FROM lockers WHERE area_id = ?').get(area.id).n;
  if (lockerCount > 0) {
    req.session.flash = { type: 'warn', text: `„${area.name}“ enthält noch ${lockerCount} Spint(e).` };
    return res.redirect('/bereiche');
  }
  if (m.areasAll().length <= 1) {
    req.session.flash = { type: 'warn', text: 'Der letzte Bereich kann nicht gelöscht werden.' };
    return res.redirect('/bereiche');
  }

  // Zugeordnete Geschlechter fallen per ON DELETE CASCADE weg und werden beim
  // naechsten Anlegen erneut zugeordnet.
  db.prepare('DELETE FROM areas WHERE id = ?').run(area.id);
  audit.log(req, 'bereich', area.id, 'gelöscht', area.name);
  req.session.flash = { type: 'ok', text: `Bereich „${area.name}“ gelöscht.` };
  res.redirect('/bereiche');
});

module.exports = router;
