'use strict';

const { db } = require('./db');

const q = {
  lockerById: db.prepare('SELECT * FROM lockers WHERE id = ?'),
  memberById: db.prepare('SELECT * FROM members WHERE id = ?'),
  typeById: db.prepare('SELECT * FROM equipment_types WHERE id = ?'),
  equipmentById: db.prepare('SELECT * FROM equipment WHERE id = ?'),
  areaById: db.prepare('SELECT * FROM areas WHERE id = ?'),
  storageById: db.prepare('SELECT * FROM storages WHERE id = ?'),
  taskById: db.prepare('SELECT * FROM tasks WHERE id = ?'),
};

// Geschlechter und ihre Beschriftungen an einer Stelle.
const GENDERS = ['m', 'w', 'd'];
const GENDER = { m: 'männlich', w: 'weiblich', d: 'divers' };
const GENDER_GROUP = { m: 'Jungs', w: 'Mädels', d: 'Divers' };
const DEFAULT_AREA_NAME = { m: 'Umkleide Jungs', w: 'Umkleide Mädels', d: 'Umkleide Divers' };

/** Sortierschluessel: erst nach Bereich, dann "2" vor "10", "A1" zuletzt. */
const LOCKER_ORDER = `ORDER BY a.sort_order, a.id,
  CASE WHEN l.code GLOB '[0-9]*' THEN 0 ELSE 1 END,
  CAST(l.code AS INTEGER),
  l.code COLLATE NOCASE`;

const LOCKER_SELECT = `SELECT l.*, a.name AS area_name, a.sort_order AS area_sort
  FROM lockers l LEFT JOIN areas a ON a.id = l.area_id`;

// ---------------------------------------------------------------- Ausruestung

function activeTypes() {
  return db
    .prepare('SELECT * FROM equipment_types WHERE active = 1 ORDER BY sort_order, name COLLATE NOCASE')
    .all();
}

function allTypes() {
  return db
    .prepare('SELECT * FROM equipment_types ORDER BY active DESC, sort_order, name COLLATE NOCASE')
    .all();
}

function equipmentOfLocker(lockerId) {
  return db
    .prepare(
      `SELECT e.*, t.name AS type_name, t.has_size, t.has_inventory, t.sort_order
         FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
        WHERE e.locker_id = ? AND e.retired = 0
        ORDER BY t.sort_order, t.name COLLATE NOCASE, e.id`
    )
    .all(lockerId);
}

/**
 * Ausruestung im Lager, also alles ausserhalb der Spinte.
 * storageId: Zahl = nur dieser Lagerort, 'ohne' = ohne Ort, null = alles.
 */
function storageEquipment({ typeId = null, search = '', storageId = null } = {}) {
  const where = ['e.locker_id IS NULL', 'e.retired = 0'];
  const params = {};
  if (typeId) {
    where.push('e.type_id = @typeId');
    params.typeId = Number(typeId);
  }
  if (storageId === 'ohne') {
    where.push('e.storage_id IS NULL');
  } else if (storageId) {
    where.push('e.storage_id = @storageId');
    params.storageId = Number(storageId);
  }
  if (search) {
    where.push('(e.inventory_no LIKE @s OR e.size LIKE @s OR t.name LIKE @s OR st.name LIKE @s)');
    params.s = `%${search}%`;
  }
  return db
    .prepare(
      `SELECT e.*, t.name AS type_name, t.has_size, t.has_inventory, st.name AS storage_name
         FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
         LEFT JOIN storages st ON st.id = e.storage_id
        WHERE ${where.join(' AND ')}
        ORDER BY st.sort_order, st.name COLLATE NOCASE, t.sort_order, t.name COLLATE NOCASE, e.size, e.inventory_no`
    )
    .all(params);
}

// ----------------------------------------------------------------- Lagerorte

