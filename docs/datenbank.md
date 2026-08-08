# Datenbank und Schema-Fassungen

Wie die Datenbank von einer Fassung zur nächsten kommt — und warum es diese
Zählung gibt, obwohl sich am Schema noch nichts geändert hat.

## Warum überhaupt

Beim Zurückspielen übernimmt die Software nur Spalten, die es in **beiden**
Datenbanken gibt. Das hat eine angenehme Folge und eine unangenehme.

**Angenehm:** eine *ältere* Sicherung wächst von selbst in ein neueres Schema
hinein. Was sie nicht kennt, bleibt leer und wird nachgetragen. Diese Richtung
war nie das Problem.

**Unangenehm:** eine *neuere* Sicherung in eine ältere Installation. Dann fallen
die unbekannten Spalten stillschweigend weg. Kein Fehler, keine Meldung — die
Daten sind einfach nicht da. Das merkt man Wochen später.

Genau dafür ist die Nummer da. Sie beantwortet die Frage, die sich sonst nicht
beantworten lässt: *ist diese Sicherung neuer als ich?*

Dieselbe Nummer klärt einen zweiten Fall. Geht eine Aktualisierung schief, setzt
der Helfer den **Code** zurück — die **Datenbank** aber nicht. Wurde dabei schon
migriert, läuft alte Software auf einem neueren Bestand. Solange alle
Migrationen nur *hinzufügen*, ist das harmlos: die alte Software ignoriert, was
sie nicht kennt. Sobald eine Migration etwas *umbaut*, ist es das nicht mehr —
und dann muss man es wenigstens merken.

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

Der dritte Fall ist der feine. „Einschließlich" heißt: bei einer Sicherung der
Fassung 3 läuft Schritt 3 noch einmal, nicht erst Schritt 4. Grund: die eben
kopierten Zeilen stammen aus der Sicherung, und was Fassung 3 zusichert, muss
für sie auch wirklich gelten. Ein Beispiel aus der Vergangenheit: die QR-Token.
Eine alte Sicherung bringt Spinte ohne Token mit — die Spalte gibt es, sie ist
nur leer. Erst das erneute Anwenden trägt sie nach.

Möglich ist das nur, weil jede Migration mehrfach ausführbar sein muss.

## Regeln für neue Migrationen

Vier Stück. Sie tragen den ganzen Bau:

**1. Mehrfach ausführbar.** Jede Migration muss ohne Schaden zweimal laufen
können — `CREATE ... IF NOT EXISTS`, vorher `hatSpalte(...)` fragen, `INSERT OR
IGNORE`. Das ersetzt die Atomarität: bricht eine Migration in der Mitte ab,
hilft ein zweiter Lauf, statt einen halben Stand zu hinterlassen.

**2. Was eine Migration anlegt, gehört gleichzeitig in `schema.sql`.** Frische
Datenbanken entstehen aus `schema.sql`, nicht aus der Migrationskette. Beides
muss dasselbe ergeben — sonst hat eine Neuinstallation ein anderes Schema als
eine gewachsene, und das findet niemand.

**3. Neue Nummer nur anhängen, nie eine bestehende ändern.** Draußen laufen
Datenbanken, die die alte Nummer schon gespeichert haben. Wer 3 nachträglich
umschreibt, ändert nichts an ihnen — sie halten 3 für erledigt.

**4. Bauen statt umbauen.** Eine zusätzliche Spalte ist rückwärtsverträglich,
ein Umbenennen nicht. Wo es sich nicht vermeiden lässt: `vertraeglich: false`
setzen, hier aufschreiben warum — und wissen, dass ein zurückgenommenes Update
dann eine Sicherung braucht.

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
| Sicherung **neuer** als die Software | Wird **abgelehnt**. „Bitte erst die Software aktualisieren, dann erneut einspielen." Lieber gar nicht als halb. |
| Datenbank **neuer** als die Software | Die Software startet trotzdem — an einem Übungsabend hilft es niemandem, wenn gar nichts mehr geht. Aber auf jeder Seite steht eine Warnung, und im Protokoll steht sie auch. |

Der letzte Fall tritt praktisch nur nach einem zurückgenommenen Update auf. Der
Weg heraus: entweder wieder aktualisieren, oder die Sicherung einspielen, die
der Update-Helfer **vor** dem Versuch gezogen hat.

## Wo die Fassung überall auftaucht

* In der Datenbank, Tabelle `schema_version`.
* Im **Dateinamen** jeder Sicherung: `spinte-2026-08-08-2012-s1.db.enc`. So
  sieht man vor einem Stick voller Dateien, welche zu welchem Stand gehört —
  ohne Passwort, ohne Entschlüsseln.
* In der API unter `GET /api/v1/status` als `schema_fassung`.
* Im Kopf dieser Seite, neben dem Stand der Software.

## Fassungen

| Fassung | Name | Verträglich | Was dazukam |
|---|---|---|---|
| 1 | Ausgangsstand | ja | Alles, was vor der Zählung gewachsen ist: Geschlecht am Mitglied, Umkleidebereiche am Spint, Lagerorte an der Ausrüstung, Größenschemata und Barcode-Präfix an den Arten, Standard-Lagerort, QR-Token für Spinte und Lagerorte, eindeutige Inventarnummern. Sicherungen von vor der Zählung gelten als Fassung 1 — genau das war der Stand, als sie begann. |
