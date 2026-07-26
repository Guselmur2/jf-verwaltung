'use strict';

const crypto = require('crypto');

// Alphabet ohne i, l, o, 0, 1 — die verwechselt man beim Abtippen. Auf dem
// Etikett steht die Adresse im Klartext unter dem QR-Code, damit man sie im
// Notfall eingeben kann.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LAENGE = 12;

/**
 * Unerratbares Geheimnis fuer einen QR-Link. 12 Zeichen aus 31 moeglichen sind
 * rund 59 Bit — durchprobieren ist damit ausgeschlossen.
 */
function neuerToken(laenge = LAENGE) {
  let out = '';
  for (let i = 0; i < laenge; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** Form eines Tokens pruefen, bevor damit die Datenbank befragt wird. */
function istToken(wert) {
  return typeof wert === 'string' && new RegExp(`^[${ALPHABET}]{8,32}$`).test(wert);
}

module.exports = { neuerToken, istToken, ALPHABET };
