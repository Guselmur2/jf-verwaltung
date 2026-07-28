'use strict';

// Kaputte Umlaute erkennen, bevor sie in der Datenbank landen.
//
// Beim Dekodieren wird aus jedem Byte, das kein gueltiges UTF-8 ergibt, das
// Ersatzzeichen U+FFFD. Das passiert typischerweise, wenn ein aufrufendes
// Programm seine Eingabe in Windows-1252 verschickt: dort ist "ö" ein einzelnes
// Byte 0xF6, in UTF-8 sind es zwei.
//
// Der Schaden daran ist nicht der Fehler selbst, sondern dass er stillschweigend
// passiert: "Doppelgrößen" wurde zu "Doppelgr??en", stand so wochenlang in der
// Datenbank und fiel erst auf, als es jemand auf der Seite las. Zurueckrechnen
// laesst es sich dann nicht mehr — das Byte ist weg. Also lieber gleich
// ablehnen und den Aufrufer seine Kodierung richten lassen.

const ERSATZZEICHEN = '�';

/**
 * Sucht das Ersatzzeichen in einem beliebig verschachtelten Wert.
 * Liefert den Feldnamen des ersten Fundes oder null.
 */
function findeKaputtes(wert, pfad = '') {
  if (typeof wert === 'string') return wert.includes(ERSATZZEICHEN) ? pfad || 'Eingabe' : null;
  if (Array.isArray(wert)) {
    for (let i = 0; i < wert.length; i++) {
      const treffer = findeKaputtes(wert[i], `${pfad}[${i}]`);
      if (treffer) return treffer;
    }
    return null;
  }
  if (wert && typeof wert === 'object') {
    for (const [feld, inhalt] of Object.entries(wert)) {
      const treffer = findeKaputtes(inhalt, pfad ? `${pfad}.${feld}` : feld);
      if (treffer) return treffer;
    }
  }
  return null;
}

/** Middleware fuer die API: bricht mit einer verstaendlichen Meldung ab. */
function pruefeKodierung(req, res, next) {
  const feld = findeKaputtes(req.body);
  if (!feld) return next();

  res.status(400).json({
    fehler: `Das Feld "${feld}" enthält Zeichen, die kein gültiges UTF-8 sind.`,
    hinweis:
      'Vermutlich verschickt das aufrufende Programm Umlaute in Windows-1252. ' +
      'Entweder in UTF-8 senden oder Umlaute als \\u-Escape schreiben, z. B. "Gr\\u00f6\\u00dfe".',
  });
}

module.exports = { findeKaputtes, pruefeKodierung, ERSATZZEICHEN };
