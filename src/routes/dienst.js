'use strict';

const express = require('express');
const auth = require('../auth');
const audit = require('../audit');
const d = require('../dienst');

const router = express.Router();
const login = auth.requireLogin;

// Anwesenheit, Einschaetzung und Einteilung. Alles hier braucht eine Anmeldung —
// die Einschaetzungen sind das Heikelste in dieser Software und tauchen
// insbesondere nie auf den QR-Seiten auf, die ohne Anmeldung erreichbar sind.

// ------------------------------------------------------------ Anwesenheit

router.get('/anwesenheit', login, (req, res) => {
  const termin = d.letzterTermin();
  if (!termin) {
    return res.render('anwesenheit', {
      title: 'Anwesenheit',
      termin: null,
      liste: [],
      termine: [],
      heute: d.heute(),
    });
  }
  res.redirect(`/anwesenheit/${termin.id}`);
});

router.get('/anwesenheit/:id(\\d+)', login, (req, res) => {
  const termin = d.terminById(req.params.id);
  if (!termin) {
    return res.status(404).render('fehler', { title: 'Termin unbekannt', message: 'Diesen Termin gibt es nicht.' });
  }
  res.render('anwesenheit', {
    title: `Anwesenheit ${termin.datum}`,
    termin,
    // Der Zielzustand wird hier berechnet und wandert in den Knopf — siehe
    // die Route zum Antippen.
    liste: d.anwesenheit(termin.id).map((m) => ({ ...m, ziel: d.naechsterStatus(m.status) })),
    termine: d.termine(20),
    heute: d.heute(),
    stand: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
  });
});

router.post('/anwesenheit/neu', login, (req, res) => {
  const datum = (req.body.datum || '').trim() || d.heute();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    req.session.flash = { type: 'warn', text: 'Bitte ein Datum im Format JJJJ-MM-TT angeben.' };
    return res.redirect('/anwesenheit');
  }
  const vorher = d.terminByDatum(datum);
  const termin = d.terminAnlegen({ datum, thema: req.body.thema, von: req.session.user.name });
  if (!vorher) {
    audit.log(req, 'termin', termin.id, 'angelegt', datum + (termin.thema ? ` — ${termin.thema}` : ''));
  } else {
    req.session.flash = { type: 'info', text: `Für ${datum} gab es schon einen Termin.` };
  }
  res.redirect(`/anwesenheit/${termin.id}`);
});

router.post('/anwesenheit/:id(\\d+)/bearbeiten', login, (req, res) => {
  const termin = d.terminById(req.params.id);
  if (!termin) return res.redirect('/anwesenheit');
  d.terminAendern(termin.id, { thema: (req.body.thema || '').trim(), note: (req.body.note || '').trim() });
  audit.log(req, 'termin', termin.id, 'geändert', termin.datum);
  req.session.flash = { type: 'ok', text: 'Gespeichert.' };
  res.redirect(`/anwesenheit/${termin.id}`);
});

/**
 * Ein Antippen wechselt den Status: da → entschuldigt → fehlt → nichts.
 * Ohne Zwischenseite, damit man im Gerätehaus die Liste durchtippen kann.
 *
 * Der Knopf schickt den gewuenschten Zielzustand mit, statt den Server "einen
 * weiter" rechnen zu lassen. Das ist wichtig, sobald zwei Betreuer die Liste
 * offen haben: sonst sieht B noch "offen", waehrend A schon "da" gesetzt hat —
 * Bs Tipp wuerde daraus "entschuldigt" machen, obwohl B nur "da" wollte. Mit
 * Zielzustand ist derselbe Tipp einfach wirkungslos, und beide meinen dasselbe.
 */
