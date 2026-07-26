'use strict';

// Wandelt eine flexible deutsche Datumseingabe in ISO (yyyy-mm-dd) um oder gibt
// null zurueck, wenn nichts Sinnvolles erkennbar ist. Akzeptiert:
//   5.5.16   05.05.2016   5.5.2016   2016-05-05   5/5/16
//
// Zweistellige Jahre bekommen das Jahrhundert so, dass das Datum nicht in der
// Zukunft liegt: 2000+JJ, falls das <= aktuelles Jahr ist, sonst 1900+JJ.
//   "16" -> 2016 (Jugendliche), "87" -> 1987 (aeltere Feuerwehrleute)
function parseGermanDate(input, today = new Date()) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  // Bereits ISO?
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return normalize(Number(m[1]), Number(m[2]), Number(m[3]));

  // Tag . Monat . Jahr  mit . / oder - als Trenner
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})$/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);

  if (m[3].length === 2) {
    const imJahrhundert2000 = 2000 + year;
    year = imJahrhundert2000 <= today.getFullYear() ? imJahrhundert2000 : 1900 + year;
  }
  return normalize(year, month, day);
}

// Prueft Gueltigkeit (auch 31.02. wird abgelehnt) und formatiert nach ISO.
function normalize(year, month, day) {
  if (year < 1900 || year > 2999) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}

// ISO (yyyy-mm-dd) -> deutsche Anzeige (dd.mm.yyyy). Unbekanntes bleibt, wie es ist.
function formatGermanDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}

module.exports = { parseGermanDate, formatGermanDate };
