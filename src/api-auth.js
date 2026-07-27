'use strict';

const crypto = require('crypto');
const { db } = require('./db');

// Andere Systeme melden sich nicht mit Benutzername und Passwort an, sondern mit
// einem Token. Gespeichert wird nur dessen Hash — wer die Datenbank liest, kann
// damit nichts anfangen. Im Klartext bekommt man den Token einmal beim Anlegen.

const PRAEFIX = 'jfw_';

const q = {
  vomHash: db.prepare("SELECT * FROM api_tokens WHERE token_hash = ? AND active = 1"),
  alle: db.prepare('SELECT * FROM api_tokens ORDER BY active DESC, id DESC'),
  benutzt: db.prepare("UPDATE api_tokens SET last_used = datetime('now') WHERE id = ?"),
};

function hash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Erzeugt einen neuen Token und legt ihn an. Der Klartext wird nur hier zurueckgegeben. */
function anlegen({ name, scope, erstelltVon }) {
  const token = PRAEFIX + crypto.randomBytes(24).toString('hex');
  const info = db
    .prepare('INSERT INTO api_tokens (name, token_hash, scope, created_by) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), hash(token), scope === 'schreiben' ? 'schreiben' : 'lesen', erstelltVon || null);
  return { id: info.lastInsertRowid, token };
}

function liste() {
  return q.alle.all();
}

function setzeAktiv(id, aktiv) {
  db.prepare('UPDATE api_tokens SET active = ? WHERE id = ?').run(aktiv ? 1 : 0, id);
}

function loeschen(id) {
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
}

/** Liest den Token aus Authorization-Kopfzeile oder X-API-Key. */
function ausAnfrage(req) {
  const kopf = req.get('authorization') || '';
  const treffer = kopf.match(/^Bearer\s+(\S+)$/i);
  if (treffer) return treffer[1];
  return req.get('x-api-key') || null;
}

/**
 * Middleware: prueft den Token und haengt ihn als req.apiToken an.
 * <benoetigt> ist 'lesen' oder 'schreiben'.
 */
function verlangt(benoetigt = 'lesen') {
  return (req, res, next) => {
    const token = ausAnfrage(req);
    if (!token) {
      return res.status(401).json({
        fehler: 'Kein Token übergeben.',
        hinweis: 'Token als "Authorization: Bearer jfw_…" oder "X-API-Key: jfw_…" senden.',
      });
    }

    const eintrag = q.vomHash.get(hash(token));
    if (!eintrag) return res.status(401).json({ fehler: 'Token unbekannt oder gesperrt.' });

    if (benoetigt === 'schreiben' && eintrag.scope !== 'schreiben') {
      return res.status(403).json({ fehler: 'Dieser Token darf nur lesen.' });
    }

    q.benutzt.run(eintrag.id);
    req.apiToken = eintrag;
    next();
  };
}

module.exports = { anlegen, liste, setzeAktiv, loeschen, verlangt, PRAEFIX };
