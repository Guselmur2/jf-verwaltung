'use strict';

const express = require('express');
const auth = require('../auth');
const audit = require('../audit');

const router = express.Router();

router.get('/anmelden', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('anmelden', { title: 'Anmelden', error: null, username: '' });
});

router.post('/anmelden', (req, res) => {
  const username = (req.body.username || '').trim();
  const user = auth.verify(username, req.body.password || '');

  if (!user) {
    return res.status(401).render('anmelden', {
      title: 'Anmelden',
      error: 'Benutzername oder Passwort stimmt nicht.',
      username,
    });
  }

  const target = req.session.returnTo || '/';
  // Session-ID nach dem Login wechseln (Schutz gegen Session Fixation).
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.user = { id: user.id, name: user.name, username: user.username, role: user.role };
    req.session.flash = { type: 'ok', text: `Angemeldet als ${user.name}.` };
    audit.log(req, 'user', user.id, 'Anmeldung', null);
    res.redirect(target);
  });
});

router.post('/abmelden', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

router.get('/passwort', auth.requireLogin, (req, res) => {
  res.render('passwort', { title: 'Passwort ändern', error: null });
});

router.post('/passwort', auth.requireLogin, (req, res) => {
  const { password, password2 } = req.body;
  const current = req.body.current || '';
  const fail = (error) => res.status(400).render('passwort', { title: 'Passwort ändern', error });

  if (!auth.verify(req.session.user.username, current)) return fail('Das aktuelle Passwort stimmt nicht.');
  if ((password || '').length < 8) return fail('Das neue Passwort muss mindestens 8 Zeichen lang sein.');
  if (password !== password2) return fail('Die beiden neuen Passwörter stimmen nicht überein.');

  auth.setPassword(req.session.user.id, password);
  audit.log(req, 'user', req.session.user.id, 'Passwort geändert', null);
  req.session.flash = { type: 'ok', text: 'Passwort geändert.' };
  res.redirect('/');
});

module.exports = router;
