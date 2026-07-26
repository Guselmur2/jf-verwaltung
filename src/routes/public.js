'use strict';

const express = require('express');
const QRCode = require('qrcode');
const auth = require('../auth');
const m = require('../model');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('uebersicht', {
    title: 'Spinte',
    lockers: m.lockerOverview(),
    stats: m.stats(),
  });
});

router.get('/suche', (req, res) => {
  const term = (req.query.q || '').trim();
  res.render('suche', {
    title: 'Suche',
    term,
    results: term ? m.search(term) : null,
  });
});

// Ziel des QR-Codes am Spint. Angesprochen ueber die id, weil Nummern je Bereich
// doppelt vorkommen duerfen.
router.get('/spint/:id(\\d+)', (req, res) => {
  const locker = m.q.lockerById.get(req.params.id);
  if (!locker) {
    return res.status(404).render('fehler', {
      title: 'Spint unbekannt',
      message: 'Zu diesem QR-Code gibt es keinen Spint mehr. Vielleicht wurde er gelöscht.',
    });
  }
  res.render('spint', {
    title: `Spint ${locker.code}`,
    locker,
    area: locker.area_id ? m.q.areaById.get(locker.area_id) : null,
    member: locker.member_id ? m.q.memberById.get(locker.member_id) : null,
    items: m.equipmentOfLocker(locker.id),
  });
});

router.get('/lager', (req, res) => {
  const typeId = req.query.art || '';
  const search = (req.query.q || '').trim();
  res.render('lager', {
    title: 'Lager',
    items: m.storageEquipment({ typeId: typeId || null, search }),
    types: m.activeTypes(),
    lockers: m.allLockers(),
    typeId,
    search,
  });
});

router.get('/qr', auth.requireLogin, async (req, res, next) => {
  try {
    const base = (req.query.basis || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(
      /\/+$/,
      ''
    );
    const lockers = m.allLockers().map((l) => ({
      ...l,
      member_name: l.member_id ? m.q.memberById.get(l.member_id)?.name : null,
    }));

    const codes = await Promise.all(
      lockers.map(async (l) => {
        const url = `${base}/spint/${l.id}`;
        return {
          ...l,
          url,
          svg: await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }),
        };
      })
    );

    res.render('qr', { title: 'QR-Etiketten', codes, base });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
