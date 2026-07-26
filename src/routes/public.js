'use strict';

const express = require('express');
const QRCode = require('qrcode');
const auth = require('../auth');
const m = require('../model');
const { istToken } = require('../tokens');

const router = express.Router();
const login = auth.requireLogin;

router.get('/', login, (req, res) => {
  res.render('uebersicht', {
    title: 'Spinte',
    lockers: m.lockerOverview(),
    stats: m.stats(),
  });
});

router.get('/suche', login, (req, res) => {
  const term = (req.query.q || '').trim();
  res.render('suche', {
    title: 'Suche',
    term,
    results: term ? m.search(term) : null,
  });
});

/**
 * Ziel des Barcode-Scans. Genau ein Treffer fuehrt direkt zum Ablageort,
 * sonst landet man auf der Suche und sieht alle Kandidaten.
 */
router.get('/scannen', login, (req, res) => {
  const nr = (req.query.nr || '').trim();
  if (!nr) return res.render('scannen', { title: 'Barcode scannen' });

  const treffer = m.findByInventoryNo(nr);
  if (treffer.length === 1) {
    const t = treffer[0];
    if (t.locker_id) return res.redirect(`/spint/${t.locker_id}`);
    if (t.storage_id) return res.redirect(`/lagerort/${t.storage_id}`);
    return res.redirect(`/lager?q=${encodeURIComponent(nr)}`);
  }
  if (treffer.length === 0) {
    req.session.flash = { type: 'warn', text: `Keine Ausrüstung mit Inventarnummer „${nr}“ gefunden.` };
  }
  res.redirect(`/suche?q=${encodeURIComponent(nr)}`);
});

/** Rendert die Spint-Seite — gemeinsam fuer QR-Token und interne id. */
function spintSeite(res, locker) {
  res.render('spint', {
    title: `Spint ${locker.code}`,
    locker,
    area: locker.area_id ? m.q.areaById.get(locker.area_id) : null,
    member: locker.member_id ? m.q.memberById.get(locker.member_id) : null,
    items: m.equipmentOfLocker(locker.id),
  });
}

const SPINT_WEG = {
  title: 'Spint unbekannt',
  message: 'Zu diesem QR-Code gibt es keinen Spint mehr. Vielleicht wurde er gelöscht.',
};

// Ziel des QR-Codes am Spint. Der Token ist das Geheimnis: nur wer am Spint
// steht und scannt, kommt ohne Anmeldung an diese Seite. Fremde Spinte lassen
// sich damit nicht durchprobieren.
router.get('/s/:token', (req, res) => {
  if (!istToken(req.params.token)) return res.status(404).render('fehler', SPINT_WEG);
  const locker = m.lockerByToken(req.params.token);
  if (!locker) return res.status(404).render('fehler', SPINT_WEG);
  spintSeite(res, locker);
});

// Gleiche Seite ueber die interne Nummer — nur fuer angemeldete Betreuer, damit
// die Verlinkung innerhalb der Software kurz bleibt.
router.get('/spint/:id(\\d+)', login, (req, res) => {
  const locker = m.q.lockerById.get(req.params.id);
  if (!locker) return res.status(404).render('fehler', SPINT_WEG);
  spintSeite(res, locker);
});

router.get('/lager', login, (req, res) => {
  const typeId = req.query.art || '';
  const ort = req.query.ort || '';
  const search = (req.query.q || '').trim();
  res.render('lager', {
    title: 'Lager',
    items: m.storageEquipment({ typeId: typeId || null, search, storageId: ort || null }),
    types: m.activeTypes(),
    lockers: m.allLockers(),
    storages: m.storagesAll(),
    typeId,
    ort,
    search,
  });
});

router.get('/qr', auth.requireLogin, async (req, res, next) => {
  try {
    const base = (req.query.basis || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(
      /\/+$/,
      ''
    );
    const svg = (url) => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

    // Die QR-Codes tragen den Token, nicht die interne Nummer — sonst koennte
    // jeder im WLAN von einem Etikett auf alle anderen Spinte schliessen.
    const codes = await Promise.all(
      m
        .allLockers()
        .map((l) => ({ ...l, member_name: l.member_id ? m.q.memberById.get(l.member_id)?.name : null }))
        .map(async (l) => {
          const url = `${base}/s/${l.token}`;
          return { ...l, url, svg: await svg(url) };
        })
    );

    const storageCodes = await Promise.all(
      m.storagesAll().map(async (s) => {
        const url = `${base}/l/${s.token}`;
        return { ...s, url, svg: await svg(url) };
      })
    );

    res.render('qr', { title: 'QR-Etiketten', codes, storageCodes, base });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
