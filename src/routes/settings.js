'use strict';

const express = require('express');
const auth = require('../auth');
const audit = require('../audit');
const settings = require('../settings');

const router = express.Router();

router.get('/stammdaten', auth.requireJugendwart, (req, res) => {
  res.render('stammdaten', { title: 'Stammdaten', daten: settings.alle(), standard: settings.STANDARD });
});

router.post('/stammdaten', auth.requireJugendwart, (req, res) => {
  const geaendert = settings.speichern(req.body);
  const felder = Object.keys(geaendert);
  if (felder.length) {
    audit.log(req, 'stammdaten', null, 'geändert', felder.map((f) => `${f}: ${geaendert[f]}`).join(', '));
    req.session.flash = { type: 'ok', text: 'Stammdaten gespeichert.' };
  }
  res.redirect('/stammdaten');
});

router.post('/stammdaten/logo', auth.requireJugendwart, (req, res) => {
  try {
    const { mime, groesse } = settings.logoSpeichern(req.file && req.file.buffer);
    audit.log(req, 'stammdaten', null, 'Logo gesetzt', `${mime}, ${Math.round(groesse / 1024)} kB`);
    req.session.flash = { type: 'ok', text: 'Logo gespeichert.' };
  } catch (err) {
    if (!err.code) throw err;
    req.session.flash = { type: 'warn', text: err.message };
  }
  res.redirect('/stammdaten');
});

router.post('/stammdaten/logo/loeschen', auth.requireJugendwart, (req, res) => {
  if (settings.logoLoeschen()) {
    audit.log(req, 'stammdaten', null, 'Logo entfernt', null);
    req.session.flash = { type: 'ok', text: 'Logo entfernt.' };
  }
  res.redirect('/stammdaten');
});

/**
 * Das Logo. Ohne Anmeldung erreichbar, weil es auch auf der Spint-Seite steht,
 * die man ueber den QR-Code am Spint aufruft.
 *
 * SVG darf hier hochgeladen werden, und ein SVG kann Skript enthalten. Damit
 * daraus nichts wird, wenn jemand die Adresse direkt aufruft: strenge
 * Content-Security-Policy und kein Erraten des Typs durch den Browser.
 */
router.get('/logo', (req, res) => {
  const bild = settings.logo();
  if (!bild) return res.status(404).end();

  res.set('Content-Type', bild.mime);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  // Die Adresse traegt beim Einbinden einen Stand-Parameter, darum darf lange
  // gecacht werden.
  res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.send(bild.daten);
});

module.exports = router;
