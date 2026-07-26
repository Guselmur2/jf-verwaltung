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

// Barcode-Bibliothek direkt aus node_modules ausliefern. So bleibt sie beim
// Update automatisch aktuell und es braucht keinen Build-Schritt — wichtig,
// weil der Pi offline laeuft und nichts von einem CDN nachladen kann.
app.use(
  '/vendor',
  express.static(path.join(__dirname, 'node_modules', 'html5-qrcode'), {
    maxAge: '30d',
    index: false,
    extensions: false,
  })
);

// CSS und JS werden lange gecacht. Damit nach einem Update trotzdem die neue
// Fassung ankommt, haengt an den URLs der Aenderungszeitpunkt der Dateien.
app.locals.assetVersion = ['style.css', 'app.js', 'scanner.js']
  .map((f) => Math.round(fs.statSync(path.join(__dirname, 'public', f)).mtimeMs))
  .reduce((a, b) => Math.max(a, b), 0)
  .toString(36);

// In allen Vorlagen verfuegbar: Geschlechts-Beschriftungen und Datumsformat.
app.locals.GENDER = model.GENDER;
app.locals.GENDER_GROUP = model.GENDER_GROUP;
app.locals.TASK_KIND = model.TASK_KIND;
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

// Ob nach Umkleidebereichen unterschieden wird und wie viele Aufgaben offen
// sind, brauchen viele Vorlagen (Navigation, Uebersicht). Muss vor der
// CSRF-Pruefung stehen, weil auch deren Fehlerseite die Navigation rendert.
app.use((req, res, next) => {
  if (req.path.startsWith('/static')) return next();
  res.locals.showAreas = model.showAreas();
  res.locals.offeneAufgaben = req.session.user ? model.openTaskCount() : 0;
  next();
});

app.use(auth.csrf);

// Solange kein Benutzer existiert, fuehrt jede Seite zur Ersteinrichtung.
app.use((req, res, next) => {
  if (req.path.startsWith('/einrichtung') || req.path.startsWith('/static')) return next();
  if (!auth.hasUsers()) return res.redirect('/einrichtung');
  next();
});

// Ohne Anmeldung ist grundsaetzlich alles gesperrt. Offen sind nur die
// Anmeldung, statische Dateien und die beiden Token-Adressen, die in den
// QR-Codes stehen. Absichtlich als Positivliste: eine neue Seite ist damit
// automatisch geschuetzt, statt versehentlich oeffentlich zu sein.
const OHNE_ANMELDUNG = [
  /^\/anmelden$/,
  /^\/abmelden$/,
  /^\/einrichtung$/,
  /^\/static\//,
  /^\/vendor\//,
  /^\/s\/[a-z2-9]+$/, // Spint per QR-Code
  /^\/l\/[a-z2-9]+$/, // Lagerort per QR-Code
];

app.use((req, res, next) => {
  if (req.session.user) return next();
  if (OHNE_ANMELDUNG.some((muster) => muster.test(req.path))) return next();

  // Nach dem Anmelden dorthin zurueck, wo man hinwollte.
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.session.flash = {
    type: 'info',
    text: 'Ohne Anmeldung sind nur die Spint-Seiten per QR-Code sichtbar. Bitte anmelden.',
  };
  res.redirect('/anmelden');
});

app.use(require('./src/routes/setup'));
app.use(require('./src/routes/auth'));
app.use(require('./src/routes/public'));
app.use(require('./src/routes/areas'));
app.use(require('./src/routes/lockers'));
app.use(require('./src/routes/storages'));
app.use(require('./src/routes/equipment'));
app.use(require('./src/routes/tasks'));
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

// Browser geben die Kamera nur in einem "sicheren Kontext" frei, also ueber
// HTTPS oder auf localhost. Fuer den Barcode-Scan am Handy braucht es deshalb
// ein Zertifikat; ohne TLS_KEY/TLS_CERT laeuft alles wie bisher ueber HTTP.
function createServer() {
  const keyFile = process.env.TLS_KEY;
  const certFile = process.env.TLS_CERT;
  if (!keyFile || !certFile) return { server: require('http').createServer(app), schema: 'http' };

  try {
    const options = { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
    return { server: require('https').createServer(options, app), schema: 'https' };
  } catch (err) {
    console.error(`TLS-Zertifikat konnte nicht gelesen werden (${err.message}).`);
    console.error('Server startet ohne HTTPS — der Barcode-Scan funktioniert dann nur auf localhost.');
    return { server: require('http').createServer(app), schema: 'http' };
  }
}

const { server, schema } = createServer();

server.listen(PORT, HOST, () => {
  console.log(`Spintverwaltung laeuft auf ${schema}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Datenbank: ${DB_FILE}`);
  if (schema === 'http') {
    console.log('Hinweis: ohne HTTPS gibt der Browser die Kamera nur auf localhost frei (Barcode-Scan).');
  }
});