function storagesAll() {
  return db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM equipment e
                WHERE e.storage_id = s.id AND e.locker_id IS NULL AND e.retired = 0) AS item_count
         FROM storages s
        ORDER BY s.sort_order, s.name COLLATE NOCASE`
    )
    .all();
}

/** Teile eines Lagerorts, nach Art gruppiert — "10 x Jacke, 20 x Schuhe". */
function storageContents(storageId) {
  const items = db
    .prepare(
      `SELECT e.*, t.name AS type_name, t.has_size, t.has_inventory, t.sort_order
         FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
        WHERE e.storage_id = @id AND e.locker_id IS NULL AND e.retired = 0
        ORDER BY t.sort_order, t.name COLLATE NOCASE,
                 CASE WHEN e.size GLOB '[0-9]*' THEN 0 ELSE 1 END,
                 CAST(e.size AS INTEGER), e.size, e.inventory_no`
    )
    .all({ id: storageId });

  const gruppen = [];
  for (const it of items) {
    let g = gruppen.find((x) => x.type_id === it.type_id);
    if (!g) {
      g = { type_id: it.type_id, type_name: it.type_name, has_size: it.has_size, items: [], sizes: new Map() };
      gruppen.push(g);
    }
    g.items.push(it);
    const key = it.size || '—';
    g.sizes.set(key, (g.sizes.get(key) || 0) + 1);
  }
  for (const g of gruppen) {
    g.count = g.items.length;
    g.sizeList = [...g.sizes.entries()].map(([size, n]) => ({ size, n }));
    delete g.sizes;

    // Zwanzig gleiche Paar Schuhe einzeln aufzulisten hilft niemandem. Einzeln
    // erscheint nur, was sich unterscheidet — Inventarnummer, Notiz oder ein
    // Zustand ausser "gut". Der Rest steckt in der Groessen-Zusammenfassung.
    g.detail = g.items.filter((it) => it.inventory_no || it.note || it.condition !== 'gut');
    g.plainCount = g.count - g.detail.length;
  }
  return { items, gruppen, total: items.length };
}

/**
 * Sucht im Lager ein passendes Ersatzteil: gleiche Art, gewuenschte Groesse,
 * nicht defekt, nicht ausgemustert, in keinem Spint.
 */
function findReplacement(typeId, size) {
  const wanted = String(size ?? '').trim();
  return db
    .prepare(
      `SELECT e.*, t.name AS type_name, st.name AS storage_name
         FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
         LEFT JOIN storages st ON st.id = e.storage_id
        WHERE e.type_id = @typeId
          AND e.locker_id IS NULL
          AND e.retired = 0
          AND e.condition <> 'defekt'
          AND TRIM(COALESCE(e.size, '')) = @size COLLATE NOCASE
        ORDER BY CASE e.condition WHEN 'gut' THEN 0 ELSE 1 END, st.sort_order, e.id`
    )
    .all({ typeId: Number(typeId), size: wanted });
}

/**
 * Die Teile einer konkreten Fundstelle: gleiche Art, Groesse, Lagerort und
 * Zustand. Wird beim Bestaetigen erneut geladen, statt der Formularseite eine
 * Liste von IDs zu glauben.
 */
function replacementCandidates(typeId, size, storageId, condition) {
  return findReplacement(typeId, size).filter(
    (t) => (storageId ? t.storage_id === storageId : !t.storage_id) && (!condition || t.condition === condition)
  );
}

/** Wo liegt ein Teil? Fuer Protokoll und Anzeige. */
function placementLabel(item) {
  if (!item) return '—';
  if (item.retired) return 'ausgemustert';
  if (item.locker_id) {
    const l = q.lockerById.get(item.locker_id);
    return l ? `Spint ${l.code}` : 'Spint';
  }
  if (item.storage_id) {
    const s = q.storageById.get(item.storage_id);
    return s ? s.name : 'Lager';
  }
  return 'Lager ohne Ort';
}

/**
 * Setzt den Ablageort eines Teils. Spint und Lagerort schliessen sich aus —
 * hier an einer Stelle erzwungen, statt an jeder Aufrufstelle.
 */
function setPlacement(equipmentId, { lockerId = null, storageId = null } = {}) {
  const locker = lockerId ? Number(lockerId) : null;
  const storage = locker ? null : storageId ? Number(storageId) : null;
  db.prepare('UPDATE equipment SET locker_id = ?, storage_id = ? WHERE id = ?').run(locker, storage, equipmentId);
  return { lockerId: locker, storageId: storage };
}

// -------------------------------------------------------------------- Spinte

function lockerOverview() {
  const lockers = db
    .prepare(
      `SELECT l.*, a.name AS area_name, a.sort_order AS area_sort,
              m.name AS member_name, m.active AS member_active,
              (SELECT COUNT(*) FROM equipment e WHERE e.locker_id = l.id AND e.retired = 0) AS item_count
         FROM lockers l
         LEFT JOIN areas a ON a.id = l.area_id
         LEFT JOIN members m ON m.id = l.member_id
         ${LOCKER_ORDER}`
    )
    .all();

  const items = db
    .prepare(
      `SELECT e.locker_id, e.size, e.inventory_no, t.name AS type_name, t.sort_order
         FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
        WHERE e.retired = 0 AND e.locker_id IS NOT NULL
        ORDER BY t.sort_order, t.name COLLATE NOCASE`
    )
    .all();

  const byLocker = new Map();
  for (const it of items) {
    if (!byLocker.has(it.locker_id)) byLocker.set(it.locker_id, []);
    byLocker.get(it.locker_id).push(it);
  }
  for (const l of lockers) l.items = byLocker.get(l.id) || [];
  return lockers;
}

function allLockers() {
  return db.prepare(`${LOCKER_SELECT} ${LOCKER_ORDER}`).all();
}

function lockersInArea(areaId) {
  return db.prepare(`${LOCKER_SELECT} WHERE l.area_id = ? ${LOCKER_ORDER}`).all(areaId);
}

/** Spint anhand des QR-Geheimnisses. Nur exakte Treffer, kein LIKE. */
function lockerByToken(token) {
  return db.prepare(`${LOCKER_SELECT} WHERE l.token = ?`).get(token) || null;
}

function storageByToken(token) {
  return db.prepare('SELECT * FROM storages WHERE token = ?').get(token) || null;
}

// ---------------------------------------------------------------- Bereiche

function areasAll() {
  return db.prepare('SELECT * FROM areas ORDER BY sort_order, id').all();
}

function primaryArea() {
  return db.prepare('SELECT * FROM areas ORDER BY sort_order, id LIMIT 1').get() || null;
}

/** Legt bei Bedarf einen Standardbereich an und liefert den ersten Bereich. */
function ensureDefaultArea(name = 'Umkleide') {
  let area = primaryArea();
  if (!area) {
    const info = db.prepare('INSERT INTO areas (name, sort_order) VALUES (?, 100)').run(name);
    area = q.areaById.get(info.lastInsertRowid);
  }
  return area;
}

function genderAreaMap() {
  const map = {};
  for (const r of db.prepare('SELECT gender, area_id FROM gender_area').all()) map[r.gender] = r.area_id;
  return map;
}

function setGenderArea(gender, areaId) {
  db.prepare(
    'INSERT INTO gender_area (gender, area_id) VALUES (?, ?) ' +
      'ON CONFLICT(gender) DO UPDATE SET area_id = excluded.area_id'
  ).run(gender, areaId);
}

function gendersWithMembers() {
  return db
    .prepare("SELECT DISTINCT gender FROM members WHERE active = 1 AND gender IS NOT NULL")
    .all()
    .map((r) => r.gender);
}

/** Bereiche, die tatsaechlich in Benutzung sind: mit Spinten oder mit Mitgliedern. */
function activeAreaIds() {
  const ids = new Set(
    db
      .prepare('SELECT DISTINCT area_id AS id FROM lockers WHERE area_id IS NOT NULL')
      .all()
      .map((r) => r.id)
  );
  const gmap = genderAreaMap();
  for (const g of gendersWithMembers()) if (gmap[g]) ids.add(gmap[g]);
  return ids;
}

/** Erst wenn zwei Bereiche wirklich genutzt werden, wird nach Bereich unterschieden. */
function showAreas() {
  return activeAreaIds().size >= 2;
}

/** Ist "divers" ueberhaupt im Einsatz? Sonst wird der Bereich nirgends gezeigt. */
function diverseActive() {
  if (gendersWithMembers().includes('d')) return true;
  const areaId = genderAreaMap().d;
  if (!areaId) return false;
  return db.prepare('SELECT COUNT(*) AS n FROM lockers WHERE area_id = ?').get(areaId).n > 0;
}

/**
 * Ist <gender> ein wirklich neues Geschlecht, fuer das noch kein Bereich
 * feststeht, obwohl es bereits andere Geschlechter gibt? Dann soll der
 * Jugendwart beim Anlegen nach einem eigenen Bereich gefragt werden.
 */
function isNewGenderNeedingSetup(gender) {
  if (!GENDERS.includes(gender)) return false;
  const gmap = genderAreaMap();
  if (gmap[gender]) return false; // Bereich steht schon
  // Gibt es bereits ein anderes Geschlecht mit Mitgliedern oder eine Zuordnung?
  const andere = gendersWithMembers().filter((g) => g !== gender);
  const zuordnungen = Object.keys(gmap).filter((g) => g !== gender);
  return andere.length > 0 || zuordnungen.length > 0;
}

/** Naechste freie Nummer je nach Nummerierungsart des Bereichs. */
function suggestNextCode(area) {
  let row;
  if (area && area.numbering === 'fortlaufend') {
    row = db.prepare("SELECT MAX(CAST(code AS INTEGER)) AS mx FROM lockers WHERE code GLOB '[0-9]*'").get();
  } else if (area) {
    row = db
      .prepare("SELECT MAX(CAST(code AS INTEGER)) AS mx FROM lockers WHERE area_id = ? AND code GLOB '[0-9]*'")
      .get(area.id);
  } else {
    row = db.prepare("SELECT MAX(CAST(code AS INTEGER)) AS mx FROM lockers WHERE code GLOB '[0-9]*'").get();
  }
  return String((row.mx || 0) + 1).padStart(2, '0');
}

// ------------------------------------------------------------------ Mitglieder

function members({ includeInactive = false } = {}) {
  const sql = `SELECT m.*, l.id AS locker_id, l.code AS locker_code
                 FROM members m
                 LEFT JOIN lockers l ON l.member_id = m.id
                ${includeInactive ? '' : 'WHERE m.active = 1'}
                ORDER BY m.active DESC, m.name COLLATE NOCASE`;
  return db.prepare(sql).all();
}

/**
 * Mitglieder ohne eigenen Spint (plus das aktuell zugewiesene). Ist areaId
 * gesetzt und wird nach Bereich unterschieden, kommen nur Geschlechter infrage,
 * die diesem Bereich zugeordnet sind (Mitglieder ohne Geschlecht immer).
 */
function assignableMembers(currentMemberId = null, areaId = null) {
  const rows = db
    .prepare(
      `SELECT m.* FROM members m
        WHERE m.active = 1
          AND (m.id = @current OR NOT EXISTS (SELECT 1 FROM lockers l WHERE l.member_id = m.id))
        ORDER BY m.name COLLATE NOCASE`
    )
    .all({ current: currentMemberId ?? -1 });

  if (!areaId || !showAreas()) return rows;

  const gmap = genderAreaMap();
  const erlaubt = new Set(Object.keys(gmap).filter((g) => gmap[g] === areaId));
  return rows.filter((mem) => mem.id === currentMemberId || !mem.gender || erlaubt.has(mem.gender));
}

// ---------------------------------------------------------------------- Suche

const SUCHE_MAX_WOERTER = 8;

/**
 * Sucht ueber mehrere Woerter: jedes Wort muss in irgendeiner der Spalten
 * vorkommen, und zwar alle. "Jacke 162" findet damit die Jacke in Groesse 162,
 * obwohl in keiner einzelnen Spalte "Jacke 162" steht.
 *
 * Die Spaltennamen stehen fest im Code, die Suchwoerter gehen als Parameter in
 * die Abfrage — so bleibt sie gegen eingeschleustes SQL sicher.
 */
function wortBedingung(spalten, woerter) {
  return woerter
    .map((_, i) => '(' + spalten.map((c) => `${c} LIKE @w${i}`).join(' OR ') + ')')
    .join(' AND ');
}

function search(term) {
  const woerter = String(term ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, SUCHE_MAX_WOERTER);

  const leer = { lockers: [], members: [], equipment: [], storages: [] };
  if (!woerter.length) return leer;

  const params = {};
  woerter.forEach((w, i) => {
    params[`w${i}`] = `%${w}%`;
  });

  const wo = (spalten) => wortBedingung(spalten, woerter);

  return {
    lockers: db
      .prepare(
        `SELECT l.*, a.name AS area_name, a.sort_order AS area_sort, m.name AS member_name
           FROM lockers l
           LEFT JOIN areas a ON a.id = l.area_id
           LEFT JOIN members m ON m.id = l.member_id
          WHERE ${wo(['l.code', 'l.label', 'l.location', 'm.name', 'a.name'])}
          ${LOCKER_ORDER}`
      )
      .all(params),
    members: db
      .prepare(
        `SELECT m.*, l.id AS locker_id, l.code AS locker_code FROM members m
           LEFT JOIN lockers l ON l.member_id = m.id
          WHERE ${wo(['m.name', 'm.note', 'l.code'])}
          ORDER BY m.name COLLATE NOCASE`
      )
      .all(params),
    equipment: db
      .prepare(
        `SELECT e.*, t.name AS type_name, l.id AS locker_id, l.code AS locker_code,
                st.name AS storage_name, m.name AS member_name
           FROM equipment e
           JOIN equipment_types t ON t.id = e.type_id
           LEFT JOIN lockers l ON l.id = e.locker_id
           LEFT JOIN storages st ON st.id = e.storage_id
           LEFT JOIN members m ON m.id = l.member_id
          WHERE ${wo([
            'e.inventory_no',
            'e.size',
            't.name',
            'e.note',
            'e.condition',
            'st.name',
            'l.code',
            'm.name',
          ])}
          ORDER BY e.retired, t.sort_order, e.size, e.inventory_no`
      )
      .all(params),
    storages: db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM equipment e
                  WHERE e.storage_id = s.id AND e.locker_id IS NULL AND e.retired = 0) AS item_count
           FROM storages s
          WHERE ${wo(['s.name', 's.location', 's.note'])}
          ORDER BY s.sort_order, s.name COLLATE NOCASE`
      )
      .all(params),
  };
}

