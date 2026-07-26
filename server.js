'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');

const { init, DB_FILE } = require('./src/db');

// Muss vor allen Modulen laufen, die beim Laden SQL-Statements vorbereiten
// (model.js), damit die Tabellen auf einer frischen Datenbank schon existieren.
init();

const auth = require('./src/auth');
const model = require('./src/model');
const { formatGermanDate } = require('./src/dates');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// CSS und JS werden lange gecacht. Damit nach einem Update trotzdem die neue
// Fassung ankommt, haengt an den URLs der Aenderungszeitpunkt der Dateien.
app.locals.assetVersion = ['style.css', 'app.js']
  .map((f) => Math.round(fs.statSync(path.join(__dirname, 'public', f)).mtimeMs))
  .reduce((a, b) => Math.max(a, b), 0)
  .toString(36);

// In allen Vorlagen verfuegbar: Geschlechts-Beschriftungen und Datumsformat.
app.locals.GENDER = model.GENDER;
app.locals.GENDER_GROUP = model.GENDER_GROUP;
app.locals.datum = formatGermanDate;

const SqliteStore = require('./src/session-store')(session);
app.use(
  session({
    name: 'jfspint.sid',
    store: new SqliteStore(),
    secret: process.env.SESSION_SECRET || 'jugendfeuerwehr-spint-lokal',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12, // 12 Stunden
    },
  })
);

app.use(auth.locals);
app.use(auth.csrf);

// Ob nach Umkleidebereichen unterschieden wird, brauchen viele Vorlagen.
app.use((req, res, next) => {
  if (req.path.startsWith('/static')) return next();
  res.locals.showAreas = model.showAreas();
  next();
});

// Solange kein Benutzer existiert, fuehrt jede Seite zur Ersteinrichtung.
app.use((req, res, next) => {
  if (req.path.startsWith('/einrichtung') || req.path.startsWith('/static')) return next();
  if (!auth.hasUsers()) return res.redirect('/einrichtung');
  next();
});

app.use(require('./src/routes/setup'));
app.use(require('./src/routes/auth'));
app.use(require('./src/routes/public'));
app.use(require('./src/routes/areas'));
app.use(require('./src/routes/lockers'));
app.use(require('./src/routes/equipment'));
app.use(require('./src/routes/members'));
app.use(require('./src/routes/types'));
app.use(require('./src/routes/users'));
app.use(require('./src/routes/history'));

app.use((req, res) => {
  res.status(404).render('fehler', {
    title: 'Nicht gefunden',
    message: 'Diese Seite gibt es nicht. Vielleicht wurde der Spint umbenannt oder entfernt.',
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('fehler', {
    title: 'Fehler',
    message: 'Es ist ein unerwarteter Fehler aufgetreten. Details stehen im Server-Protokoll.',
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Spintverwaltung laeuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Datenbank: ${DB_FILE}`);
});
