// Prüft die Datenbank-Migrationen gegen schema.sql. Aufruf: node test/schema.mjs
//
// Der Kern in einem Satz: eine frisch aus schema.sql angelegte Datenbank darf
// sich nicht mehr verändern, wenn man alle Migrationen darauf loslässt.
//
// Daran hängen die beiden wichtigen Regeln aus docs/datenbank.md:
//
//   * Ändert sich etwas, fehlt der Schritt in schema.sql — dann hätte eine
//     Neuinstallation ein anderes Schema als eine gewachsene.
//   * Läuft es auf einen Fehler, ist die Migration nicht mehrfach ausführbar —
//     dann hinterlässt ein Abbruch einen halben Stand.
//
// Wer eine Migration hinzufügt und eines von beidem vergisst, merkt es hier.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const Database = require(path.join(WURZEL, 'node_modules', 'better-sqlite3'));
const migrationen = require(path.join(WURZEL, 'src', 'migrationen.js'));

const ordner = mkdtempSync(path.join(tmpdir(), 'jf-schema-test-'));
let fails = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`  ok   ${name}`);
  else {
    fails++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

/** Das vollständige Schema als vergleichbarer Text: Tabellen, Indizes, Spalten. */
function abbild(db) {
  const objekte = db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all()
    .map((o) => `${o.type} ${o.name}: ${(o.sql || '').replace(/\s+/g, ' ').trim()}`);

  const spalten = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .flatMap((t) =>
      db
        .prepare(`PRAGMA table_info(${t.name})`)
        .all()
        .map((s) => `${t.name}.${s.name} ${s.type} notnull=${s.notnull} default=${s.dflt_value}`)
    );

  return [...objekte, ...spalten].join('\n');
}

function frisch(name) {
  const db = new Database(path.join(ordner, name));
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(path.join(WURZEL, 'src', 'schema.sql'), 'utf8'));
  return db;
}

console.log('\n1) schema.sql und die Migrationen ergeben dasselbe');
const db = frisch('frisch.db');
const vorher = abbild(db);

let ergebnis;
try {
  ergebnis = migrationen.anwenden(db, 0); // ab 0: alles anwenden, nicht nur Offenes
} catch (err) {
  check('alle Migrationen laufen auf einer frischen Datenbank durch', false, err.message);
}

if (ergebnis) {
  check('alle Migrationen laufen ohne Fehler durch', true);
  check(
    `alle ${migrationen.NEUESTE} Schritte wurden angewendet`,
    ergebnis.schritte.length === migrationen.NEUESTE,
    `${ergebnis.schritte.length}`
  );

  const nachher = abbild(db);
  if (vorher !== nachher) {
    const nur = (a, b) => a.split('\n').filter((z) => !b.split('\n').includes(z));
    console.log('       nur nach den Migrationen:', nur(nachher, vorher).slice(0, 5));
    console.log('       nur in schema.sql:       ', nur(vorher, nachher).slice(0, 5));
  }
  check('das Schema hat sich dabei nicht verändert', vorher === nachher);
}

console.log('\n2) Mehrfach ausführbar');
const nachErstem = abbild(db);
migrationen.anwenden(db, 0);
migrationen.anwenden(db, 0);
check('dreimal angewendet ändert nichts mehr', abbild(db) === nachErstem);
check('die Fassung bleibt bei der neuesten', migrationen.stand(db) === migrationen.NEUESTE, String(migrationen.stand(db)));
check(
  'jede Fassung steht genau einmal im Verlauf',
  migrationen.verlauf(db).length === migrationen.NEUESTE,
  String(migrationen.verlauf(db).length)
);

console.log('\n3) Eine Datenbank ohne Versionstabelle');
// So sieht eine Installation aus, die vor der Zählung angelegt wurde.
const alt = frisch('alt.db');
alt.exec('DROP TABLE schema_version');
check('ohne Tabelle gilt sie als Fassung 0', migrationen.stand(alt) === 0, String(migrationen.stand(alt)));
const gehoben = migrationen.anwenden(alt);
check('sie wird auf die neueste Fassung gehoben', gehoben.nachher === migrationen.NEUESTE, String(gehoben.nachher));
check('und dabei alle Schritte angewendet', gehoben.schritte.length === migrationen.NEUESTE);

console.log('\n4) Eine Datenbank aus der Zukunft');
const zukunft = frisch('zukunft.db');
zukunft
  .prepare('INSERT INTO schema_version (version, name) VALUES (?, ?)')
  .run(migrationen.NEUESTE + 5, 'Aus der Zukunft');
const warnung = migrationen.anwenden(zukunft);
check('wird als zu neu erkannt', warnung.zuNeu === true);
check('und nichts daran verändert', warnung.schritte.length === 0);
check('die Fassung bleibt stehen', migrationen.stand(zukunft) === migrationen.NEUESTE + 5);

console.log('\n5) Reihenfolge und Eindeutigkeit der Liste');
const nummern = migrationen.MIGRATIONEN.map((m) => m.version);
check('aufsteigend nummeriert', nummern.every((n, i) => i === 0 || n > nummern[i - 1]), nummern.join(','));
check('lückenlos ab 1', nummern.every((n, i) => n === i + 1), nummern.join(','));
check('jede hat einen Namen', migrationen.MIGRATIONEN.every((m) => m.name && m.name.length > 2));
check('jede sagt, ob sie verträglich ist', migrationen.MIGRATIONEN.every((m) => typeof m.vertraeglich === 'boolean'));

console.log('\n6) Die Sicherungstabellen kennen jede Tabelle');
// Eine neue Tabelle, die niemand in restore.js einträgt, fehlt in jeder
// Wiederherstellung — und das fällt erst auf, wenn man sie braucht.
const restoreQuelle = readFileSync(path.join(WURZEL, 'src', 'restore.js'), 'utf8');
const gelistet = new Set((restoreQuelle.match(/^\s*'(\w+)',$/gm) || []).map((z) => z.trim().replace(/[',]/g, '')));
const AUSGENOMMEN = new Set(['sessions', 'schema_version']); // bewusst nicht kopiert
const tabellen = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((t) => t.name)
  .filter((t) => !AUSGENOMMEN.has(t));
const fehlend = tabellen.filter((t) => !gelistet.has(t));
check('jede Tabelle steht in restore.js', fehlend.length === 0, fehlend.join(', '));

db.close();
alt.close();
zukunft.close();
try {
  rmSync(ordner, { recursive: true, force: true });
} catch {
  /* Windows haelt die Datei manchmal noch kurz */
}

console.log(fails === 0 ? '\nAlles grün.\n' : `\n${fails} Fehler.\n`);
process.exit(fails ? 1 : 0);