// ------------------------------------------------------------------ Aufgaben

const TASK_KIND = { tausch: 'Tausch', bestellung: 'Bestellung' };
const TASK_STATUS = { offen: 'offen', erledigt: 'erledigt', abgebrochen: 'abgebrochen' };

function tasksList(status = 'offen') {
  const where = status === 'alle' ? '' : 'WHERE k.status = @status';
  return db
    .prepare(
      `SELECT k.*, t.name AS type_name, m.name AS member_name, l.code AS locker_code, l.id AS locker_id
         FROM tasks k
         LEFT JOIN equipment_types t ON t.id = k.type_id
         LEFT JOIN members m ON m.id = k.member_id
         LEFT JOIN lockers l ON l.id = k.locker_id
         ${where}
        ORDER BY CASE k.status WHEN 'offen' THEN 0 ELSE 1 END, k.id DESC`
    )
    .all({ status });
}

function openTaskCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'offen'").get().n;
}

/** Exakte Treffer zu einer Inventarnummer — Grundlage fuer den Barcode-Scan. */
function findByInventoryNo(nr) {
  const s = String(nr ?? '').trim();
  if (!s) return [];
  return db
    .prepare(
      `SELECT e.*, t.name AS type_name, l.id AS locker_id, l.code AS locker_code,
              st.name AS storage_name, m.name AS member_name
         FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
         LEFT JOIN lockers l ON l.id = e.locker_id
         LEFT JOIN storages st ON st.id = e.storage_id
         LEFT JOIN members m ON m.id = l.member_id
        WHERE TRIM(e.inventory_no) = @s COLLATE NOCASE
        ORDER BY e.retired, e.id`
    )
    .all({ s });
}

