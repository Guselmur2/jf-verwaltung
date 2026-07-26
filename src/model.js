'use strict';

const { db } = require('./db');

const q = {
  lockerById: db.prepare('SELECT * FROM lockers WHERE id = ?'),
  memberById: db.prepare('SELECT * FROM members WHERE id = ?'),
  typeById: db.prepare('SELECT * FROM equipment_types WHERE id = ?'),
  equipmentById: db.prepare('SELECT * FROM equipment WHERE id = ?'),
  areaById: db.prepare('SELECT * FROM areas WHERE id = ?'),
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

function storageEquipment({ typeId = null, search = '' } = {}) {
  const where = ['e.locker_id IS NULL', 'e.retired = 0'];
  const params = {};
  if (typeId) {
    where.push('e.type_id = @typeId');
    params.typeId = Number(typeId);
  }
  if (search) {
    where.push('(e.inventory_no LIKE @s OR e.size LIKE @s OR t.name LIKE @s)');
    params.s = `%${search}%`;
  }
  return db
    .prepare(
      `SELECT e.*, t.name AS type_name, t.has_size, t.has_inventory
         FROM equipment e
         JOIN equipment_types t ON t.id = e.type_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.sort_order, t.name COLLATE NOCASE, e.size, e.inventory_no`
    )
    .all(params);
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

function search(term) {
  const s = `%${term}%`;
  return {
    lockers: db
      .prepare(
        `SELECT l.*, a.name AS area_name, a.sort_order AS area_sort, m.name AS member_name
           FROM lockers l
           LEFT JOIN areas a ON a.id = l.area_id
           LEFT JOIN members m ON m.id = l.member_id
          WHERE l.code LIKE @s OR l.label LIKE @s OR l.location LIKE @s OR m.name LIKE @s OR a.name LIKE @s
          ${LOCKER_ORDER}`
      )
      .all({ s }),
    members: db
      .prepare(
        `SELECT m.*, l.id AS locker_id, l.code AS locker_code FROM members m
           LEFT JOIN lockers l ON l.member_id = m.id
          WHERE m.name LIKE @s
          ORDER BY m.name COLLATE NOCASE`
      )
      .all({ s }),
    equipment: db
      .prepare(
        `SELECT e.*, t.name AS type_name, l.id AS locker_id, l.code AS locker_code, m.name AS member_name
           FROM equipment e
           JOIN equipment_types t ON t.id = e.type_id
           LEFT JOIN lockers l ON l.id = e.locker_id
           LEFT JOIN members m ON m.id = l.member_id
          WHERE e.inventory_no LIKE @s OR e.size LIKE @s OR t.name LIKE @s OR e.note LIKE @s
          ORDER BY e.retired, t.sort_order, e.inventory_no`
      )
      .all({ s }),
  };
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
  };
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
  activeTypes,
  allTypes,
  equipmentOfLocker,
  storageEquipment,
  lockerOverview,
  allLockers,
  lockersInArea,
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
