'use strict';

const { db } = require('./db');

// Inventarnummern einer Ausruestungsart haben oft einen festen Anfang, der auf
// jedem Etikett gleich ist — im Geraetehaus etwa "KKJF.1202." bei den Helmen und
// "112000" bei Jacken und Hosen. Beim Scannen kommt die ganze Nummer an, beim
// Eintippen nur der hintere Teil. Diese Datei ergaenzt den Anfang.

const q = {
  typ: db.prepare('SELECT id, name, barcode_prefix, barcode_digits FROM equipment_types WHERE id = ?'),
  mitPraefix: db.prepare(
    "SELECT id, name, barcode_prefix, barcode_digits FROM equipment_types " +
      "WHERE barcode_prefix IS NOT NULL AND TRIM(barcode_prefix) <> ''"
  ),
};

/** Wie viele Stellen darf der eingetippte Rest hoechstens haben? */
function maxStellen(typ) {
  const n = Number(typ.barcode_digits);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

/**
 * Ergaenzt den Praefix, wenn nur der hintere Teil der Nummer eingegeben wurde.
 * Unveraendert bleibt alles, was schon lang genug ist, den Praefix bereits
 * traegt oder keine reine Zahl ist — eine gescannte Nummer geht also unberuehrt
 * durch.
 */
function expand(typeId, eingabe) {
  const s = String(eingabe ?? '').trim();
  if (!s || !typeId) return s;

  const typ = q.typ.get(typeId);
  const praefix = (typ && typ.barcode_prefix ? String(typ.barcode_prefix) : '').trim();
  if (!praefix) return s;

  if (s.toLowerCase().startsWith(praefix.toLowerCase())) return s;
  if (!/^\d+$/.test(s)) return s;

  const stellen = maxStellen(typ);
  if (s.length > stellen) return s;

  return praefix + (typ.barcode_digits ? s.padStart(stellen, '0') : s);
}

/**
 * Fuer die Suche nach einer eingetippten Kurznummer: liefert alle Nummern, die
 * gemeint sein koennten — die Eingabe selbst und jede Art-Variante mit Praefix.
 */
function candidates(eingabe) {
  const s = String(eingabe ?? '').trim();
  if (!s) return [];

  const out = [s];
  if (/^\d+$/.test(s)) {
    for (const typ of q.mitPraefix.all()) {
      const voll = expand(typ.id, s);
      if (voll !== s && !out.includes(voll)) out.push(voll);
    }
  }
  return out;
}

module.exports = { expand, candidates };
