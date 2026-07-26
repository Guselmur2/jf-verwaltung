'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');

const router = express.Router();
const jw = auth.requireJugendwart;

const ROLES = ['betreuer', 'jugendwart'];
const ROLE_LABEL = { betreuer: 'Betreuer', jugendwart: 'Jugendwart' };

function jugendwartCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'jugendwart' AND active = 1").get().n;
}

router.get('/betreuer', jw, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY active DESC, role, name COLLATE NOCASE').all();
  res.render('betreuer', { title: 'Betreuer', users, roleLabel: ROLE_LABEL });
});

router.post('/betreuer/neu', jw, (req, res) => {
  const name = (req.body.name || '').trim();
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const role = ROLES.includes(req.body.role) ? req.body.role : 'betreuer';

  const warn = (text) => {
    req.session.flash = { type: 'warn', text };
    res.redirect('/betreuer');
  };

  if (!name || !username) return warn('Bitte Name und Benutzername angeben.');
  if (password.length < 8) return warn('Das Passwort muss mindestens 8 Zeichen lang sein.');

  try {
    const id = auth.createUser({ username, name, password, role });
    audit.log(req, 'user', id, 'angelegt', `${name} (${username}, ${ROLE_LABEL[role]})`);
    req.session.flash = { type: 'ok', text: `${ROLE_LABEL[role]} ${name} angelegt.` };
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    return warn(`Der Benutzername "${username}" ist schon vergeben.`);
  }
  res.redirect('/betreuer');
});

router.post('/betreuer/:id/rolle', jw, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.redirect('/betreuer');

  const role = user.role === 'jugendwart' ? 'betreuer' : 'jugendwart';
  // Nie den letzten aktiven Jugendwart degradieren — sonst sperrt sich die
  // Wehr aus der Benutzerverwaltung aus.
  if (role === 'betreuer' && user.active && jugendwartCount() <= 1) {
    req.session.flash = { type: 'warn', text: 'Es muss mindestens ein aktiver Jugendwart bleiben.' };
    return res.redirect('/betreuer');
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  audit.log(req, 'user', user.id, 'Rolle geändert', `${user.name}: ${ROLE_LABEL[user.role]} → ${ROLE_LABEL[role]}`);
  if (user.id === req.session.user.id) req.session.user.role = role;
  req.session.flash = { type: 'ok', text: `${user.name} ist jetzt ${ROLE_LABEL[role]}.` };
  res.redirect('/betreuer');
});

router.post('/betreuer/:id/status', jw, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.redirect('/betreuer');

  const active = user.active ? 0 : 1;
  if (!active && user.role === 'jugendwart' && jugendwartCount() <= 1) {
    req.session.flash = { type: 'warn', text: 'Es muss mindestens ein aktiver Jugendwart bleiben.' };
    return res.redirect('/betreuer');
  }
  if (!active && user.id === req.session.user.id) {
    req.session.flash = { type: 'warn', text: 'Sich selbst kann man nicht deaktivieren.' };
    return res.redirect('/betreuer');
  }

  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, user.id);
  audit.log(req, 'user', user.id, active ? 'reaktiviert' : 'deaktiviert', user.name);
  req.session.flash = { type: 'ok', text: active ? `${user.name} kann sich wieder anmelden.` : `${user.name} deaktiviert.` };
  res.redirect('/betreuer');
});

router.post('/betreuer/:id/passwort', jw, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.redirect('/betreuer');

  const password = req.body.password || '';
  if (password.length < 8) {
    req.session.flash = { type: 'warn', text: 'Das Passwort muss mindestens 8 Zeichen lang sein.' };
    return res.redirect('/betreuer');
  }

  auth.setPassword(user.id, password);
  audit.log(req, 'user', user.id, 'Passwort zurückgesetzt', user.name);
  req.session.flash = { type: 'ok', text: `Neues Passwort für ${user.name} gesetzt.` };
  res.redirect('/betreuer');
});

router.post('/betreuer/:id/loeschen', jw, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.redirect('/betreuer');

  if (user.id === req.session.user.id) {
    req.session.flash = { type: 'warn', text: 'Den eigenen Zugang kann man nicht löschen.' };
    return res.redirect('/betreuer');
  }
  if (user.role === 'jugendwart' && user.active && jugendwartCount() <= 1) {
    req.session.flash = { type: 'warn', text: 'Es muss mindestens ein aktiver Jugendwart bleiben.' };
    return res.redirect('/betreuer');
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  audit.log(req, 'user', user.id, 'gelöscht', `${user.name} (${user.username})`);
  req.session.flash = { type: 'ok', text: `Zugang von ${user.name} gelöscht.` };
  res.redirect('/betreuer');
});

module.exports = router;
