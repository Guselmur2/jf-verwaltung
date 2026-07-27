'use strict';

const express = require('express');
const auth = require('../auth');
const audit = require('../audit');
const backup = require('../backup');
const api = require('../api-auth');

const router = express.Router();
const jw = auth.requireJugendwart;

// ------------------------------------------------------------ Datensicherung

router.get('/sicherung', jw, (req, res) => {
  res.render('sicherung', {
    title: 'Datensicherung',
    info: backup.info(),
    basis: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
  });
});

router.post('/sicherung/herunterladen', jw, async (req, res, next) => {
  const passwort = req.body.passwort || '';
  const fehler = backup.passwortPruefen(passwort);
  if (fehler || passwort !== req.body.passwort2) {
    req.session.flash = {
      type: 'warn',
      text: fehler || 'Die beiden Passwörter stimmen nicht überein.',
    };
    return res.redirect('/sicherung');
  }

  try {
    const s = await backup.erstellen(passwort);
    audit.log(req, 'sicherung', null, 'heruntergeladen', `${s.name}, ${Math.round(s.groesse / 1024)} kB, verschlüsselt`);
    res.download(s.pfad, s.name, (err) => {
      backup.aufraeumen(s.ordner);
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------- API-Zugänge

router.get('/api-zugaenge', jw, (req, res) => {
  // Ein frisch erzeugter Token wird genau einmal angezeigt und danach vergessen.
  const frisch = req.session.neuerApiToken || null;
  delete req.session.neuerApiToken;

  res.render('api-zugaenge', {
    title: 'API-Zugänge',
    tokens: api.liste(),
    frisch,
    basis: `${req.protocol}://${req.get('host')}`,
  });
});

router.post('/api-zugaenge/neu', jw, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    req.session.flash = { type: 'warn', text: 'Bitte einen Namen angeben, damit klar bleibt, wofür der Zugang ist.' };
    return res.redirect('/api-zugaenge');
  }

  const { id, token } = api.anlegen({
    name,
    scope: req.body.scope,
    erstelltVon: req.session.user.name,
  });

  audit.log(req, 'api', id, 'angelegt', `${name} (${req.body.scope === 'schreiben' ? 'lesen und schreiben' : 'nur lesen'})`);
  req.session.neuerApiToken = { name, token };
  res.redirect('/api-zugaenge');
});

router.post('/api-zugaenge/:id/status', jw, (req, res) => {
  const eintrag = api.liste().find((t) => String(t.id) === req.params.id);
  if (!eintrag) return res.redirect('/api-zugaenge');

  api.setzeAktiv(eintrag.id, !eintrag.active);
  audit.log(req, 'api', eintrag.id, eintrag.active ? 'gesperrt' : 'entsperrt', eintrag.name);
  req.session.flash = {
    type: 'ok',
    text: eintrag.active ? `Zugang „${eintrag.name}“ gesperrt.` : `Zugang „${eintrag.name}“ wieder freigegeben.`,
  };
  res.redirect('/api-zugaenge');
});

router.post('/api-zugaenge/:id/loeschen', jw, (req, res) => {
  const eintrag = api.liste().find((t) => String(t.id) === req.params.id);
  if (!eintrag) return res.redirect('/api-zugaenge');

  api.loeschen(eintrag.id);
  audit.log(req, 'api', eintrag.id, 'gelöscht', eintrag.name);
  req.session.flash = { type: 'ok', text: `Zugang „${eintrag.name}“ gelöscht.` };
  res.redirect('/api-zugaenge');
});

module.exports = router;
