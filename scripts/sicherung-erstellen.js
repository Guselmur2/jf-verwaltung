#!/usr/bin/env node
'use strict';

// Erzeugt eine verschluesselte Sicherung der Datenbank in einem Zielordner.
// Gedacht fuer die naechtliche Sicherung (scripts/sicherung-automatisch.sh),
// laeuft aber auch von Hand:
//
//   printf '%s\n' "passwort" | node scripts/sicherung-erstellen.js /mnt/jf-sicherung
//
// Das Passwort kommt ueber die Standardeingabe und nicht als Aufrufparameter —
// sonst stuende es fuer jeden sichtbar in der Prozessliste.
//
// Wichtig: dieses Skript gehoert unter dem Benutzer gestartet, unter dem auch
// der Dienst laeuft. Als root wuerden die Begleitdateien der Datenbank (-wal,
// -shm) root gehoeren und der Dienst koennte anschliessend nicht mehr schreiben.

const fs = require('fs');
const path = require('path');

const ziel = process.argv[2];
if (!ziel) {
  console.error('Aufruf: sicherung-erstellen.js <zielordner>   (Passwort ueber die Standardeingabe)');
  process.exit(2);
}

let passwort = '';
try {
  passwort = fs.readFileSync(0, 'utf8').split('\n')[0].trim();
} catch {
  /* nichts angekommen — die Pruefung unten meldet es */
}

const backup = require('../src/backup');

const fehler = backup.passwortPruefen(passwort);
if (fehler) {
  console.error(fehler);
  process.exit(2);
}

(async () => {
  const s = await backup.erstellen(passwort);
  const zieldatei = path.join(ziel, s.name);
  // Kopieren statt Verschieben: das Ziel liegt auf einem anderen Datentraeger.
  fs.copyFileSync(s.pfad, zieldatei);
  backup.aufraeumen(s.ordner);
  process.stdout.write(JSON.stringify({ datei: s.name, groesse: fs.statSync(zieldatei).size }) + '\n');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
