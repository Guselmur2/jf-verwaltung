'use strict';

const multer = require('multer');

// Nur eine einzige Stelle nimmt Dateien entgegen: das Einspielen einer Sicherung
// bei der Ersteinrichtung. Die Datei bleibt im Arbeitsspeicher — Sicherungen
// sind klein, und so liegt nichts unverschluesselt auf der Platte herum.
//
// Diese Auswertung muss vor der CSRF-Pruefung laufen, sonst steht das Token aus
// dem Formular dort noch nicht zur Verfuegung.
const sicherungHochladen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024, files: 1 },
}).single('sicherung');

module.exports = { sicherungHochladen };
