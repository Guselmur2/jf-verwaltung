'use strict';

// Legt einen kleinen Testbestand an, um die Software auszuprobieren —
// insbesondere den Barcode-Scan am Handy.
//
//   DATA_DIR=data-test node scripts/testdaten.js
//
// Schreibt nur in eine leere Datenbank. Mit --force wird ein vorhandener
// Bestand vorher komplett geloescht.

process.env.DATA_DIR = process.env.DATA_DIR || require('path').join(__dirname, '..', 'data-test');

const { db, init, DB_FILE } = require('../src/db');

init();

const auth = require('../src/auth');
const force = process.argv.includes('--force');

if (auth.hasUsers() && !force) {
  console.error(`In ${DB_FILE} stehen schon Daten.`);
  console.error('Mit --force wird der Bestand geloescht und neu aufgebaut.');
  process.exit(1);
}

if (force) {
  db.exec(`
    DELETE FROM tasks; DELETE FROM equipment; DELETE FROM lockers; DELETE FROM storages;
    DELETE FROM gender_area; DELETE FROM areas; DELETE FROM members; DELETE FROM users;
    DELETE FROM audit_log; DELETE FROM sessions;
  `);
}

const BENUTZER = { name: 'Test Jugendwart', username: 'test', password: 'test1234' };

const typ = {};
for (const t of db.prepare('SELECT id, name FROM equipment_types').all()) typ[t.name] = t.id;

db.transaction(() => {
  auth.createUser({ ...BENUTZER, role: 'jugendwart' });

  const area = db.prepare("INSERT INTO areas (name, numbering, sort_order) VALUES ('Umkleide', 'eigen', 100)").run()
    .lastInsertRowid;
  db.prepare("INSERT INTO gender_area (gender, area_id) VALUES ('m', ?)").run(area);

  const mitglied = db.prepare('INSERT INTO members (name, birthday, gender) VALUES (?, ?, ?)');
  const max = mitglied.run('Max Meier', '2016-05-05', 'm').lastInsertRowid;
  const tom = mitglied.run('Tom Klein', '2015-03-12', 'm').lastInsertRowid;
  mitglied.run('Jonas Weber', '2014-09-01', 'm');

  const spint = db.prepare('INSERT INTO lockers (code, area_id, member_id, location) VALUES (?, ?, ?, ?)');
  const s1 = spint.run('01', area, max, 'Umkleide links').lastInsertRowid;
  const s2 = spint.run('02', area, tom, 'Umkleide links').lastInsertRowid;
  spint.run('03', area, null, 'Umkleide rechts');

  const lager = db.prepare('INSERT INTO storages (name, location, sort_order) VALUES (?, ?, ?)');
  const schrank = lager.run('Schrank 1', 'Gerätehaus, Raum 2', 100).lastInsertRowid;
  const regal = lager.run('Regal Schuhe', 'Keller', 110).lastInsertRowid;

  const teil = db.prepare(
    `INSERT INTO equipment (type_id, size, inventory_no, condition, locker_id, storage_id)
     VALUES (@type_id, @size, @inventory_no, @condition, @locker_id, @storage_id)`
  );
  const inSpint = (type, size, nr, locker, condition = 'gut') =>
    teil.run({ type_id: typ[type], size, inventory_no: nr, condition, locker_id: locker, storage_id: null });
  const imLager = (type, size, nr, storage, anzahl = 1, condition = 'gut') => {
    for (let i = 0; i < anzahl; i++) {
      teil.run({ type_id: typ[type], size, inventory_no: nr, condition, locker_id: null, storage_id: storage });
    }
  };

  // Spint 01 — Max Meier. Die Hose traegt die Nummer vom Foto des Etiketts,
  // damit sich der Scan am echten Kleidungsstueck ausprobieren laesst.
  inSpint('Hose', '170', '112000172', s1);
  inSpint('Jacke', '164', '112000171', s1);
  inSpint('Helm', null, 'HE-0042', s1);
  inSpint('Handschuhe', '7', null, s1);
  inSpint('Schuhe', '36', 'SC-0100', s1, 'defekt');

  // Spint 02 — Tom Klein
  inSpint('Jacke', '152', '112000180', s2);
  inSpint('Hose', '152', '112000181', s2);

  // Lager: Sammelposten ohne Nummern (bekommen ihre Nummer beim Ausgeben)
  // und einzelne Stuecke mit Nummer.
  imLager('Jacke', '170', null, schrank, 4);
  imLager('Jacke', '176', null, schrank, 6);
  imLager('Hose', '176', null, schrank, 5);
  imLager('Hose', '176', '112000250', schrank);
  imLager('Handschuhe', '8', null, schrank, 4);
  imLager('Schuhe', '38', null, regal, 12);
  imLager('Schuhe', '40', null, regal, 8);
  imLager('Schuhe', '37', 'SC-0200', regal);

  // Eine offene Aufgabe, damit der Tab nicht leer ist.
  db.prepare(
    `INSERT INTO tasks (kind, type_id, to_size, reason, note, created_by)
     VALUES ('bestellung', @type_id, '42', 'sonstiges', '5 Paar Stiefel Gr. 42 nachbestellen', 'Test Jugendwart')`
  ).run({ type_id: typ['Schuhe'] });
})();

const zahl = (sql) => db.prepare(sql).get().n;
console.log(`Testdaten in ${DB_FILE}`);
console.log(`  Mitglieder: ${zahl('SELECT COUNT(*) AS n FROM members')}`);
console.log(`  Spinte:     ${zahl('SELECT COUNT(*) AS n FROM lockers')}`);
console.log(`  Lagerorte:  ${zahl('SELECT COUNT(*) AS n FROM storages')}`);
console.log(`  Teile:      ${zahl('SELECT COUNT(*) AS n FROM equipment')}`);
console.log('');
console.log(`Anmeldung: ${BENUTZER.username} / ${BENUTZER.password}`);
console.log('Barcode zum Ausprobieren: 112000172 (Hose Gr. 170, Spint 01)');
