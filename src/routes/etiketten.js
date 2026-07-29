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

const PT_JE_MM = 2.8346;

// Wie viele Zeichenbreiten bei einem Schriftgrad von 1 pt in einen Millimeter
// passen — an der Schrift gemessen.
const EINHEITEN_JE_MM = 4.107;

const GROESSTE = 92;
const KLEINSTE = 10;
const ZEILENHOEHE = 1.02; // wie in etikett.css
const LEERZEICHEN = 0.5;

// Anteil der Kartenbreite, der dem Namen bleibt — Breite der Namensspalte und
// die Hoehe, die im Mittelteil fuer den Namen frei ist. Die Werte spiegeln die
// Aufteilung in etikett.css wider (Namensspalte neben dem QR-Code). Weil alle
// Layouts dieselbe Karte in verschiedenen Groessen sind, genuegt ein Anteil:
// die passende Schrift skaliert dann mit der Kartenbreite.
const NAME_SPALTE = 0.62;
const NAME_HOEHE = 0.24;

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
 * Schriftgroesse fuer den Namen — das Groesste auf der Karte.
 *
 * Statt einer Faustformel wird der Zeilenumbruch nachgestellt und der groesste
 * Grad genommen, bei dem beides stimmt: kein Wort ist breiter als eine Zeile
 * (sonst zerreisst der Browser es mittendrin), und alle Zeilen zusammen bleiben
 * in der Hoehe. So bekommt "Ben" die volle Groesse, waehrend
 * "Maximilian Schmidtberger" so weit heruntergeht, wie es noetig ist — aber
 * keinen Punkt weiter.
 *
 * spalteMm/hoeheMm sind der Platz fuer den Namen auf der jeweiligen Karte. Bei
 * vier Etiketten je Seite ist die Karte kleiner, also faellt die Schrift
 * kleiner aus — dieselbe Rechnung, andere Masse.
 */
function namensgroesse(name, spalteMm, hoeheMm) {
  const worte = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(wortbreite);
  if (!worte.length) return GROESSTE;

  const jeZeile = EINHEITEN_JE_MM * spalteMm; // Einheiten mal Schriftgrad
  const platz = hoeheMm * PT_JE_MM;
  const maxEineZeile = Math.floor(platz / ZEILENHOEHE); // Hoehe fuer genau eine Zeile

  let mehrzeilig = KLEINSTE;
  for (let grad = GROESSTE; grad > KLEINSTE; grad--) {
    const kapazitaet = jeZeile / grad;
    if (worte.some((wort) => wort > kapazitaet)) continue;
    if (zeilenzahl(worte, kapazitaet) * grad * ZEILENHOEHE <= platz) {
      mehrzeilig = grad;
      break;
    }
  }

  // Ist die Spalte breit, wuerde "Lena Sommer" im groesstmoeglichen Grad
  // zweizeilig gesetzt und liesse die halbe Spalte leer — einzeilig sieht das
  // besser aus. Also einzeilig setzen, sofern das nicht mehr als ein Drittel
  // Schriftgroesse kostet und die eine Zeile auch in die Hoehe passt. Bei
  // "Maximilian Schmidtberger" waere der Verlust zu gross; der bleibt
  // zweizeilig und dafuer gross.
  const gesamt = worte.reduce((summe, wort) => summe + wort, 0) + LEERZEICHEN * (worte.length - 1);
  const einzeilig = Math.min(GROESSTE, maxEineZeile, Math.floor(jeZeile / gesamt));
  if (einzeilig >= mehrzeilig * 0.7) return einzeilig;

  return mehrzeilig;
}

// Die drei Druck-Layouts. kartenBreiteMm muss zu etikett.css passen (--kw je
// data-pro-seite). quer schaltet die Seite ins Querformat.
const LAYOUTS = {
  1: { proSeite: 1, kartenBreiteMm: 281, quer: true },
  2: { proSeite: 2, kartenBreiteMm: 194, quer: false },
  4: { proSeite: 4, kartenBreiteMm: 94, quer: false },
};

function layoutWaehlen(wert, vorgabe) {
  const n = Number(wert);
  return LAYOUTS[n] ? LAYOUTS[n] : LAYOUTS[vorgabe];
}

function basisAdresse(req) {
  return (req.query.basis || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

/** Baut die Druckdaten eines Etiketts zusammen — Schrift passend zur Karte. */
async function etikett(locker, basis, layout) {
  const member = locker.member_id ? m.q.memberById.get(locker.member_id) : null;
  const area = locker.area_id ? m.q.areaById.get(locker.area_id) : null;
  const url = `${basis}/s/${locker.token}`;
  return {
    locker,
    name: member ? member.name : null,
    bereich: area ? area.name : null,
    url,
    schrift: namensgroesse(
      member ? member.name : 'frei',
      layout.kartenBreiteMm * NAME_SPALTE,
      layout.kartenBreiteMm * NAME_HOEHE
    ),
    svg: await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'Q' }),
  };
}

/** Etiketten in Seiten zu je proSeite Stueck aufteilen. */
function inSeiten(etiketten, proSeite) {
  const blaetter = [];
  for (let i = 0; i < etiketten.length; i += proSeite) blaetter.push(etiketten.slice(i, i + proSeite));
  return blaetter;
}

// Alle Spinte, mehrere Etiketten je DIN-A4-Blatt.
router.get('/etiketten', auth.requireLogin, async (req, res, next) => {
  try {
    const basis = basisAdresse(req);
    const bereich = req.query.bereich || '';
    const nurBelegt = req.query.belegt === '1';
    const layout = layoutWaehlen(req.query.pro, 2);

    let lockers = m.allLockers();
    if (bereich) lockers = lockers.filter((l) => String(l.area_id) === String(bereich));
    if (nurBelegt) lockers = lockers.filter((l) => l.member_id);

    const etiketten = await Promise.all(lockers.map((l) => etikett(l, basis, layout)));
    res.render('etikett', {
      title: 'Spint-Etiketten',
      etiketten,
      blaetter: inSeiten(etiketten, layout.proSeite),
      layout,
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

// Ein einzelner Spint — der Weg von der Spint-Seite aus. Voreinstellung: ein
// grosses Etikett je Seite, laesst sich mit ?pro= aber auch kleiner drucken.
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
    const layout = layoutWaehlen(req.query.pro, 1);
    const eins = await etikett(locker, basis, layout);
    res.render('etikett', {
      title: `Etikett Spint ${locker.code}`,
      etiketten: [eins],
      blaetter: [[eins]],
      layout,
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
