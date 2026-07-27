'use strict';

const express = require('express');
const QRCode = require('qrcode');
const auth = require('../auth');
const m = require('../model');
const settings = require('../settings');

const router = express.Router();

// Wie breit ein Zeichen ungefaehr baut, gemessen an einer fetten Groteske und
// bezogen auf ein durchschnittliches Zeichen. Ohne diese Gewichtung waere
// "Mmmmwwww" genauso breit wie "illillil" — der eine Name wuerde zerrissen, der
// andere unnoetig klein gedruckt.
const BREIT = /[mwMWQ]/;
const SCHMAL = /[ilIjtf.,'’-]/;

function wortbreite(wort) {
  return [...wort].reduce((summe, zeichen) => {
    if (BREIT.test(zeichen)) return summe + 1.6;
    if (SCHMAL.test(zeichen)) return summe + 0.5;
    return summe + 1;
  }, 0);
}

/**
 * Schriftgroesse fuer den Namen. Der Name ist das Groesste auf dem Blatt — er
 * soll aber auch bei "Schmidtberger" noch in die Spalte passen.
 *
 * Massgeblich ist das breiteste Wort: umbrochen wird zwischen Woertern, und
 * passt selbst ein einzelnes Wort nicht mehr, zerreisst es der Browser
 * mittendrin. Der Faktor 460 ist an der Schrift gemessen; er entspricht der
 * Spaltenbreite von 112 mm.
 */
function namensgroesse(name) {
  const breiteste = String(name)
    .split(/\s+/)
    .reduce((n, wort) => Math.max(n, wortbreite(wort)), 0);
  return Math.max(24, Math.min(84, Math.round(460 / Math.max(breiteste, 5.5))));
}

function basisAdresse(req) {
  return (req.query.basis || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

/** Baut die Druckdaten eines Spints zusammen. */
async function seite(locker, basis) {
  const member = locker.member_id ? m.q.memberById.get(locker.member_id) : null;
  const area = locker.area_id ? m.q.areaById.get(locker.area_id) : null;
  const url = `${basis}/s/${locker.token}`;
  return {
    locker,
    name: member ? member.name : null,
    bereich: area ? area.name : null,
    url,
    schrift: namensgroesse(member ? member.name : 'frei'),
    svg: await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'Q' }),
  };
}

// Alle Spinte, ein DIN-A4-Blatt je Spint.
router.get('/etiketten', auth.requireLogin, async (req, res, next) => {
  try {
    const basis = basisAdresse(req);
    const bereich = req.query.bereich || '';
    const nurBelegt = req.query.belegt === '1';

    let lockers = m.allLockers();
    if (bereich) lockers = lockers.filter((l) => String(l.area_id) === String(bereich));
    if (nurBelegt) lockers = lockers.filter((l) => l.member_id);

    const seiten = await Promise.all(lockers.map((l) => seite(l, basis)));
    res.render('etikett', {
      title: 'Spint-Etiketten',
      seiten,
      basis,
      einzeln: false,
      bereich,
      nurBelegt,
      areas: m.areasAll(),
      daten: settings.alle(),
    });
  } catch (err) {
    next(err);
  }
});

// Ein einzelnes Blatt — der Weg von der Spint-Seite aus.
router.get('/etikett/:id(\\d+)', auth.requireLogin, async (req, res, next) => {
  try {
    const locker = m.q.lockerById.get(req.params.id);
    if (!locker) {
      return res.status(404).render('fehler', {
        title: 'Spint unbekannt',
        message: 'Diesen Spint gibt es nicht mehr.',
      });
    }
    const basis = basisAdresse(req);
    res.render('etikett', {
      title: `Etikett Spint ${locker.code}`,
      seiten: [await seite(locker, basis)],
      basis,
      einzeln: true,
      bereich: '',
      nurBelegt: false,
      areas: [],
      daten: settings.alle(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
