'use strict';

const { db } = require('./db');

const insert = db.prepare(
  'INSERT INTO audit_log (user_id, username, entity, entity_id, action, detail) ' +
    'VALUES (?, ?, ?, ?, ?, ?)'
);

function log(req, entity, entityId, action, detail) {
  const user = req.session?.user;
  insert.run(user?.id ?? null, user?.name ?? 'System', entity, entityId ?? null, action, detail ?? null);
}

// Beschreibt eine Feldaenderung menschenlesbar: "Groesse: 152 -> 164"
function diff(fields, before, after) {
  const parts = [];
  for (const [key, label] of Object.entries(fields)) {
    const a = (before?.[key] ?? '') + '';
    const b = (after?.[key] ?? '') + '';
    if (a !== b) parts.push(`${label}: ${a || '-'} → ${b || '-'}`);
  }
  return parts.join(', ');
}

module.exports = { log, diff };
