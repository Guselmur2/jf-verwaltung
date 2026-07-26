'use strict';

const { db } = require('./db');

// Groessen kommen aus dem Katalog in der Datenbank (Tabelle sizes), nicht aus
// einer Rechenformel. Nur so lassen sich Reihen abbilden, die nicht gleichmaessig
// laufen — etwa der Sprung von Koerpergroesse 176 auf Konfektionsgroesse 44.

const q = {
  vonSchema: db.prepare('SELECT * FROM sizes WHERE scheme = ? ORDER BY sort_order, id'),
  schema: db.prepare('SELECT * FROM size_schemes WHERE name = ?'),
  alleSchemata: db.prepare('SELECT * FROM size_schemes ORDER BY name'),
  typ: db.prepare('SELECT * FROM equipment_types WHERE id = ?'),
};

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

/** Alle Groessen eines Schemas in der richtigen Reihenfolge. */
function sizesOfScheme(scheme) {
  return scheme ? q.vonSchema.all(scheme) : [];
}

function schemes() {
  return q.alleSchemata.all().map((s) => ({ ...s, sizes: sizesOfScheme(s.name) }));
}

/** Das Schema einer Ausruestungsart, oder null wenn die Art keines fuehrt. */
function schemeOfType(typeId) {
  const typ = q.typ.get(typeId);
  return typ && typ.size_scheme ? typ.size_scheme : null;
}

function sizesOfType(typeId) {
  return sizesOfScheme(schemeOfType(typeId));
}

/**
 * Ist die Groesse fuer diese Art gueltig? Ohne hinterlegtes Schema oder ohne
 * Eingabe gilt alles als gueltig — dann prueft die Software nichts.
 */
function isKnown(typeId, wert) {
  const w = norm(wert);
  if (!w) return true;
  const liste = sizesOfType(typeId);
  if (!liste.length) return true;
  return liste.some((s) => norm(s.wert) === w);
}

/**
 * Naechstliegende gueltige Groesse zu einer Eingabe. Bei Zahlen ueber den
 * Abstand (162 -> 164), sonst ueber den Textanfang.
 */
function nearest(typeId, wert) {
  const w = norm(wert);
  const liste = sizesOfType(typeId);
  if (!w || !liste.length) return null;

  const zahl = Number(w.replace(',', '.'));
  if (Number.isFinite(zahl)) {
    let beste = null;
    let abstand = Infinity;
    for (const s of liste) {
      const n = Number(String(s.wert).replace(',', '.'));
      if (!Number.isFinite(n)) continue;
      const d = Math.abs(n - zahl);
      if (d < abstand) {
        abstand = d;
        beste = s;
      }
    }
    return beste;
  }
  return liste.find((s) => norm(s.wert).startsWith(w)) || null;
}

/**
 * Die um <steps> Positionen groessere (oder kleinere) Groesse aus dem Katalog.
 * Laeuft ueber den Uebergang hinweg: nach 176 kommt 44.
 */
function stepSize(typeId, wert, steps) {
  const liste = sizesOfType(typeId);
  if (!liste.length || !Number.isInteger(steps) || steps === 0) return null;

  const i = liste.findIndex((s) => norm(s.wert) === norm(wert));
  if (i < 0) return null;

  const ziel = i + steps;
  return ziel >= 0 && ziel < liste.length ? liste[ziel].wert : null;
}

/** Vorschlaege fuers Tauschen: eine kleiner, eine und zwei Nummern groesser. */
function suggestions(typeId, wert) {
  return [-1, 1, 2]
    .map((s) => ({ steps: s, size: stepSize(typeId, wert, s) }))
    .filter((v) => v.size !== null)
    .map((v) => ({ ...v, label: v.steps < 0 ? `${Math.abs(v.steps)} kleiner` : `${v.steps} größer` }));
}

module.exports = { sizesOfScheme, sizesOfType, schemeOfType, schemes, isKnown, nearest, stepSize, suggestions };