router.post('/anwesenheit/:id(\\d+)/tippen/:member(\\d+)', login, (req, res) => {
  const termin = d.terminById(req.params.id);
  if (!termin) return res.redirect('/anwesenheit');

  const aktuell = d
    .anwesenheit(termin.id)
    .find((m) => String(m.id) === String(req.params.member));
  if (!aktuell) return res.redirect(`/anwesenheit/${termin.id}`);

  // "ziel" fehlt nur bei einer alten, aus dem Zwischenspeicher geladenen Seite —
  // dann bleibt es beim Weiterschalten.
  const gewuenscht = req.body.ziel;
  const ziel =
    gewuenscht === '' || d.STATUS_REIHE.includes(gewuenscht)
      ? gewuenscht || null
      : d.naechsterStatus(aktuell.status);

  d.statusSetzen(termin.id, aktuell.id, ziel);
  res.redirect(`/anwesenheit/${termin.id}#kind-${aktuell.id}`);
});

router.post('/anwesenheit/:id(\\d+)/alle', login, (req, res) => {
  const termin = d.terminById(req.params.id);
  if (!termin) return res.redirect('/anwesenheit');
  const status = ['da', 'entschuldigt', 'fehlt'].includes(req.body.status) ? req.body.status : null;
  if (status) {
    const n = d.alleSetzen(termin.id, status);
    audit.log(req, 'termin', termin.id, 'Anwesenheit gesetzt', `alle ${n} auf "${status}"`);
  }
  res.redirect(`/anwesenheit/${termin.id}`);
});

router.post('/anwesenheit/:id(\\d+)/loeschen', auth.requireJugendwart, (req, res) => {
  const termin = d.terminById(req.params.id);
  if (!termin) return res.redirect('/anwesenheit');
  d.terminLoeschen(termin.id);
  audit.log(req, 'termin', termin.id, 'gelöscht', termin.datum);
  req.session.flash = { type: 'ok', text: `Termin ${termin.datum} gelöscht.` };
  res.redirect('/anwesenheit');
});

router.get('/anwesenheit/quoten', login, (req, res) => {
  res.render('quoten', { title: 'Anwesenheit über die Zeit', ...d.quoten() });
});

// ----------------------------------------------------------- Einschaetzung

router.get('/einschaetzung', login, (req, res) => {
  res.render('einschaetzung', {
    title: 'Einschätzung',
    liste: d.einschaetzungen(),
    merkmale: d.MERKMALE,
    eignungen: d.EIGNUNGEN,
    eignungsListe: d.eignungsListe(),
    trennPaare: d.trennPaare(),
    // Die Werte sind erst nach einem Klick sichtbar — blickt ein Kind auf das
    // Handy, stehen dort nur Namen.
    offen: req.query.zeigen === '1',
  });
});

router.post('/einschaetzung/:member(\\d+)', login, (req, res) => {
  const { werte, geaendert } = d.einschaetzungSetzen(req.params.member, req.body, req.session.user.name);
  if (geaendert.length) {
    // Absichtlich ohne die Zahlen: der Verlauf ist fuer alle Betreuer sichtbar
    // und soll die Einschaetzung nicht nebenbei ausplaudern.
    audit.log(req, 'einschaetzung', Number(req.params.member), 'geändert', geaendert.join(', '));
  }
  // Kein Hinweis-Balken: bei einem Klick je Wert wuerde er nur stoeren. Der
  // Sprung zum Kind zeigt, dass es gesessen hat.
  res.redirect(`/einschaetzung?zeigen=1#kind-${req.params.member}`);
});

router.post('/einschaetzung/:member(\\d+)/eignung', login, (req, res) => {
  const funktion = (req.body.funktion || '').trim();
  if (!d.EIGNUNGEN.some((e) => e.key === funktion)) {
    req.session.flash = { type: 'warn', text: 'Unbekannte Funktion.' };
    return res.redirect('/einschaetzung?zeigen=1');
  }
  const stufe = ['kann', 'uebt'].includes(req.body.stufe) ? req.body.stufe : null;
  d.eignungSetzen(Number(req.params.member), funktion, stufe);
  audit.log(req, 'einschaetzung', Number(req.params.member), 'Eignung', `${funktion}: ${stufe || 'keine'}`);
  res.redirect('/einschaetzung?zeigen=1#eignung');
});

