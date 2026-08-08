'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const auth = require('../auth');
const { rendern } = require('../markdown');

const router = express.Router();

// Das Handbuch in der Oberfläche.
//
// Es liegt als docs/handbuch.md im Programmordner und wandert damit bei jedem
// Update mit — die laufende Fassung zeigt also immer das Handbuch, das zu ihr
// gehört. Kein Nachschlagen im Internet, kein veralteter Ausdruck im Ordner,
// und im Gerätehaus ohne Netz funktioniert es auch.
//
// Nur für Angemeldete: die Bilder zeigen zwar einen erfundenen Bestand, aber
// die QR-Seiten am Spint sollen nichts anbieten, was von ihnen wegführt.

const DOKU = path.join(__dirname, '..', '..', 'docs');
const BILDER = path.join(DOKU, 'bilder');

const SEITEN = {
  handbuch: { datei: path.join(DOKU, 'handbuch.md'), titel: 'Handbuch' },
  readme: { datei: path.join(DOKU, '..', 'README.md'), titel: 'Technische Beschreibung' },
  datenbank: { datei: path.join(DOKU, 'datenbank.md'), titel: 'Datenbank und Schema-Fassungen' },
};

/**
 * Wohin Verweise und Bilder aus der Markdown-Datei zeigen sollen.
 *
 * Was in der Oberfläche ins Leere liefe — Verweise auf Dateien im Repository
 * etwa —, wird zu reinem Text. Ein Link, der zu einer Fehlerseite führt, ist
 * schlechter als gar keiner.
 */
const adressen = {
  bild(quelle) {
    const treffer = quelle.match(/^(?:\.\/)?bilder\/([\w.-]+\.(?:png|jpe?g|gif|webp|svg))$/i);
    return treffer ? `/handbuch/bilder/${treffer[1]}` : null;
  },
  verweis(ziel) {
    if (/^https?:\/\//i.test(ziel) || ziel.startsWith('#')) return ziel;
    if (/^(\.\.\/)?README\.md(#.*)?$/i.test(ziel)) return '/handbuch/readme' + (ziel.split('#')[1] ? '#' + ziel.split('#')[1] : '');
    if (/^(\.\/)?datenbank\.md(#.*)?$/i.test(ziel)) return '/handbuch/datenbank' + (ziel.split('#')[1] ? '#' + ziel.split('#')[1] : '');
    if (/^(\.\/)?handbuch\.md(#.*)?$/i.test(ziel)) return '/handbuch' + (ziel.split('#')[1] ? '#' + ziel.split('#')[1] : '');
    return null; // Verweis auf eine Datei im Repository — nur als Text zeigen
  },
};

function seiteZeigen(res, next, schluessel, pfad) {
  const seite = SEITEN[schluessel];
  let text;
  try {
    text = fs.readFileSync(seite.datei, 'utf8');
  } catch {
    return res.status(404).render('fehler', {
      title: seite.titel,
      message:
        `Die Datei ${path.basename(seite.datei)} liegt nicht bei dieser Installation. ` +
        'Sie kommt mit dem nächsten Update mit.',
    });
  }

  try {
    const { html, gliederung } = rendern(text, adressen);
    res.render('handbuch', {
      title: seite.titel,
      html,
      gliederung,
      seite: schluessel,
      pfad,
      stand: standDerSoftware(),
    });
  } catch (err) {
    next(err);
  }
}

/** Auf welchem Stand läuft die Software? Nur zur Anzeige im Kopf. */
function standDerSoftware() {
  try {
    return require('../update').standSynchron();
  } catch {
    return null;
  }
}

router.get('/handbuch', auth.requireLogin, (req, res, next) => seiteZeigen(res, next, 'handbuch', '/handbuch'));
router.get('/handbuch/readme', auth.requireLogin, (req, res, next) =>
  seiteZeigen(res, next, 'readme', '/handbuch/readme')
);
router.get('/handbuch/datenbank', auth.requireLogin, (req, res, next) =>
  seiteZeigen(res, next, 'datenbank', '/handbuch/datenbank')
);

// Die Bilder. Der Name wird gegen ein Muster geprüft, damit über die Adresse
// nichts anderes aus dem Dateisystem herauskommt als ein Bild aus docs/bilder.
router.get('/handbuch/bilder/:datei', auth.requireLogin, (req, res) => {
  if (!/^[\w-]+\.(png|jpe?g|gif|webp|svg)$/i.test(req.params.datei)) return res.sendStatus(404);
  res.sendFile(path.join(BILDER, req.params.datei), { maxAge: '7d' }, (err) => {
    if (err) res.sendStatus(404);
  });
});

module.exports = router;
