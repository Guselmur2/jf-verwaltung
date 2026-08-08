'use strict';

const express = require('express');
const auth = require('../auth');
const audit = require('../audit');
const restore = require('../restore');

const router = express.Router();

function seite(res, status, extra = {}) {
  res.status(status).render('einrichtung', {
    title: 'Ersteinrichtung',
    error: null,
    sicherungsFehler: null,
    values: {},
    ...extra,
  });
}

router.get('/einrichtung', (req, res) => {
  if (auth.hasUsers()) return res.redirect('/');
  seite(res, 200);
});

router.post('/einrichtung', (req, res) => {
  if (auth.hasUsers()) return res.redirect('/');

  const values = {
    name: (req.body.name || '').trim(),
    username: (req.body.username || '').trim(),
  };
  const password = req.body.password || '';
  const password2 = req.body.password2 || '';

  const fail = (error) => seite(res, 400, { error, values });

  if (!values.name || !values.username) return fail('Bitte Name und Benutzername ausfüllen.');
  if (password.length < 8) return fail('Das Passwort muss mindestens 8 Zeichen lang sein.');
  if (password !== password2) return fail('Die beiden Passwörter stimmen nicht überein.');

  const id = auth.createUser({ ...values, password, role: 'jugendwart' });
  req.session.user = { id, name: values.name, username: values.username, role: 'jugendwart' };
  audit.log(req, 'user', id, 'Ersteinrichtung', `Jugendwart ${values.username} angelegt`);
  req.session.flash = { type: 'ok', text: 'Einrichtung abgeschlossen. Du bist als Jugendwart angemeldet.' };
  res.redirect('/');
});

// Zweiter Weg: statt bei null anzufangen einen gesicherten Bestand einspielen.
// Nur solange es noch keinen Zugang gibt — danach ist die Seite gesperrt und
// niemand kann damit die laufenden Daten ueberschreiben.
// Die Datei wurde bereits in server.js entgegengenommen (vor der CSRF-Pruefung).
router.post('/einrichtung/sicherung', async (req, res) => {
  if (auth.hasUsers()) return res.redirect('/');

  const fail = (sicherungsFehler) => seite(res, 400, { sicherungsFehler });

  if (!req.file || !req.file.buffer?.length) return fail('Bitte eine Sicherungsdatei auswählen.');
  if (!req.body.passwort) return fail('Bitte das Passwort der Sicherung eingeben.');

  let bericht;
  try {
    bericht = await restore.ausSicherung(req.file.buffer, req.body.passwort);
  } catch (err) {
    if (err.code === 'PASSWORT' || err.code === 'FORMAT' || err.code === 'VERSION') return fail(err.message);
    console.error('Wiederherstellung fehlgeschlagen:', err);
    return fail('Die Sicherung konnte nicht eingespielt werden: ' + err.message);
  }

  if (!bericht.benutzer) {
    return fail(
      'In der Sicherung ist kein Zugang enthalten — damit käme niemand mehr hinein. ' +
        'Bitte stattdessen einen neuen Zugang anlegen.'
    );
  }

  audit.log(
    { session: {} },
    'sicherung',
    null,
    'eingespielt',
    `${bericht.mitglieder} Mitglieder, ${bericht.spinte} Spinte, ${bericht.ausruestung} Teile`
  );

  req.session.flash = {
    type: 'ok',
    text:
      `Sicherung eingespielt: ${bericht.mitglieder} Mitglieder, ${bericht.spinte} Spinte, ` +
      `${bericht.ausruestung} Teile. Bitte mit den bisherigen Zugangsdaten anmelden.`,
  };
  res.redirect('/anmelden');
});

module.exports = router;
