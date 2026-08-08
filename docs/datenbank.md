# Datenbank und Schema-Fassungen

Wie die Datenbank von einer Fassung zur nächsten kommt, und warum es diese
Zählung gibt, obwohl sich am Schema noch nichts geändert hat.

## Wozu die Fassungsnummer

Beim Zurückspielen einer Sicherung übernimmt die Software nur Spalten, die es
in **beiden** Datenbanken gibt. Für eine *ältere* Sicherung ist das unkritisch:
sie wächst in das neuere Schema hinein, fehlende Spalten bleiben leer und werden
nachgetragen.

Kritisch ist die Gegenrichtung: eine *neuere* Sicherung in einer älteren
Installation. Dabei würden die Spalten wegfallen, die die ältere Software noch
nicht kennt — ohne Fehler und ohne Meldung. Aufgefallen wäre das erst, wenn die
Daten gebraucht werden. Die Fassungsnummer macht diesen Fall erkennbar: die
Software vergleicht sie vor dem Einspielen und lehnt eine neuere Sicherung ab.

Die Nummer deckt noch einen zweiten Fall ab. Geht eine Aktualisierung schief,
setzt der Helfer den **Code** zurück, die **Datenbank** aber nicht. Wurde dabei
schon migriert, läuft danach alte Software auf einem neueren Bestand. Solange
alle Migrationen nur Spalten *hinzufügen*, ist das unkritisch — die alte
Software ignoriert, was sie nicht kennt. Sobald eine Migration etwas *umbaut*,
gilt das nicht mehr, und dann soll es zumindest auffallen: die Software zeigt
in diesem Fall auf jeder Seite eine Warnung.

## Wie es funktioniert

Die Fassung steht in der Tabelle `schema_version` — als Liste, nicht als
einzelne Zahl:

| version | name | angewendet |
|---|---|---|
| 1 | Ausgangsstand | 2026-08-08 21:14:02 |

Die aktuelle Fassung ist das Maximum. Die Liste sagt zusätzlich, **wann** welcher
Schritt gelaufen ist — bei einer Fehlersuche ist das die erste Frage.

Die Schritte selbst stehen in [`src/migrationen.js`](../src/migrationen.js).
Beim Start wendet die Software alles an, was der Datenbank noch fehlt.

### Drei Wege, dieselbe Stelle

| Fall | Was passiert |
|---|---|
| Frische Datenbank | `schema.sql` legt das **vollständige, aktuelle** Schema an. Danach laufen alle Migrationen — und tun nichts, weil schon alles da ist. Gestempelt wird die neueste Fassung. |
| Vorhandene Datenbank | Beim Start laufen die Migrationen, die fehlen. |
| Eingespielte Sicherung | Die Fassung der Sicherung wird **vor** dem Kopieren gelesen. Danach wird ab dieser Fassung **einschließlich** neu angewendet. |

Beim dritten Fall ist das „einschließlich" wichtig: bei einer Sicherung der
Fassung 3 läuft Schritt 3 noch einmal, nicht erst Schritt 4. Die kopierten
Zeilen stammen aus der Sicherung, und was Fassung 3 zusichert, muss auch für
sie gelten. Beispiel QR-Token: eine alte Sicherung bringt Spinte ohne Token
mit — die Spalte existiert, ist aber leer. Erst das erneute Anwenden des
Schritts trägt die Token nach. Das setzt voraus, dass jede Migration mehrfach
ausführbar ist (Regel 1).

## Regeln für neue Migrationen

**1. Mehrfach ausführbar.** Jede Migration muss ohne Schaden zweimal laufen
können — `CREATE ... IF NOT EXISTS`, vorher `hatSpalte(...)` fragen, `INSERT OR
IGNORE`. Das ersetzt die Atomarität: bricht eine Migration in der Mitte ab,
hilft ein zweiter Lauf, statt einen halben Stand zu hinterlassen.

**2. Was eine Migration anlegt, gehört gleichzeitig in `schema.sql`.** Frische
Datenbanken entstehen aus `schema.sql`, nicht aus der Migrationskette. Beides
muss dasselbe ergeben, sonst hat eine Neuinstallation ein anderes Schema als
eine über Migrationen gewachsene Installation.

