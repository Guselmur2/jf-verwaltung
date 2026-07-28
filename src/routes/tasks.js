'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');
const sizes = require('../sizes');
const barcode = require('../barcode');

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
    vorschlaege: sizes.suggestions(item.type_id, item.size),
    reasons: REASONS,
    treffer: null,
    wunsch: null,
    reason: null,
    storages: m.storagesAll(),
    sizeSchemes: sizes.schemes(),
    // Laeuft fuer dieses Teil schon etwas? Dann davor warnen, statt dieselbe
    // Bestellung ein zweites Mal auszuloesen.
    offeneAufgabe: m.openTaskOfEquipment(item.id),
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
      vorschlaege: sizes.suggestions(item.type_id, item.size),
      reasons: REASONS,
      wunsch,
      reason,
      note,
      storages: m.storagesAll(),
      sizeSchemes: sizes.schemes(),
      offeneAufgabe: m.openTaskOfEquipment(item.id),
      treffer: null,
      ...extra,
    });

  // Ohne Wunschgroesse laesst sich das Lager nicht sinnvoll durchsuchen; bei
  // Verlust oder Defekt ist die gleiche Groesse gemeint.
  const zielGroesse = wunsch || item.size || '';
  if (!zielGroesse && item.has_size) {
    return seite({ error: 'Bitte eine Wunschgröße angeben.' });
  }

  // Eine Groesse, die es fuer diese Art nicht gibt, wuerde als Aufgabe im
  // System landen und nie zu finden sein — deshalb einmal nachfragen.
  if (req.body.groesse_ok !== '1' && !sizes.isKnown(item.type_id, zielGroesse)) {
    const vorschlag = sizes.nearest(item.type_id, zielGroesse);
    return seite({
      unbekannteGroesse: zielGroesse,
      groessenVorschlag: vorschlag ? vorschlag.wert : null,
      bekannteGroessen: sizes.sizesOfType(item.type_id),
    });
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

// ------------------------------------------------- Sicherheitsabfrage + Tausch

const SKIP_GRUENDE = ['verloren', 'Etikett unlesbar', 'sonstiges'];

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

/** Liest die Fundstelle aus dem Formular und laedt ihre Teile frisch aus der DB. */
function fundstelle(item, body) {
  const size = (body.size || '').trim();
  const storageId = body.storage_id ? Number(body.storage_id) : null;
  const condition = body.condition || null;
  return {
    size,
    storageId,
    condition,
    storageName: storageId ? m.q.storageById.get(storageId)?.name : null,
    kandidaten: m.replacementCandidates(item.type_id, size, storageId, condition),
  };
}

/**
 * Prueft, ob der Betreuer wirklich das alte Teil aus dem Spint in der Hand hat.
 * Teile mit Inventarnummer muessen exakt stimmen, sonst zaehlt die Groesse
 * (Handschuhe). Ist beides nicht erfasst, gibt es nichts zu pruefen.
 */
function pruefeAltesTeil(item, eingabe) {
  if (item.inventory_no) {
    // Die kurze Nummer vom Etikett genuegt, der Praefix kommt automatisch davor.
    const wert = norm(barcode.expand(item.type_id, eingabe));
    if (!wert) return 'Bitte die Inventarnummer des alten Teils scannen oder eintippen.';
    return wert === norm(item.inventory_no) ? null : 'Diese Inventarnummer gehört nicht zum Teil aus dem Spint.';
  }
  if (item.size) {
    // Groessen bleiben unangetastet — hier waere ein Barcode-Praefix falsch.
    const wert = norm(eingabe);
    if (!wert) return 'Bitte die Größe des alten Teils eintragen.';
    return wert === norm(item.size) ? null : `Diese Größe passt nicht zum Teil aus dem Spint (dort steht ${item.size}).`;
  }
  return null;
}

/**
 * Waehlt aus der Fundstelle das Teil aus, das der Betreuer in der Hand hat.
 * Bei mehreren Teilen derselben Groesse ist jedes recht — entscheidend ist,
 * dass die gescannte Nummer zur Fundstelle gehoert. Teile, die per Mengenangabe
 * ohne Nummer angelegt wurden, bekommen die gescannte Nummer jetzt zugewiesen.
 */
function waehleNeuesTeil(item, kandidaten, eingabe) {
  if (!item.has_inventory) {
    // Arten ohne Inventarnummer werden ueber die Groesse bestaetigt — ohne Praefix.
    const erwartet = norm(kandidaten[0].size);
    if (erwartet && norm(eingabe) !== erwartet) {
      return { fehler: `Bitte die Größe des neuen Teils bestätigen (an der Fundstelle liegt Größe ${kandidaten[0].size}).` };
    }
    return { gewaehlt: kandidaten[0] };
  }

  const voll = barcode.expand(item.type_id, eingabe);
  const wert = norm(voll);
  if (!wert) return { fehler: 'Bitte die Inventarnummer des neuen Teils scannen oder eintippen.' };

  const treffer = kandidaten.find((k) => norm(k.inventory_no) === wert);
  if (treffer) return { gewaehlt: treffer };

  // Sammelposten ohne Nummern: die gescannte Nummer wandert ins Teil — aber nur,
  // wenn sie nicht schon woanders hinterlegt ist. Sonst hat man das falsche Teil
  // in der Hand (oder es liegt am falschen Ort).
  const ohneNummer = kandidaten.find((k) => !k.inventory_no);
  if (ohneNummer) {
    const belegt = m.inventarNummerVergeben(voll);
    if (belegt) return { fehler: m.konfliktText(voll, belegt) };
    return { gewaehlt: ohneNummer, nummerUebernehmen: voll };
  }

  return { fehler: 'Diese Inventarnummer gehört zu keinem Teil an dieser Fundstelle.' };
}

// Schritt 1: Sicherheitsabfrage anzeigen.
router.post('/ausruestung/:id/tauschen/pruefen', login, (req, res) => {
  const item = itemWithType(req.params.id);
  if (!item) return res.redirect('/');

  const fund = fundstelle(item, req.body);
  if (!fund.kandidaten.length) {
    req.session.flash = { type: 'warn', text: 'An dieser Fundstelle liegt nichts Passendes mehr.' };
    return res.redirect(`/ausruestung/${item.id}/tauschen`);
  }

  res.render('tausch-bestaetigen', {
    title: `${item.type_name} tauschen — Kontrolle`,
    item,
    fund,
    storages: m.storagesAll(),
    sizeSchemes: sizes.schemes(),
    skipGruende: SKIP_GRUENDE,
    verbleib: req.body.verbleib || (item.condition === 'defekt' ? 'ausmustern' : 'lager'),
    fehler: null,
    werte: {},
  });
});

// Schritt 2: Eingaben pruefen und erst dann tauschen.
router.post('/ausruestung/:id/tauschen/ausfuehren', login, (req, res) => {
  const item = itemWithType(req.params.id);
  if (!item) return res.redirect('/');

  const fund = fundstelle(item, req.body);
  const altFehlt = req.body.alt_fehlt === '1';
  const skipGrund = SKIP_GRUENDE.includes(req.body.skip_grund) ? req.body.skip_grund : 'sonstiges';
  let verbleib = req.body.verbleib || 'lager';

  const seite = (fehler) =>
    res.status(400).render('tausch-bestaetigen', {
      title: `${item.type_name} tauschen — Kontrolle`,
      item,
      fund,
      storages: m.storagesAll(),
    sizeSchemes: sizes.schemes(),
      skipGruende: SKIP_GRUENDE,
      verbleib,
      fehler,
      werte: { alt: req.body.alt_pruefung || '', neu: req.body.neu_pruefung || '' },
    });

  if (!item.locker_id) {
    req.session.flash = { type: 'warn', text: 'Das alte Teil liegt in keinem Spint.' };
    return res.redirect(`/ausruestung/${item.id}/tauschen`);
  }
  if (!fund.kandidaten.length) {
    req.session.flash = { type: 'warn', text: 'An dieser Fundstelle liegt nichts Passendes mehr.' };
    return res.redirect(`/ausruestung/${item.id}/tauschen`);
  }

  if (!altFehlt) {
    const fehler = pruefeAltesTeil(item, req.body.alt_pruefung);
    if (fehler) return seite(fehler);
  } else if (skipGrund === 'verloren') {
    // Ein verlorenes Teil kann nicht zurueck ins Lager wandern.
    verbleib = 'ausmustern';
  }

  const wahl = waehleNeuesTeil(item, fund.kandidaten, req.body.neu_pruefung);
  if (wahl.fehler) return seite(wahl.fehler);

  const ersatz = wahl.gewaehlt;
  const altVorher = m.placementLabel(item);
  const neuVorher = m.placementLabel(ersatz);

  try {
    db.transaction(() => {
      if (wahl.nummerUebernehmen) {
        db.prepare('UPDATE equipment SET inventory_no = ? WHERE id = ?').run(wahl.nummerUebernehmen, ersatz.id);
      }
      m.setPlacement(ersatz.id, { lockerId: item.locker_id });
      if (verbleib === 'ausmustern') {
        db.prepare('UPDATE equipment SET retired = 1, locker_id = NULL, storage_id = NULL WHERE id = ?').run(item.id);
      } else {
        const ort = /^\d+$/.test(verbleib) && m.q.storageById.get(Number(verbleib)) ? Number(verbleib) : null;
        m.setPlacement(item.id, { storageId: ort });
      }
    })();
  } catch (err) {
    if (!/UNIQUE/i.test(err.message)) throw err;
    return seite(`Die Inventarnummer „${wahl.nummerUebernehmen}“ ist schon vergeben.`);
  }

  const altNachher = verbleib === 'ausmustern' ? 'ausgemustert' : m.placementLabel(m.q.equipmentById.get(item.id));
  const kontrolle = altFehlt ? `ohne Kontrolle des alten Teils (${skipGrund})` : 'altes Teil kontrolliert';
  audit.log(
    req,
    'ausruestung',
    ersatz.id,
    'getauscht',
    `${item.type_name} ${ersatz.size || ''} aus ${neuVorher} → ${altVorher}; altes Teil (${item.size || '?'}) → ${altNachher}; ${kontrolle}` +
      (wahl.nummerUebernehmen ? `; Inv.-Nr. ${wahl.nummerUebernehmen} zugewiesen` : '')
  );

  const zusatz = wahl.nummerUebernehmen ? ` Inventarnummer ${wahl.nummerUebernehmen} wurde dem Teil zugeordnet.` : '';
  req.session.flash = {
    type: 'ok',
    text: `Getauscht: ${item.type_name} Größe ${ersatz.size || '?'} liegt jetzt im Spint, das alte Teil ist ${altNachher}.${zusatz}`,
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

/**
 * "Gefunden": verlorene Sachen tauchen wieder auf. Statt die Bestellung von
 * Hand abzubrechen und das Teil an anderer Stelle zu reaktivieren — zwei
 * Schritte an zwei Orten — erledigt ein Knopf beides:
 *
 *   1. die Aufgabe wird abgebrochen, mit Vermerk im Verlauf
 *   2. war das Teil ausgemustert, kommt es in seinen Spint zurueck
 */
router.post('/aufgaben/:id/gefunden', login, (req, res) => {
  const task = m.q.taskById.get(req.params.id);
  if (!task) return res.redirect('/aufgaben');
  const zurueck = req.body.zurueck && req.body.zurueck.startsWith('/') ? req.body.zurueck : '/aufgaben';
  if (task.status !== 'offen') return res.redirect(zurueck);

  const teil = task.equipment_id ? m.q.equipmentById.get(task.equipment_id) : null;
  const zurueckInSpint = teil && teil.retired && task.locker_id;

  db.transaction(() => {
    db.prepare(
      "UPDATE tasks SET status = 'abgebrochen', done_at = datetime('now'), done_by = ?, " +
        "note = TRIM(COALESCE(note || ' · ', '') || 'wieder aufgetaucht') WHERE id = ?"
    ).run(req.session.user.name, task.id);

    if (zurueckInSpint) {
      db.prepare('UPDATE equipment SET retired = 0, locker_id = ?, storage_id = NULL WHERE id = ?')
        .run(task.locker_id, teil.id);
    }
  })();

  audit.log(req, 'aufgabe', task.id, 'wieder aufgetaucht', beschreibung(task));
  if (zurueckInSpint) audit.log(req, 'ausruestung', teil.id, 'wieder da', 'zurück in den Spint');

  const locker = task.locker_id ? m.q.lockerById.get(task.locker_id) : null;
  req.session.flash = {
    type: 'ok',
    text: zurueckInSpint
      ? `Wieder da — die Bestellung ist zurückgenommen und das Teil liegt wieder in Spint ${locker?.code ?? '?'}.`
      : 'Wieder da — die Bestellung ist zurückgenommen.',
  };
  res.redirect(zurueck);
});

router.post('/aufgaben/:id/loeschen', auth.requireJugendwart, (req, res) => {
  const task = m.q.taskById.get(req.params.id);
  if (!task) return res.redirect('/aufgaben');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  audit.log(req, 'aufgabe', task.id, 'gelöscht', beschreibung(task));
  req.session.flash = { type: 'ok', text: 'Aufgabe gelöscht.' };
  res.redirect('/aufgaben?status=alle');
});

module.exports = router;