function stats() {
  const one = (sql) => db.prepare(sql).get().n;
  return {
    lockers: one('SELECT COUNT(*) AS n FROM lockers'),
    lockersFree: one('SELECT COUNT(*) AS n FROM lockers WHERE member_id IS NULL'),
    members: one('SELECT COUNT(*) AS n FROM members WHERE active = 1'),
    equipment: one('SELECT COUNT(*) AS n FROM equipment WHERE retired = 0'),
    storage: one('SELECT COUNT(*) AS n FROM equipment WHERE retired = 0 AND locker_id IS NULL'),
    defect: one("SELECT COUNT(*) AS n FROM equipment WHERE retired = 0 AND condition = 'defekt'"),
    tasks: one("SELECT COUNT(*) AS n FROM tasks WHERE status = 'offen'"),
  };
}

/**
 * Traegt schon ein anderes Teil diese Inventarnummer? Liefert das Teil zurueck
 * oder null. Gross-/Kleinschreibung spielt keine Rolle, damit "ja-1" und "JA-1"
 * nicht als zwei verschiedene Nummern durchgehen.
 */
function inventarNummerVergeben(nr, ausserId = null) {
  const s = String(nr ?? '').trim();
  if (!s) return null;
  return (
    db
      .prepare(
        `SELECT e.*, t.name AS type_name, l.id AS locker_id, l.code AS locker_code,
                st.name AS storage_name, m.name AS member_name
           FROM equipment e
           JOIN equipment_types t ON t.id = e.type_id
           LEFT JOIN lockers l ON l.id = e.locker_id
           LEFT JOIN storages st ON st.id = e.storage_id
           LEFT JOIN members m ON m.id = l.member_id
          WHERE TRIM(e.inventory_no) = @s COLLATE NOCASE AND e.id <> @ausser
          LIMIT 1`
      )
      .get({ s, ausser: ausserId ?? -1 }) || null
  );
}

