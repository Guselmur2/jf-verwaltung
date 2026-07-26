'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');
const sizes = require('../sizes');

const router = express.Router();
const login = auth.requireLogin;

const REASONS = ['zu klein', 'zu groß', 'defekt', 'verloren', 'sonstiges'];

/**
 * Sechs gleiche Jacken im selben Schrank sind eine Fundstelle, nicht sechs.
 * Gruppiert nach Ort und Zustand; getauscht wird eins daraus.
 */
function gruppiereTreffer(treffer) {
  const gruppen = [];
  for (const t of treffer) {
    const key = `${t.storage_id || 0}|${t.condition}`;
    let g = gruppen.find((x) => x.key === key);
    if (!g) {
      g = {
        key,
        storage_id: t.storage_id,
        storage_name: t.storage_name,
        condition: t.condition,
        size: t.size,
        items: [],
      };
      gruppen.push(g);
    }
    g.items.push(t);
  }
  for (const g of gruppen) {
    g.count = g.items.length;
    // Nur wenn Inventarnummern vorhanden sind, lohnt die Einzelauswahl.
    g.mitNummer = g.items.filter((i) => i.inventory_no);
  }
  return gruppen;
}

function itemWithType(id) {
  return db
    .prepare(
      `SELECT e.*, t.name AS type_name, t.has_size, t.has_inventory,
              l.id AS locker_id_ref, l.code AS locker_code, m2.name AS member_name, m2.id AS member_id
         FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
         LEFT JOIN lockers l ON l.id = e.locker_id
         LEFT JOIN members m2 ON m2.id = l.member_id
        WHERE e.id = ?`
    )
    .get(id);
}

// ------------------------------------------------- Tausch / Bestellung anstossen

router.get('/ausruestung/:id/tauschen', login, (req, res) => {
  const item = itemWithType(req.params.id);
  if (!item) return res.status(404).render('fehler', { title: 'Nicht gefunden', message: 'Dieses Teil gibt es nicht.' });

  res.render('tauschen', {
    title: `${item.type_name} tauschen`,
    item,
    vorschlaege: sizes.suggestions(item.size),
    reasons: REASONS,
    treffer: null,
    wunsch: null,
    reason: null,
    storages: m.storagesAll(),
  });
});

router.post('/ausruestung/:id/tauschen', login, (req, res) => {
  const item = itemWithType(req.params.id);
  if (!item) return res.status(404).render('fehler', { title: 'Nicht gefunden', message: 'Dieses Teil gibt es nicht.' });

  const wunsch = (req.body.to_size || '').trim();
  const reason = REASONS.includes(req.body.reason) ? req.body.reason : 'sonstiges';
  const note = (req.body.note || '').trim() || null;

  const seite = (extra) =>
    res.render('tauschen', {
      title: `${item.type_name} tauschen`,
      item,
      vorschlaege: sizes.suggestions(item.size),
      reasons: REASONS,
      wunsch,
      reason,
      note,
      storages: m.storagesAll(),
      treffer: null,
      ...extra,
    });

  // Ohne Wunschgroesse laesst sich das Lager nicht sinnvoll durchsuchen; bei
  // Verlust oder Defekt ist die gleiche Groesse gemeint.
  const zielGroesse = wunsch || item.size || '';
  if (!zielGroesse && item.has_size) {
    return seite({ error: 'Bitte eine Wunschgröße angeben.' });
  }

  const treffer = m.findReplacement(item.type_id, zielGroesse);
  if (treffer.length > 0) {
    // Erst berichten, wo das Teil liegt — getauscht wird nur auf Knopfdruck.
    return seite({ treffer, fundorte: gruppiereTreffer(treffer), zielGroesse });
  }

  // Nichts im Lager: Aufgabe fuer den Jugendwart anlegen.
  const kind = reason === 'defekt' || reason === 'verloren' ? 'bestellung' : 'tausch';
  const info = db
    .prepare(
      `INSERT INTO tasks (kind, equipment_id, type_id, member_id, locker_id, from_size, to_size, reason, note, created_by)
       VALUES (@kind, @equipment_id, @type_id, @member_id, @locker_id, @from_size, @to_size, @reason, @note, @created_by)`
    )
    .run({
      kind,
      equipment_id: item.id,
      type_id: item.type_id,
      member_id: item.member_id || null,
      locker_id: item.locker_id || null,
      from_size: item.size || null,
      to_size: zielGroesse || null,
      reason,
      note,
      created_by: req.session.user.name,
    });

  audit.log(
    req,
    'aufgabe',
    info.lastInsertRowid,
    'angelegt',
    `${m.TASK_KIND[kind]}: ${item.type_name} ${item.size || ''} → ${zielGroesse || '?'}` +
      (item.member_name ? ` für ${item.member_name}` : '')
  );
  req.session.flash = {
    type: 'ok',
    text: `Nichts Passendes im Lager. Aufgabe für den Jugendwart angelegt: ${item.type_name} in Größe ${zielGroesse}.`,
  };
  res.redirect('/aufgaben');
});

