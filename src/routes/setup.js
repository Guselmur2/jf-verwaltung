'use strict';

const express = require('express');
const auth = require('../auth');
const audit = require('../audit');

const router = express.Router();

router.get('/einrichtung', (req, res) => {
  if (auth.hasUsers()) return res.redirect('/');
  res.render('einrichtung', { title: 'Ersteinrichtung', error: null, values: {} });
});

router.post('/einrichtung', (req, res) => {
  if (auth.hasUsers()) return res.redirect('/');

  const values = {
    name: (req.body.name || '').trim(),
    username: (req.body.username || '').trim(),
  };
  const password = req.body.password || '';
  const password2 = req.body.password2 || '';

  const fail = (error) => res.status(400).render('einrichtung', { title: 'Ersteinrichtung', error, values });

  if (!values.name || !values.username) return fail('Bitte Name und Benutzername ausfüllen.');
  if (password.length < 8) return fail('Das Passwort muss mindestens 8 Zeichen lang sein.');
  if (password !== password2) return fail('Die beiden Passwörter stimmen nicht überein.');

  const id = auth.createUser({ ...values, password, role: 'jugendwart' });
  req.session.user = { id, name: values.name, username: values.username, role: 'jugendwart' };
  audit.log(req, 'user', id, 'Ersteinrichtung', `Jugendwart ${values.username} angelegt`);
  req.session.flash = { type: 'ok', text: 'Einrichtung abgeschlossen. Du bist als Jugendwart angemeldet.' };
  res.redirect('/');
});

module.exports = router;
