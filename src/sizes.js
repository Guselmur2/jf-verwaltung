'use strict';

// Groessen sind Freitext, weil jede Wehr anders beschriftet. Fuer die haeufigen
// Zahlenschemata kann die Software aber die naechste Groesse vorschlagen:
//
//   Koerpergroessen (Kinder/Jugend): 128 134 140 146 152 158 164 170 176 182 188 194
//     -> Schritte von 6, also 164 + 1 Nummer = 170
//   Schuh- und Handschuhgroessen: ganze Zahlen (Schuh 32, Handschuh 8)
//     -> Schritte von 1, also 32 + 2 Nummern = 34
//
// Alles andere (S/M/L, "170/94") bekommt keinen Vorschlag; dort tippt man die
// Wunschgroesse einfach ein.

const KOERPER_SCHRITT = 6;
const KOERPER_MIN = 80;
const KOERPER_MAX = 194;
const NUMMER_MIN = 5;

/** Erkennt das Zahlenschema einer Groesse oder null, wenn es keins ist. */
function scheme(size) {
  const s = String(size ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  if (n >= KOERPER_MIN && n <= KOERPER_MAX) return n % KOERPER_SCHRITT === 2 ? 'koerper' : null;
  if (n >= NUMMER_MIN && n < KOERPER_MIN) return 'nummer';
  return null;
}

/**
 * Liefert die um <steps> Nummern groessere (oder kleinere) Groesse als Text,
 * oder null, wenn sich das Schema nicht erkennen laesst.
 */
function stepSize(size, steps) {
  const art = scheme(size);
  if (!art || !Number.isInteger(steps) || steps === 0) return null;

  const n = Number(String(size).trim());
  const neu = art === 'koerper' ? n + steps * KOERPER_SCHRITT : n + steps;

  if (art === 'koerper' && (neu < KOERPER_MIN || neu > KOERPER_MAX)) return null;
  if (art === 'nummer' && (neu < NUMMER_MIN || neu >= KOERPER_MIN)) return null;
  return String(neu);
}

/** Vorschlaege fuer die Wunschgroesse: eine und zwei Nummern groesser/kleiner. */
function suggestions(size) {
  return [-1, 1, 2]
    .map((s) => ({ steps: s, size: stepSize(size, s) }))
    .filter((v) => v.size !== null)
    .map((v) => ({
      ...v,
      label: v.steps < 0 ? `${Math.abs(v.steps)} kleiner` : `${v.steps} größer`,
    }));
}

module.exports = { scheme, stepSize, suggestions };
