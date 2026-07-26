'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

function hasUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

function findByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
}

function verify(username, password) {
  const user = findByUsername(username);
  if (!user) {
    // Gleiche Laufzeit wie ein echter Treffer, damit ein Angreifer aus der
    // Antwortzeit nicht ablesen kann, ob es den Benutzer gibt.
    bcrypt.compareSync(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    return null;
  }
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

function createUser({ username, name, password, role }) {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username.trim(), name.trim(), hash, role);
  return info.lastInsertRowid;
}

function setPassword(id, password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
}

/** Stellt Anmeldedaten und CSRF-Token fuer alle Templates bereit. */
function locals(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.isJugendwart = req.session.user?.role === 'jugendwart';
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.path = req.path;
  next();
}

/** Prueft das CSRF-Token bei allen schreibenden Anfragen. */
function csrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const token = req.body?._csrf;
  if (!token || token !== req.session.csrf) {
    return res.status(403).render('fehler', {
      title: 'Abgelaufen',
      message: 'Das Formular war zu lange offen oder die Anmeldung ist abgelaufen. Bitte die Seite neu laden und erneut versuchen.',
    });
  }
  next();
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  req.session.returnTo = req.originalUrl;
  req.session.flash = { type: 'info', text: 'Bitte zuerst als Betreuer anmelden.' };
  res.redirect('/anmelden');
}

function requireJugendwart(req, res, next) {
  if (req.session.user?.role === 'jugendwart') return next();
  if (!req.session.user) return requireLogin(req, res, next);
  res.status(403).render('fehler', {
    title: 'Keine Berechtigung',
    message: 'Diese Seite ist dem Jugendwart vorbehalten.',
  });
}

module.exports = {
  hasUsers,
  findByUsername,
  verify,
  createUser,
  setPassword,
  locals,
  csrf,
  requireLogin,
  requireJugendwart,
};
