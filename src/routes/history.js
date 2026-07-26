'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');

const router = express.Router();
const PAGE_SIZE = 100;

router.get('/verlauf', auth.requireLogin, (req, res) => {
  const page = Math.max(1, Number(req.query.seite) || 1);
  const entity = ['spint', 'ausruestung', 'mitglied', 'art', 'user'].includes(req.query.was) ? req.query.was : null;

  const where = entity ? 'WHERE entity = @entity' : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${where}`).get({ entity }).n;
  const entries = db
    .prepare(
      `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`
    )
    .all({ entity, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  res.render('verlauf', {
    title: 'Verlauf',
    entries,
    entity,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
  });
});

module.exports = router;