**3. Neue Nummer nur anhängen, nie eine bestehende ändern.** Es laufen bereits
Datenbanken, die die alte Nummer gespeichert haben. Wird Schritt 3 nachträglich
umgeschrieben, wenden diese Datenbanken ihn nicht erneut an — für sie gilt 3
als erledigt.

**4. Hinzufügen statt umbauen.** Eine zusätzliche Spalte ist
rückwärtsverträglich, ein Umbenennen nicht. Lässt sich ein Umbau nicht
vermeiden: `vertraeglich: false` setzen und hier dokumentieren. Ein
zurückgenommenes Update braucht dann eine Sicherung.

### Der Test, der das absichert

`node test/schema.mjs` legt eine Datenbank frisch aus `schema.sql` an, notiert
ihr Schema, wendet **alle** Migrationen darauf an und vergleicht.

Es darf sich nichts ändern. Damit hängen die beiden Regeln 1 und 2 an einer
einzigen Prüfung:

* Ändert sich etwas, fehlt der Schritt in `schema.sql` (Regel 2 verletzt).
* Läuft es auf einen Fehler, ist die Migration nicht mehrfach ausführbar
  (Regel 1 verletzt).

Wer eine Migration hinzufügt und eines von beidem vergisst, merkt es beim
nächsten `npm test`.

## Eine Migration hinzufügen

In `src/migrationen.js` ans Ende der Liste:

```js
{
  version: 2,
  name: 'Notfallnummer je Mitglied',
  vertraeglich: true,
  hoch(db) {
    if (!hatSpalte(db, 'members', 'notfall')) {
      db.exec('ALTER TABLE members ADD COLUMN notfall TEXT');
    }
  },
},
```

Dazu:

1. Dieselbe Spalte in `src/schema.sql` eintragen.
2. Falls die Sicherung sie mitnehmen soll: nichts tun — `restore.js` kopiert
   alle gemeinsamen Spalten der Tabellen aus seiner Liste.
3. Bei einer **neuen Tabelle**: in `src/restore.js` in `TABELLEN` aufnehmen,
   sonst fehlt sie in jeder Wiederherstellung. Die Reihenfolge zählt —
   Tabellen, auf die verwiesen wird, stehen vorn.
4. `npm test` und `node test/schema.mjs`.
5. Hier in der Liste unten eintragen.

## Was passiert, wenn die Fassungen nicht passen

| Lage | Verhalten |
|---|---|
| Sicherung **älter** als die Software | Wird eingespielt und gehoben. Die Meldung nennt die Fassungen. |
| Sicherung **neuer** als die Software | Wird **abgelehnt**, mit dem Hinweis, erst die Software zu aktualisieren. |
| Datenbank **neuer** als die Software | Die Software startet trotzdem, damit sie am Übungsabend benutzbar bleibt. Auf jeder Seite und im Protokoll steht aber eine Warnung. |

Der letzte Fall tritt praktisch nur nach einem zurückgenommenen Update auf. Der
Weg heraus: entweder wieder aktualisieren, oder die Sicherung einspielen, die
der Update-Helfer **vor** dem Versuch gezogen hat.

## Wo die Fassung überall auftaucht

* In der Datenbank, Tabelle `schema_version`.
* Im **Dateinamen** jeder Sicherung: `spinte-2026-08-08-2012-s1.db.enc`. So
  lässt sich ohne Passwort erkennen, welche Datei zu welchem Softwarestand
  gehört.
* In der API unter `GET /api/v1/status` als `schema_fassung`.
* Im Kopf dieser Seite, neben dem Stand der Software.

## Fassungen

| Fassung | Name | Verträglich | Was dazukam |
|---|---|---|---|
| 1 | Ausgangsstand | ja | Alles, was vor der Zählung entstanden ist: Geschlecht am Mitglied, Umkleidebereiche am Spint, Lagerorte an der Ausrüstung, Größenschemata und Barcode-Präfix an den Arten, Standard-Lagerort, QR-Token für Spinte und Lagerorte, eindeutige Inventarnummern. Sicherungen ohne Fassungsnummer gelten als Fassung 1. |