router.post('/einschaetzung/trennen', login, (req, res) => {
  const a = Number(req.body.a_id);
  const b = Number(req.body.b_id);
  if (!a || !b || a === b) {
    req.session.flash = { type: 'warn', text: 'Bitte zwei verschiedene Kinder auswählen.' };
    return res.redirect('/einschaetzung?zeigen=1#trennen');
  }
  d.trennenSetzen(a, b, (req.body.grund || '').trim());
  audit.log(req, 'einschaetzung', null, 'nicht zusammen', 'Paar eingetragen');
  res.redirect('/einschaetzung?zeigen=1#trennen');
});

router.post('/einschaetzung/trennen/loeschen', login, (req, res) => {
  d.trennenEntfernen(Number(req.body.a_id), Number(req.body.b_id));
  audit.log(req, 'einschaetzung', null, 'nicht zusammen', 'Paar entfernt');
  res.redirect('/einschaetzung?zeigen=1#trennen');
});

// --------------------------------------------------------------- Einteilung

router.get('/einteilung', login, (req, res, next) => {
  try {
    const termin = req.query.termin ? d.terminById(req.query.termin) : d.letzterTermin();
    if (!termin) {
      return res.render('einteilung', {
        title: 'Einteilung',
        termin: null,
        termine: [],
        aufstellungen: d.AUFSTELLUNGEN,
        funktionen: d.FUNKTIONEN,
        ergebnis: null,
        gespeichert: [],
        heute: d.heute(),
      });
    }

    const aufstellung = d.AUFSTELLUNGEN[req.query.aufstellung] ? req.query.aufstellung : 'frei';
    // Ohne Knopfdruck wird nichts gewürfelt — sonst stünde bei jedem Aufruf
    // eine andere Einteilung da als die, die man gerade vorgelesen hat.
    const ergebnis = req.query.bilden
      ? d.einteilung(termin.id, { anzahlTeams: req.query.anzahl, aufstellung })
      : null;

    res.render('einteilung', {
      title: `Einteilung ${termin.datum}`,
      termin,
      termine: d.termine(20),
      aufstellungen: d.AUFSTELLUNGEN,
      funktionen: d.FUNKTIONEN,
      aufstellung,
      anzahl: Number(req.query.anzahl) || null,
      anwesendAnzahl: d.anwesendeMitWerten(termin.id).length,
      vorschlag: d.einheitenVorschlag(d.anwesendeMitWerten(termin.id).length, aufstellung),
      ergebnis,
      gespeichert: d.gespeicherteTeams(termin.id),
      heute: d.heute(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/einteilung/:id(\\d+)/speichern', login, (req, res) => {
  const termin = d.terminById(req.params.id);
  if (!termin) return res.redirect('/einteilung');

  // Die angezeigte Einteilung kommt als verstecktes Feld zurueck — so wird
  // genau das gespeichert, was der Betreuer vor sich hatte, und nicht eine
  // neu gewuerfelte Fassung.
  let teams;
  try {
    teams = JSON.parse(req.body.teams || '[]');
  } catch {
    teams = [];
  }
  if (!Array.isArray(teams) || !teams.length) {
    req.session.flash = { type: 'warn', text: 'Es gab nichts zu speichern.' };
    return res.redirect('/einteilung?termin=' + termin.id);
  }

  const anzahl = d.teamsSpeichern(termin.id, teams);
  audit.log(req, 'termin', termin.id, 'Einteilung gespeichert', `${anzahl} Einheiten`);
  req.session.flash = { type: 'ok', text: `Einteilung mit ${anzahl} Einheiten gespeichert.` };
  res.redirect('/einteilung?termin=' + termin.id);
});

module.exports = router;
