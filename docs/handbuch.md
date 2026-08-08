# JF-Verwaltung — Handbuch

Dieses Handbuch führt dich Schritt für Schritt durch die Software. Alles zur Einrichtung (Installation auf dem Pi, Updates etc.) findest du im [README](../README.md).

> **Hinweis zu den Screenshots:** Alle Namen, Größen und Angaben auf den Bildern sind frei erfunden. Sie stammen aus einem Demobestand, den wir über [`scripts/doku-daten.js`](../scripts/doku-daten.js) erzeugen — echte Kinderdaten haben in einem öffentlichen Repository nichts zu suchen. Wie du die Bilder neu erzeugst, erfährst du [am Ende dieser Seite](#bilder-neu-aufnehmen).

## Inhalt

- [Anmeldung und Übersicht](#anmeldung-und-übersicht)
- [Der Übungsabend](#der-übungsabend) — Anwesenheit, Einschätzung, Einteilung
- [Spinte und Ausrüstung](#spinte-und-ausrüstung)
- [Das Lager](#das-lager)
- [Drucken: QR-Codes und Etiketten](#drucken-qr-codes-und-etiketten)
- [Mitglieder](#mitglieder)
- [Am Handy](#am-handy)
- [Verwaltung](#verwaltung) — Stammdaten, Betreuer, Sicherung, Updates
- [Dieses Handbuch in der Software](#dieses-handbuch-in-der-software)
- [Bilder neu aufnehmen](#bilder-neu-aufnehmen)

---

## Anmeldung und Übersicht

Ohne Anmeldung bleibt das System gesperrt. Einzige Ausnahme: Die Seite, deren QR-Code du direkt gescannt hast.

![Anmeldung](bilder/anmeldung.png)

Nach dem Login landest du auf der Übersicht. Hier siehst du für jeden Spint eine Kachel, geordnet nach Umkleidebereich. Auf jeder Kachel steht der aktuelle Inhalt (z. B. Jacke 158, Hose 158, Helm, Handschuhe 8, Schuhe 39). Freie Spinte sind blasser dargestellt. Ganz oben findest du die Gesamtzahlen — sobald ein Teil defekt ist, wird die entsprechende Zahl rot hervorgehoben.

![Übersicht aller Spinte](bilder/uebersicht.png)

Die Navigation fasst einige Punkte in Untermenüs zusammen, damit die Leiste auf Smartphones übersichtlich bleibt:
* **Dienst:** Alles, was du direkt am Übungsabend brauchst.
* **Ausrüstung:** Die Verwaltung von Spinten und Material. Die kleine Zahl daneben zeigt dir die offenen Aufgaben an.

![Menü „Dienst"](bilder/navigation-dienst.png)

---

## Der Übungsabend

### Anwesenheit erfassen

Hier reicht ein einfacher Tipp auf das jeweilige Kind – ganz ohne Speichern-Knopf. Jedes Antippen schaltet einen Status weiter:
**da → entschuldigt → fehlt → offen**.

![Anwesenheitsliste](bilder/anwesenheit.png)

**Tipps für die Praxis:**
* **Der schnellste Weg:** Zuerst oben auf **„alle da“** tippen und anschließend nur die wenigen Kinder anpassen, die fehlen oder entschuldigt sind.
* **Gleichzeitig erfassen:** Mehrere Betreuer können die Liste parallel auf ihren Handys nutzen. Die Seite synchronisiert sich alle 15 Sekunden. Wenn du ein Kind angetippt hast, wird direkt der gewählte Status übertragen (nicht bloß ein „einen Schritt weiter“). So überschreibst du nicht versehentlich die Eingabe eines Kollegen, falls deine Ansicht noch nicht aktualisiert war.

*Hinweis zu „Offen“:* Das bedeutet lediglich, dass für das Kind heute noch nichts eingetragen wurde. Das ist nicht mit „fehlt“ gleichzusetzen.

### Anwesenheitsquote

Hier siehst du die Beteiligungsquote einzelner Kinder über das gesamte Jahr hinweg sowie die Gesamtzahl der Anwesenden pro Übungsabend.

![Anwesenheit über die Zeit](bilder/anwesenheit-quoten.png)

### Einschätzung

Diese Seite dient als Grundlage für die spätere Einteilung. Wenn du sie aufrufst, bleiben die Noten zunächst verdeckt:

![Einschätzung, zugeklappt](bilder/einschaetzung.png)

Erst nach einem Klick werden die Werte sichtbar. Das verhindert, dass Jugendliche neugierige Blicke auf die Noten werfen, wenn sie neben dem Handy stehen.

![Einschätzung, geöffnet](bilder/einschaetzung-offen.png)

Die Bewertung erfolgt auf einer Skala von 1 bis 5 in drei Bereichen:

| Bereich | Frage |
|---|---|
| **Erfahrung** | Wie viel Vorwissen und Können bringt das Kind mit? |
| **Zupacken** | Wie klappt es praktisch/körperlich (Schläuche, Leitern etc.)? |
| **Anleiten** | Übernimmt das Kind Verantwortung, hilft es anderen und bleibt ruhig? |

Eine Gesamtnote gibt es bewusst nicht, um starre Ranglisten zu vermeiden. Ein Kind mit den Werten 5/2/4 ist nicht „besser“ als eines mit 2/5/3 – es setzt nur andere Schwerpunkte. Die Werte sind privat: Sie tauchen weder auf den QR-Seiten am Spint noch in der API auf. Standardmäßig steht alles auf 3.

Ein Klick auf die Zahl übernimmt den Wert direkt – ein Speichern ist nicht nötig.

### Wer kann welche Funktion?

Führungsfunktionen erfordern Praxis. Damit nicht immer dieselben zwei Jugendlichen als Gruppenführer eingeteilt werden, gibt es die Zwischenstufe **`übt`** („soll das lernen“). 

![Eignung und „Nicht zusammen"](bilder/einschaetzung-eignung.png)

Darunter findest du das Feld **„Nicht zusammen“**: Hier kannst du Paare festlegen, die nicht im selben Trupp oder derselben Einheit eingesetzt werden sollen. Die automatische Einteilung berücksichtigt das, solange es mathematisch möglich ist, und gibt eine Warnung aus, wenn es nicht klappt.

### Einteilung vorschlagen

Aus den heute anwesenden Kindern baut die Software automatisch Einheiten nach FwDV 3 auf: **Gruppe** (9 Personen), **Staffel** (6 Personen), **Trupp** (3 Personen) oder eine **freie Einteilung** ohne feste Funktionen.

![Einteilung mit Funktionen](bilder/einteilung.png)

Es kommen die gewohnten Kürzel zum Einsatz: **GF** (Gruppenführer), **MA** (Maschinist), **Me** (Melder), **AF/AM** (Angriffstrupp), **WF/WM** (Wassertrupp), **SF/SM** (Schlauchtrupp).

* **Rotation:** Kinder mit dem Status `übt` werden bevorzugt eingeteilt, wenn erfahrene Kinder die Rolle beim letzten Mal schon innehatten. Neue Funktionen werden mit `neu` markiert.
* **Maschinist:** Gilt hier nicht als echte Führungsfunktion, da die Betreuer fahren und die Pumpe bedienen. Der Posten eignet sich ideal für Schnupperkinder (1-zu-1-Betreuung).

**Speichern & Synchronisation:**
Eine neue Einteilung entsteht erst, wenn du aktiv auf den Knopf drückst. Das verhindert, dass sich der Vorschlag plötzlich ändert, während du ihn gerade vorliest. Erst nach dem Speichern fließt die Einteilung in die Historie für das nächste Mal ein.

Jedes Gerät arbeitet zunächst unabhängig: Wenn zwei Betreuer gleichzeitig würfeln, sieht jeder seinen eigenen Vorschlag. Speichert der erste Betreuer ab, erkennt die Software beim zweiten Versuch den Konflikt und bietet beide Einteilungen nebeneinander zum Vergleich an, statt etwas zu überschreiben.

---

## Spinte und Ausrüstung

### Einen Spint bearbeiten

Hier siehst du, wer den Spint nutzt, was aktuell darin liegt und was noch fehlt.

![Spint bearbeiten](bilder/spint-bearbeiten.png)

Beim Eintragen neuer Teile zeigt das Menü oben an, was laut Soll-Ausstattung noch fehlt, und unten das, was bereits vorhanden ist. So verhinderst du doppelte Einträge.

### Der QR-Code am Spint

Der Aufkleber an der Spinttür führt direkt auf eine vereinfachte Übersichtsseite. Sie ist ohne Login aufrufbar, damit auch Kinder und Eltern sie nutzen können.

![Spint-Seite ohne Anmeldung](bilder/spint-qr-anonym.png)

Aus Datenschutzgründen zeigt diese Seite ausschließlich den Spintinhalt des jeweiligen Kindes – ohne Navigation oder Links zu anderen Daten. Die URL nutzt einen zufälligen Token (z. B. `/s/t8exz96cepde`), damit niemand durch Durchprobieren von Nummern an fremde Daten gelangt.

Lagerorte funktionieren nach demselben Prinzip:

![Lagerort-Seite ohne Anmeldung](bilder/lagerort-qr-anonym.png)

### Kleidung tauschen und bestellen

Ist ein Kind aus seiner Jacke oder Hose herausgewachsen, klickst du auf **Tauschen**:

![Tauschen](bilder/tauschen.png)

Das System prüft automatisch das Lager. Ist eine passende Größe vorrätig, wird das Teil getauscht und der Lagerort angezeigt. Ist nichts da, erstellt die Software automatisch eine **Bestellung**. Aus Sicherheitsgründen musst du den Tausch noch einmal bestätigen.

### Aufgabenliste

Hier laufen alle offenen Tauschaufträge und Nachbestellungen zusammen. Offene Bestellungen werden auch direkt am Spint angezeigt, damit nichts doppelt geordert wird.

![Aufgaben](bilder/aufgaben.png)

Sollte ein verloren geglaubtes Teil wieder auftauchen, klickst du auf **„Doch gefunden“**. Das storniert die Nachbestellung und legt das Teil direkt wieder in den Spint zurück.

### Suche

Das Suchfeld verarbeitet alles: Namen, Spintnummern, Größen oder Inventarnummern. Bei mehreren Begriffen wird die Suche kombiniert.

![Suche](bilder/suche.png)

### Ausgemustertes Material

Alte oder defekte Teile werden nicht gelöscht. Sie bleiben im Archiv einsehbar und können bei Bedarf wieder aktiviert werden.

![Ausgemustert](bilder/ausgemustert.png)

---

## Das Lager

### Material einbuchen

Für das Einbuchen gibt es zwei Wege:
* **Sammelposten:** Mehrere identische Teile ohne Einzelnummer (z. B. 6 Paar Handschuhe Größe 8).
* **Einzelteil:** Gegenstände mit eigener Inventarnummer (auch per Barcode-Scanner).

![Lager](bilder/lager.png)

Tipp: Wenn du den Erstbestand komplett erfasst hast, kannst du bei den Lagerorten den **Erfassungsmodus ausschalten**. Dadurch rückt die Bestandsliste nach oben und das Eingabeformular nach unten.

### Lagerorte verwalten

Jeder Lagerort erhält einen eigenen QR-Code. Ein Ort kann als **Standard** markiert werden – dorthin wandern alle neu eingebuchten Teile automatisch, sofern nichts anderes angegeben ist.

![Lagerorte](bilder/lagerorte.png)

### Kleidungsarten und Größenreihen

Hier legst du Kategorien, Größenraster und die Präfixe für Barcodes fest.

![Arten und Größen](bilder/arten-groessen.png)

Die Größen orientieren sich an echten Etiketten: Dienstkleidung läuft primär nach Körpergröße (116–176 cm) und geht danach fließend in Konfektionsgrößen über (auf 176 folgt Größe 44, nicht 182). Handschuhe und Stiefel nutzen eigene Skalen. Tippst du eine abweichende Größe ein, hakt die Software zur Sicherheit nach.

---

## Drucken: QR-Codes und Etiketten

### QR-Aufkleber

Erzeugt Bogen mit kleinen Aufklebern für Spinte und Lagerorte.

![QR-Aufkleber](bilder/qr-aufkleber.png)

### Spint-Etiketten

Große Schilder für die Spinttür mit Feuerwehrname, Logo, Namen des Kindes, QR-Code und dem Schriftzug **JUGENDFEUERWEHR** (zur deutlichen Unterscheidung von der Kinderfeuerwehr).

![Spint-Etikett](bilder/etikett.png)

Über die Einstellung **Etiketten je Seite** bestimmst du die Größe. In der Regel passen zwei Etiketten ideal auf ein A4-Blatt. Die Schrift passt sich automatisch an, und lange Nachnamen werden sauber umbrochen.

![Etikettenbogen, zwei je Seite](bilder/etiketten-bogen.png)

**Wichtig für den Druck:**
Wähle im Druckdialog deines Browsers **„Tatsächliche Größe“ (100 %)** und aktiviere **„Hintergrundgrafiken“**, damit die roten Farbbalken mitgedruckt werden. Der Randabstand wird vom Etikett selbst eingehalten.

Die Adresse im QR-Code muss im lokalen Netz erreichbar sein (z. B. die IP-Adresse oder der Hostname des Raspberry Pi).

---

## Mitglieder

Hier verwaltest du Namen, Geburtsdaten, Telefonnummern und Notizen.

![Mitglieder](bilder/mitglieder.png)

**Praktisch:** Geburtsdaten kannst du abgekürzt eingeben (aus `5.5.16` wird automatisch `05.05.2016`). Das Geschlecht bestimmt den Umkleidebereich. Sobald du das erste Mitglied eines neuen Geschlechts anlegst, fragt dich das System einmalig nach der gewünschten Zuordnung der Umkleiden.

---

## Am Handy

Alle Funktionen lassen sich auf dem Smartphone bedienen – ideal für die Umkleide am Übungsabend.

| Anwesenheit | Spintansicht | Nach dem Scannen |
|---|---|---|
| ![Anwesenheit am Handy](bilder/handy-anwesenheit.png) | ![Spint am Handy](bilder/handy-spint.png) | ![QR-Seite am Handy](bilder/handy-spint-qr.png) |

Der Barcode-Scan nutzt die Kamera deines Handys. Da moderne Browser den Kamerazugriff nur über eine verschlüsselte Verbindung (**HTTPS**) erlauben, erstellt das Installationsskript (`install-pi.sh`) ein Zertifikat. Die einmalige Browser-Warnung wegen des selbstsignierten Zertifikats kannst du einfach bestätigen.

Auch der Darkmode deines Handys wird automatisch unterstützt:

![Übersicht in dunkler Darstellung](bilder/uebersicht-dunkel.png)

---

## Verwaltung

Diese Bereiche sind dem **Jugendwart** vorbehalten. Betreuer haben Zugriff auf Spinte, Ausrüstung und Mitglieder, aber nicht auf Benutzerrechte oder Systemeinstellungen. Der letzte aktive Jugendwart kann weder gelöscht noch gesperrt werden.

### Stammdaten

Hier hinterlegst du Feuerwehrname, Abteilung, Logo und die Zeiten des Übungsabends.

![Stammdaten](bilder/stammdaten.png)

Aus den Übungszeiten leitet die Software ein Schutzfenster ab (10 Minuten vor Beginn bis 45 Minuten nach Ende). In dieser Zeit warnt das System vor Server-Neustarts oder Updates, um den laufenden Dienst nicht zu stören.

Das Logo wird direkt in der Datenbank gespeichert. Dadurch ist es automatisch in jeder Datensicherung enthalten.

### Betreuerzugänge

![Betreuer verwalten](bilder/betreuer.png)

### Datensicherung

Eine Sicherung besteht aus einer einzigen Datei, die den kompletten Datenbestand enthält (Mitglieder, Ausrüstung, Protokolle, Logo etc.).

![Datensicherung](bilder/sicherung.png)

**Sicherheit:** Da die Datei sensible Daten von Jugendlichen enthält, wird sie **immer stark verschlüsselt** (AES-256-CBC via OpenSSL). Du kannst eine Sicherung im Notfall auch ohne die Software über die Kommandozeile entpacken:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in spinte-2026-08-08-2241-s2.db.enc -out spinte.db
```

Sicherungen lassen sich manuell herunterladen, nachts automatisch auf einen USB-Stick schreiben oder per Skript sichern.

### System, Updates und Herunterfahren

![Systemseite](bilder/system.png)

**Wichtig:** Bevor du dem Raspberry Pi den Strom ziehst, fahre ihn immer über den Button **Herunterfahren** herunter. Einfaches Steckerziehen kann die Speicherkarte beschädigen. Sobald die rote LED am Pi dauerhaft ruhig leuchtet, ist das Gerät sicher ausgeschaltet.

### Software aktualisieren

Klicke auf **Nach Updates suchen**, um im Repository nach neuen Versionen zu schauen. Dabei wird noch nichts verändert.

![Aktualisierung](bilder/update.png)

Mit **Jetzt aktualisieren** startet der Prozess: Das System erstellt eine Sicherung, lädt den neuen Stand herunter, aktualisiert Abhängigkeiten und startet den Dienst neu. Sollte dabei etwas schiefgehen, stellt ein Hintergrund-Wächter automatisch den vorherigen Zustand wieder her.

*(Details zum Ablauf findest du im [README](../README.md#updates-und-was-dabei-zu-beachten-ist)).*

### Sicherung wiederherstellen

Sollten Daten versehentlich gelöscht oder falsch eingelesen worden sein, kannst du hier alte Stände wieder einspielen.

![Sicherung einspielen](bilder/restore.png)

Das System zeigt dir Sicherungen vom USB-Stick sowie der internen Speicherkarte an; eigene Dateien kannst du hochladen. Bevor ein altes Backup eingespielt wird, sichert die Software den aktuellen Zustand als `...-vor-restore.db.enc`. So kannst du den Schritt im Zweifel rückgängig machen.

### Schema-Versionen

Jede Sicherung enthält die genaue Version der Datenbankstruktur — im Dateinamen (das `-s2` in `spinte-2026-08-08-2241-s2.db.enc`) und in der Datei selbst. Vor einem Stick voller Sicherungen erkennst du damit ohne Passwort, welche zu welchem Softwarestand gehört. Beim Einspielen prüft das System:
* **Ältere Backups:** Werden eingespielt und automatisch auf den neuesten Stand gebracht.
* **Neuere Backups:** Werden abgelehnt. Aktualisiere in diesem Fall zuerst die Software, bevor du das Backup einspielst.

### API-Zugänge

Hier erstelle ich Tokens für externe Systeme. Der Token wird aus Sicherheitsgründen nur ein einziges Mal beim Anlegen im Klartext angezeigt; in der Datenbank wird lediglich ein Hash gespeichert.

![API-Zugänge](bilder/api-zugaenge.png)

### Änderungsverlauf

Das Protokoll zeigt lückenlos, wer wann welche Änderung vorgenommen hat – ideal, um nachzuvollziehen, wo verschwundenes Material geblieben ist.

![Änderungsverlauf](bilder/verlauf.png)

---

## Dieses Handbuch in der Software

Das Handbuch lässt sich auch direkt in der laufenden Anwendung unter *[Dein Name] → Handbuch* aufrufen. Es ist somit auch im Gerätehaus ohne Internetverbindung verfügbar und entspricht immer exakt deiner installierten Version.

![Handbuch in der Oberfläche](bilder/handbuch.png)

---

## Bilder neu aufnehmen

Die Screenshots im Handbuch lassen sich automatisiert neu erzeugen. Nach Änderungen an der Oberfläche führst du einfach folgende Befehle aus:

```bash
node scripts/doku-daten.js --force
node scripts/doku-bilder.js
```

Das erste Skript baut eine Demodatenbank in `data-doku/` auf (14 Kinder, 14 Spinte, 75 Ausrüstungsteile und beispielhafte Übungsabende). Das zweite Skript startet Chrome im Headless-Modus, steuert die Seiten an und speichert die Screenshots direkt in `docs/bilder/`.
