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

// Satzspiegel des Etiketts in Millimetern. Muss zu etikett.css passen — dort
// steht dieselbe Aufteilung (A4 quer, 297 x 210 mm).
const SPALTE_MM = 195; // Breite der Namensspalte
const NAME_MM = 78; //    Hoehe, die dem Namen bleibt
const PT_JE_MM = 2.8346;

// Wie viele Zeichenbreiten bei einem Schriftgrad von 1 pt in einen Millimeter
// passen — an der Schrift gemessen.
const EINHEITEN_JE_MM = 4.107;

const GROESSTE = 96;
const KLEINSTE = 24;
const ZEILENHOEHE = 1.02; // wie in etikett.css
const LEERZEICHEN = 0.5;

/** Wie viele Zeilen der Name bei dieser Zeilenkapazitaet braucht. */
function zeilenzahl(worte, kapazitaet) {
  let zeilen = 1;
  let belegt = 0;
  for (const wort of worte) {
    const zusammen = belegt ? belegt + LEERZEICHEN + wort : wort;
    if (zusammen <= kapazitaet) belegt = zusammen;
    else {
      zeilen++;
      belegt = wort;
    }
  }
  return zeilen;
}

/**
 * Schriftgroesse fuer den Namen — das Groesste auf dem Blatt.
 *
 * Statt einer Faustformel wird der Zeilenumbruch nachgestellt und der groesste
 * Grad genommen, bei dem beides stimmt: kein Wort ist breiter als eine Zeile
 * (sonst zerreisst der Browser es mittendrin), und alle Zeilen zusammen bleiben
 * in der Hoehe. So bekommt "Ben" die volle Groesse, waehrend
 * "Maximilian Schmidtberger" so weit heruntergeht, wie es noetig ist — aber
 * keinen Punkt weiter.
 */
function namensgroesse(name) {
  const worte = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(wortbreite);
  if (!worte.length) return GROESSTE;

  const jeZeile = EINHEITEN_JE_MM * SPALTE_MM; // Einheiten mal Schriftgrad
  const platz = NAME_MM * PT_JE_MM;

  let mehrzeilig = KLEINSTE;
  for (let grad = GROESSTE; grad > KLEINSTE; grad--) {
    const kapazitaet = jeZeile / grad;
    if (worte.some((wort) => wort > kapazitaet)) continue;
    if (zeilenzahl(worte, kapazitaet) * grad * ZEILENHOEHE <= platz) {
      mehrzeilig = grad;
      break;
    }
  }

  // Im Querformat ist die Spalte breit. "Lena Sommer" wuerde im groesstmoeglichen
  // Grad zweizeilig gesetzt und liesse die halbe Spalte leer — einzeilig sieht
  // das deutlich besser aus. Also einzeilig setzen, sofern das nicht mehr als ein
  // Drittel Schriftgroesse kostet. Bei "Maximilian Schmidtberger" waere der
  // Verlust zu gross; der bleibt zweizeilig und dafuer gross.
  const gesamt = worte.reduce((summe, wort) => summe + wort, 0) + LEERZEICHEN * (worte.length - 1);
  const einzeilig = Math.min(GROESSTE, Math.floor(jeZeile / gesamt));
  if (einzeilig >= mehrzeilig * 0.7) return einzeilig;

  return mehrzeilig;
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
