'use strict';

const multer = require('multer');

// Zwei Stellen nehmen Dateien entgegen: das Einspielen einer Sicherung bei der
// Ersteinrichtung und das Logo in den Stammdaten. Beide Dateien bleiben im
// Arbeitsspeicher — sie sind klein, und so liegt nichts unverschluesselt auf der
// Platte herum.
//
// Diese Auswertung muss vor der CSRF-Pruefung laufen, sonst steht das Token aus
// dem Formular dort noch nicht zur Verfuegung.
const sicherungHochladen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024, files: 1 },
}).single('sicherung');

// Das Logo landet in der Datenbank, darum eng begrenzt. Ob es wirklich ein Bild
// ist, prueft settings.js am Dateiinhalt.
const logoHochladen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
}).single('logo');

// Ist die Datei zu gross, bricht multer mit einem Fehler ab. Der soll nicht als
// Serverfehler enden, sondern als verstaendlicher Hinweis auf der Seite.
function logoHochladenFreundlich(req, res, next) {
  logoHochladen(req, res, (err) => {
    if (!err) return next();
    if (req.session && req.session.user) {
      req.session.flash = {
        type: 'warn',
        text:
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Das Bild ist größer als 2 MB. Bitte kleiner speichern und erneut hochladen.'
            : 'Die Datei konnte nicht gelesen werden.',
      };
    }
    res.redirect('/stammdaten');
  });
}

// Beim Zurueckspielen in eine laufende Installation ist die Datei optional —
// man kann auch einen Stand vom USB-Stick waehlen. Darum hier kein Zwang.
const restoreHochladen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024, files: 1 },
}).single('sicherung');

module.exports = {
  sicherungHochladen,
  logoHochladen: logoHochladenFreundlich,
  restoreHochladen,
};