// Gefundenes Ersatzteil tatsaechlich in den Spint legen.
router.post('/ausruestung/:id/tauschen/ausfuehren', login, (req, res) => {
  const item = itemWithType(req.params.id);
  const ersatz = m.q.equipmentById.get(Number(req.body.ersatz_id));
  if (!item || !ersatz) return res.redirect('/');

  if (ersatz.locker_id || ersatz.retired) {
    req.session.flash = { type: 'warn', text: 'Das Ersatzteil ist inzwischen nicht mehr im Lager verfügbar.' };
    return res.redirect(`/ausruestung/${item.id}/tauschen`);
  }
  if (!item.locker_id) {
    req.session.flash = { type: 'warn', text: 'Das alte Teil liegt in keinem Spint.' };
    return res.redirect(`/ausruestung/${item.id}/tauschen`);
  }

  const verbleib = req.body.verbleib || 'lager'; // 'lager' | 'ausmustern' | Lagerort-Id
  const altVorher = m.placementLabel(item);
  const neuVorher = m.placementLabel(ersatz);

  db.transaction(() => {
    m.setPlacement(ersatz.id, { lockerId: item.locker_id });
    if (verbleib === 'ausmustern') {
      db.prepare('UPDATE equipment SET retired = 1, locker_id = NULL, storage_id = NULL WHERE id = ?').run(item.id);
    } else {
      const ort = /^\d+$/.test(verbleib) && m.q.storageById.get(Number(verbleib)) ? Number(verbleib) : null;
      m.setPlacement(item.id, { storageId: ort });
    }
  })();

  const altNachher = verbleib === 'ausmustern' ? 'ausgemustert' : m.placementLabel(m.q.equipmentById.get(item.id));
  audit.log(
    req,
    'ausruestung',
    ersatz.id,
    'getauscht',
    `${item.type_name} ${ersatz.size || ''} aus ${neuVorher} → ${altVorher}; altes Teil (${item.size || '?'}) → ${altNachher}`
  );

  req.session.flash = {
    type: 'ok',
    text: `Getauscht: ${item.type_name} Größe ${ersatz.size || '?'} liegt jetzt im Spint, das alte Teil ist ${altNachher}.`,
  };
  res.redirect(`/spint/${item.locker_id}/bearbeiten`);
});

// ------------------------------------------------------------ Aufgaben-Tab

router.get('/aufgaben', login, (req, res) => {
  const status = ['offen', 'erledigt', 'abgebrochen', 'alle'].includes(req.query.status) ? req.query.status : 'offen';
  res.render('aufgaben', {
    title: 'Aufgaben',
    tasks: m.tasksList(status),
    status,
    types: m.activeTypes(),
    reasons: REASONS,
  });
});

// Freie Aufgabe ohne konkretes Teil, z. B. "10 Paar Schuhe nachbestellen".
router.post('/aufgaben/neu', login, (req, res) => {
  const typeId = Number(req.body.type_id) || null;
  const note = (req.body.note || '').trim() || null;
  const toSize = (req.body.to_size || '').trim() || null;

  if (!typeId && !note) {
    req.session.flash = { type: 'warn', text: 'Bitte Art oder Beschreibung angeben.' };
    return res.redirect('/aufgaben');
  }

  const info = db
    .prepare(
      `INSERT INTO tasks (kind, type_id, to_size, reason, note, created_by)
       VALUES ('bestellung', @type_id, @to_size, 'sonstiges', @note, @created_by)`
    )
    .run({ type_id: typeId, to_size: toSize, note, created_by: req.session.user.name });

  audit.log(req, 'aufgabe', info.lastInsertRowid, 'angelegt', note || 'Bestellung');
  req.session.flash = { type: 'ok', text: 'Aufgabe angelegt.' };
  res.redirect('/aufgaben');
});

function setStatus(req, res, status, wort) {
  const task = m.q.taskById.get(req.params.id);
  if (!task) return res.redirect('/aufgaben');

  const fertig = status === 'offen' ? null : new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('UPDATE tasks SET status = ?, done_at = ?, done_by = ? WHERE id = ?').run(
    status,
    fertig,
    fertig ? req.session.user.name : null,
    task.id
  );
  audit.log(req, 'aufgabe', task.id, wort, beschreibung(task));
  req.session.flash = { type: 'ok', text: `Aufgabe ${wort}.` };
  res.redirect('/aufgaben' + (status === 'offen' ? '' : `?status=${status}`));
}

function beschreibung(task) {
  const art = task.type_id ? m.q.typeById.get(task.type_id)?.name : null;
  return [art, task.from_size && task.to_size ? `${task.from_size} → ${task.to_size}` : task.to_size, task.note]
    .filter(Boolean)
    .join(' ');
}

router.post('/aufgaben/:id/erledigt', login, (req, res) => setStatus(req, res, 'erledigt', 'erledigt'));
router.post('/aufgaben/:id/abbrechen', login, (req, res) => setStatus(req, res, 'abgebrochen', 'abgebrochen'));
router.post('/aufgaben/:id/oeffnen', login, (req, res) => setStatus(req, res, 'offen', 'wieder geöffnet'));

router.post('/aufgaben/:id/loeschen', auth.requireJugendwart, (req, res) => {
  const task = m.q.taskById.get(req.params.id);
  if (!task) return res.redirect('/aufgaben');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  audit.log(req, 'aufgabe', task.id, 'gelöscht', beschreibung(task));
  req.session.flash = { type: 'ok', text: 'Aufgabe gelöscht.' };
  res.redirect('/aufgaben?status=alle');
});

module.exports = router;