/** Satz fuer die Fehlermeldung: wo das Teil mit dieser Nummer liegt. */
function konfliktText(nr, treffer) {
  const wo = treffer.locker_code
    ? `Spint ${treffer.locker_code}${treffer.member_name ? ` (${treffer.member_name})` : ''}`
    : placementLabel(treffer);
  const groesse = treffer.size ? ` Gr. ${treffer.size}` : '';
  return `Die Inventarnummer „${nr}“ ist schon vergeben: ${treffer.type_name}${groesse} in ${wo}.`;
}

/** Alle mehrfach vergebenen Inventarnummern — fuer Migration und Pruefung. */
function doppelteInventarNummern() {
  return db
    .prepare(
      `SELECT TRIM(inventory_no) AS nr, COUNT(*) AS anzahl
         FROM equipment
        WHERE inventory_no IS NOT NULL AND TRIM(inventory_no) <> ''
        GROUP BY LOWER(TRIM(inventory_no))
       HAVING COUNT(*) > 1
        ORDER BY anzahl DESC, nr`
    )
    .all();
}

/** Kurzbeschreibung eines Ausruestungsstuecks fuers Protokoll. */
function describe(item) {
  const bits = [item.type_name || q.typeById.get(item.type_id)?.name || 'Teil'];
  if (item.size) bits.push(`Gr. ${item.size}`);
  if (item.inventory_no) bits.push(`Inv. ${item.inventory_no}`);
  return bits.join(' ');
}

module.exports = {
  q,
  GENDERS,
  GENDER,
  GENDER_GROUP,
  DEFAULT_AREA_NAME,
  TASK_KIND,
  TASK_STATUS,
  activeTypes,
  allTypes,
  equipmentOfLocker,
  storageEquipment,
  storagesAll,
  storageContents,
  findReplacement,
  replacementCandidates,
  placementLabel,
  setPlacement,
  tasksList,
  openTaskCount,
  findByInventoryNo,
  inventarNummerVergeben,
  konfliktText,
  doppelteInventarNummern,
  lockerOverview,
  allLockers,
  lockersInArea,
  lockerByToken,
  storageByToken,
  areasAll,
  primaryArea,
  ensureDefaultArea,
  genderAreaMap,
  setGenderArea,
  gendersWithMembers,
  activeAreaIds,
  showAreas,
  diverseActive,
  isNewGenderNeedingSetup,
  suggestNextCode,
  members,
  assignableMembers,
  search,
  stats,
  describe,
};
