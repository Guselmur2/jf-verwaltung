# JF-Verwaltung — Handbuch

Dieses Handbuch beschreibt die Bedienung der Software, Seite für Seite. Die Einrichtung
(Installation, Pi, Updates) steht im [README](../README.md).

> **Alle Namen, Größen und Einschätzungen auf den Bildern sind erfunden.** Sie stammen aus
> einem Demo-Bestand, den [`scripts/doku-daten.js`](../scripts/doku-daten.js) erzeugt —
> in einem öffentlichen Repository haben Daten echter Kinder nichts zu suchen.
> Wie die Bilder entstehen, steht [am Ende](#bilder-neu-aufnehmen).

## Inhalt

- [Anmeldung und Übersicht](#anmeldung-und-übersicht)
- [Der Übungsabend](#der-übungsabend) — Anwesenheit, Einschätzung, Einteilung
- [Spinte und Ausrüstung](#spinte-und-ausrüstung)
- [Das Lager](#das-lager)
- [Drucken: QR-Codes und Etiketten](#drucken-qr-codes-und-etiketten)
- [Mitglieder](#mitglieder)
- [Am Handy](#am-handy)
- [Verwaltung](#verwaltung) — Stammdaten, Betreuer, Sicherung, Update
- [Dieses Handbuch in der Software](#dieses-handbuch-in-der-software)
- [Bilder neu aufnehmen](#bilder-neu-aufnehmen)

---

## Anmeldung und Übersicht

Ohne Anmeldung ist alles gesperrt, mit einer Ausnahme: die Seite, deren QR-Code man gerade
gescannt hat.

![Anmeldung](bilder/anmeldung.png)

Nach der Anmeldung erscheint die Übersicht — eine Kachel je Spint, gruppiert nach
Umkleidebereich. Auf jeder Kachel steht der Inhalt (Jacke 158, Hose 158, Helm,
Handschuhe 8, Schuhe 39). Freie Spinte sind blass dargestellt. Oben stehen die Kennzahlen;
gibt es ein defektes Teil, ist die Zahl rot.

![Übersicht aller Spinte](bilder/uebersicht.png)

Die Navigation fasst zwei Bereiche in Untermenüs zusammen, damit die Leiste am Handy nicht
umbricht. Unter **Dienst** steht, was man am Übungsabend braucht, unter **Ausrüstung** die
Verwaltung der Sachen. Die Zahl neben „Ausrüstung" ist die Anzahl der offenen Aufgaben.

![Menü „Dienst"](bilder/navigation-dienst.png)

---

## Der Übungsabend

### Anwesenheit

Ein Tipp je Kind, ohne Speichern-Knopf. Antippen wechselt durch
**da → entschuldigt → fehlt → offen**.

![Anwesenheitsliste](bilder/anwesenheit.png)

Zwei Hinweise für den Alltag:

* Am schnellsten geht meist: erst **„alle da"**, dann die wenigen antippen, die fehlen.
* Es können mehrere Betreuer gleichzeitig erfassen. Die Seite holt sich alle 15 Sekunden
  den Stand der anderen. Ein Tipp schickt dabei den Zielzustand und nicht „einen weiter" —
  sonst könnte eine veraltete Seite ein „da" versehentlich auf „entschuldigt" stellen.

„Offen" bedeutet: noch nichts erfasst. Das ist etwas anderes als „fehlt" — am Anfang des
Abends steht noch bei allen „offen", und das sagt nichts über die Kinder aus.

### Anwesenheit über die Zeit

Die Quote je Kind über alle Termine, dazu die Beteiligung je Abend.

![Anwesenheit über die Zeit](bilder/anwesenheit-quoten.png)

### Einschätzung

Die Grundlage für die Einteilung. Die Seite öffnet zunächst ohne Werte:

![Einschätzung, zugeklappt](bilder/einschaetzung.png)

Die Werte werden erst nach einem Klick angezeigt. So steht nichts über die Kinder auf dem
Bildschirm, wenn sie beim Erfassen daneben stehen.

![Einschätzung, geöffnet](bilder/einschaetzung-offen.png)

Bewertet wird auf drei Achsen, jeweils 1–5:

| Achse | Frage |
|---|---|
| Erfahrung | Wie viel kann er/sie schon? |
| Zupacken | Körperlich, praktisch, Schlauch und Leiter |
| Anleiten | Übernimmt, hilft anderen, bleibt ruhig |

Eine Gesamtnote gibt es absichtlich nicht, denn daraus würde eine Rangliste. Ein Kind mit
5/2/4 ist nicht „besser" als eines mit 2/5/3, es ist anders einsetzbar. Die Werte erscheinen
weder auf den QR-Seiten am Spint noch in der API. Voreingestellt ist überall 3; was man
nicht anfasst, bleibt neutral.

Ein Klick setzt einen Wert — es gibt keinen Speichern-Knopf.

### Wer kann welche Funktion?

Führungsfunktionen können nur wenige Kinder, das lässt sich nicht wegrechnen. Wichtig ist
die zweite Stufe `übt`: sie heißt „soll das lernen". Ohne sie bekämen immer dieselben zwei
Kinder den Gruppenführer, und die anderen kämen nie dran.

![Eignung und „Nicht zusammen"](bilder/einschaetzung-eignung.png)

Darunter steht **„Nicht zusammen"**: zwei Namen, die nicht in dieselbe Einheit sollen. Die
Einteilung hält sie auseinander, solange es rechnerisch möglich ist, und meldet es, wenn
nicht.

### Einteilung

Aus der Anwesenheit von heute werden Einheiten gebildet. Die Aufstellungen folgen der
FwDV 3: **Gruppe** (9), **Staffel** (6), **Trupp** (3) oder freie Einteilung ohne
Funktionen.

![Einteilung mit Funktionen](bilder/einteilung.png)

Die Kürzel sind die üblichen: **GF** Gruppenführer, **MA** Maschinist, **Me** Melder,
**AF/AM** Angriffstrupp, **WF/WM** Wassertrupp, **SF/SM** Schlauchtrupp.

Im Bild haben Lea Bruns und Ben Adler den Gruppenführer, beide mit Stufe `übt`. Die beiden
Routinierten (Jonas Kern, Emma Lindner) hatten die Funktion beim letzten Mal — deshalb sind
jetzt die Übenden an der Reihe. `neu` markiert eine Funktion, die ein Kind noch nie hatte.

Der **Maschinist** zählt nicht als Führungsfunktion: Fahren und Pumpe bedienen die
Betreuer, das Kind assistiert. Dieser Platz eignet sich für Kinder, die erst schnuppern,
weil dort meist eine 1-zu-1-Betreuung besteht.

Eine neue Einteilung entsteht nur auf Knopfdruck — sonst stünde bei jedem Aufruf der Seite
eine andere da als die, die man gerade vorgelesen hat. Gespeichert wird, was auf dem
Bildschirm steht; erst dann zählt die Einteilung für die Rotation beim nächsten Mal.

Das gilt je Gerät: öffnen zwei Betreuer die Seite auf ihren Handys und würfeln beide, sieht
jeder seinen eigenen Vorschlag. Speichert der eine, während der andere seine Seite noch
offen hat, fragt die Software beim zweiten Speichern nach, statt die erste Einteilung
stillschweigend zu ersetzen — mit beiden Einteilungen nebeneinander zur Auswahl.

---

## Spinte und Ausrüstung

### Ein Spint

Die Seite zu einem Spint zeigt, wer ihn benutzt, was drin liegt und was noch fehlt.

![Spint bearbeiten](bilder/spint-bearbeiten.png)

Die Auswahl „Neues Teil eintragen" ist zweigeteilt: oben steht, was noch fehlt, unten, was
schon im Spint liegt. So legt man nicht versehentlich eine zweite Jacke an.

### Der QR-Code am Spint

Der Aufkleber an der Spinttür führt auf diese Seite. Sie ist ohne Anmeldung erreichbar,
weil Kinder und Eltern kein Passwort haben.

![Spint-Seite ohne Anmeldung](bilder/spint-qr-anonym.png)

Die Seite zeigt nur das eigene Mitglied und den eigenen Inhalt — keine Navigation, keine
Links zu anderen Seiten. Im QR-Code steht deshalb auch nicht die laufende Nummer, sondern
ein zufälliger Token (`/s/t8exz96cepde` statt `/s/1`). Mit fortlaufenden Nummern könnte
sonst jeder im WLAN die übrigen Spinte durchprobieren und bekäme Namen und Kleidergrößen
aller Jugendlichen.

Lagerorte funktionieren genauso:

![Lagerort-Seite ohne Anmeldung](bilder/lagerort-qr-anonym.png)

### Tauschen und Bestellen

Wenn ein Kind aus der Jacke herausgewachsen ist:

![Tauschen](bilder/tauschen.png)

Die Software sucht zuerst im Lager. Liegt dort etwas Passendes, wird getauscht und der
Lagerort genannt. Liegt nichts da, entsteht eine **Bestellung**. Vor dem Tausch kommt eine
Sicherheitsabfrage, weil danach ein echtes Teil in einen anderen Schrank gehört.

### Aufgaben

Alle offenen Bestellungen und Tauschaufträge an einer Stelle. Offene Bestellungen stehen
zusätzlich am Spint, damit nicht ein zweiter Betreuer dasselbe Paar Handschuhe noch einmal
bestellt.

![Aufgaben](bilder/aufgaben.png)

Taucht ein verlorenes Teil wieder auf, gibt es **„Doch gefunden"**: das nimmt die
Bestellung zurück und legt das ausgemusterte Teil in einem Schritt zurück in den Spint.

### Suche

Ein Feld für alles: Namen, Spintnummern, Größen, Inventarnummern. Mehrere Wörter werden
gemeinsam gesucht.

![Suche](bilder/suche.png)

### Ausgemustert

Ausgemusterte Teile werden nicht gelöscht. Sie bleiben hier einsehbar und lassen sich
zurückholen.

![Ausgemustert](bilder/ausgemustert.png)

---

## Das Lager

### Einbuchen und Bestand

Es gibt zwei Arten einzubuchen:

* **Sammelposten** — mehrere gleiche Teile ohne Inventarnummer, z. B. sechs Paar
  Handschuhe Größe 8 in einem Formular.
* **Einzelteil** — ein Stück mit eigener Inventarnummer, auch per Scanner.

![Lager](bilder/lager.png)

Auf dem Bild steht das Einbuchen oben, weil der Bestand gerade erfasst wird. Ist die
Ersterfassung abgeschlossen, schaltet man bei den Lagerorten den **Erfassungsmodus** aus —
dann steht der Bestand vorn und das Einbuchen weiter unten.

### Lagerorte

Jeder Lagerort bekommt einen eigenen QR-Code. Einer kann als **Standard** markiert werden:
neue Teile ohne gewähltes Ziel landen dort.

![Lagerorte](bilder/lagerorte.png)

### Arten und Größen

Hier stehen die Ausrüstungsarten, ihre Größenreihen und die Barcode-Präfixe der
Inventarnummern.

![Arten und Größen](bilder/arten-groessen.png)

Die Größenreihen entsprechen den echten Etiketten: Kleidung läuft nach Körpergröße
(116–176 cm) und geht danach in Konfektionsgrößen über — nach 176 folgt 44, nicht 182.
Handschuhe und Schuhe haben eigene Reihen. Wird eine Größe eingetippt, die es in der Reihe
nicht gibt, fragt die Software nach, statt sie stillschweigend zu übernehmen.

---

## Drucken: QR-Codes und Etiketten

### QR-Aufkleber

Kleine Aufkleber für Spinte und Lagerorte, mehrere je Blatt.

![QR-Aufkleber](bilder/qr-aufkleber.png)

### Das Spint-Etikett

Ein Etikett für die Spinttür: Name der Wehr und Logo oben, der Name des Kindes groß,
seitlich der QR-Code mit dem Hinweis „Was ist hier drin?", unten **JUGENDFEUERWEHR** — zur
Abgrenzung von der Kinderfeuerwehr, wenn beide dasselbe Logo tragen.

![Spint-Etikett](bilder/etikett.png)

Über **Etiketten je Seite** wird die Größe gewählt. Ein Etikett auf A4 ist für die meisten
Spinte zu groß, zwei je Seite passen in der Regel. Die Schrift skaliert mit, und der Name
wird nach der tatsächlichen Buchstabenbreite umbrochen, damit auch Namen wie „Hofmann"
nicht zerrissen werden.

![Etikettenbogen, zwei je Seite](bilder/etiketten-bogen.png)

Im Druckdialog **„Tatsächliche Größe"** wählen (100 %, nicht „An Seite anpassen") und
Hintergrundgrafiken einschalten, sonst fehlen die roten Balken. Das Etikett hält von selbst
Abstand zur Blattkante, um den nicht druckbaren Rand muss man sich nicht kümmern.

Die Adresse im QR-Code ist einstellbar. Sie muss von den Handys erreichbar sein, also
Hostname oder feste IP des Raspberry Pi.

---

## Mitglieder

Name, Geburtsdatum, Geschlecht, Telefon, Notiz.

![Mitglieder](bilder/mitglieder.png)

Das Geburtsdatum darf in Kurzform eingegeben werden: aus `5.5.16` wird `05.05.2016`, aus
`23.5.87` wird `23.05.1987`. Das Geschlecht bestimmt den Umkleidebereich des Spints. Beim
ersten Mitglied eines weiteren Geschlechts fragt die Software einmal, wie die Bereiche
aufgeteilt werden sollen.

---

## Am Handy

Alle Seiten funktionieren am Handy — am Übungsabend hat in der Umkleide niemand einen
Laptop dabei.

| Anwesenheit | Ein Spint | Nach dem Scannen |
|---|---|---|
| ![Anwesenheit am Handy](bilder/handy-anwesenheit.png) | ![Spint am Handy](bilder/handy-spint.png) | ![QR-Seite am Handy](bilder/handy-spint-qr.png) |

Der Barcode-Scan nutzt die Handykamera. Der Browser gibt die Kamera nur über **HTTPS**
frei, deshalb stellt `install-pi.sh` ein Zertifikat aus. Weil es selbstsigniert ist, warnt
der Browser beim ersten Aufruf; nach dem Bestätigen kommt die Warnung nicht wieder.

Die Darstellung folgt der Einstellung des Geräts — auf dunkel gestellten Handys erscheinen
die Seiten dunkel:

![Übersicht in dunkler Darstellung](bilder/uebersicht-dunkel.png)

---

## Verwaltung

Die folgenden Seiten sieht nur der **Jugendwart**. Betreuer pflegen Spinte, Ausrüstung,
Mitglieder und Arten; Zugänge, Rollen und Systemeinstellungen bleiben beim Jugendwart. Es
muss immer mindestens ein aktiver Jugendwart übrig bleiben, die Software lässt den letzten
nicht löschen oder sperren.

### Stammdaten

Name der Wehr, Abteilung, Leitspruch, Logo und die Zeiten des Übungsabends.

![Stammdaten](bilder/stammdaten.png)

Aus Beginn und Ende ergibt sich das Zeitfenster, in dem die Software vor einem Neustart
warnt: 10 Minuten vor Beginn bis 45 Minuten nach Ende. Ein Update ist in dieser Zeit
weiterhin möglich, es wird nur deutlich davon abgeraten.

Das Logo (PNG, JPEG, GIF, WebP oder SVG) liegt in der Datenbank, nicht als Datei daneben.
Dadurch ist es in jeder Sicherung enthalten und nach einer Wiederherstellung sofort wieder
da.

### Betreuer

![Betreuer verwalten](bilder/betreuer.png)

### Datensicherung

Eine Sicherung ist eine einzelne Datei mit allem: Mitglieder, Spinte, Ausrüstung, Aufgaben,
Anwesenheit, Einschätzungen, Logo.

![Datensicherung](bilder/sicherung.png)

Sicherungen sind **immer verschlüsselt**, eine unverschlüsselte Ausgabe gibt es nicht — in
der Datei stehen Namen, Geburtsdaten und Einschätzungen von Kindern. Verwendet wird das
Format von `openssl enc` (AES-256-CBC, PBKDF2). So lässt sich eine Sicherung auch ohne
diese Software öffnen, falls sie einmal nicht mehr läuft:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in spinte-2026-08-08-2241-s1.db.enc -out spinte.db
```

Drei Wege: über diese Seite, nachts automatisch auf einen USB-Stick, oder per Doppelklick
vom Windows-Rechner.

### System, Update und Herunterfahren

![Systemseite](bilder/system.png)

Vor dem Stromziehen immer über diese Seite **herunterfahren**: wird dem Pi im Betrieb der
Strom getrennt, kann die Speicherkarte Schaden nehmen und damit der ganze Bestand. Die
Seite beschreibt auch, woran man das Ende erkennt (die Leuchte am Pi steht ruhig auf rot).

### Aktualisieren

**Nach Updates suchen** fragt beim Repository nach, ohne etwas an der Installation zu ändern.
Danach steht auf der Seite, welche Änderungen anstehen, mit Kurztext je Änderung.

![Aktualisierung](bilder/update.png)

Das Nachfragen ist ein eigener Knopf und passiert nicht automatisch beim Aufruf der Seite.
Der Grund: die Weboberfläche darf am Programmordner nichts verändern, auch nicht an der
Versionsverwaltung — sonst könnte eine Sicherheitslücke in ihr dem nächsten Update fremden
Code unterschieben. Nachgefragt wird deshalb von demselben Helfer, der später auch
einspielt.

**Jetzt aktualisieren** führt dann aus: Sicherung ziehen, neuen Stand holen, Abhängigkeiten
installieren, Dienst neu starten, prüfen, ob die Seite antwortet. Schlägt das nach zwei
Versuchen fehl, stellt der Helfer selbständig den vorherigen Stand wieder her.

Der Ablauf ist bewusst zweigeteilt: die Anwendung kann sich nicht selbst neu starten, und
eine defekte Anwendung könnte keine Fehlerseite mehr anzeigen. Sie legt deshalb nur eine
Markierung ab; ein systemd-Wächter startet daraufhin den Helfer als root außerhalb des
Dienstes. Einzelheiten im [README](../README.md#updates-und-was-dabei-zu-beachten-ist).

### Sicherung zurückspielen

Für den Fall, dass Daten kaputtgegangen sind — etwa 40 Teile falsch eingebucht oder ein
Mitglied versehentlich gelöscht.

![Sicherung einspielen](bilder/restore.png)

Die Seite listet die Sicherungen vom USB-Stick und von der Speicherkarte auf; eine Datei
von woanders lässt sich hochladen. Vor dem Ersetzen legt die Software den aktuellen Stand
als `…-vor-restore.db.enc` daneben ab, sodass sich auch eine falsch gewählte Sicherung
wieder rückgängig machen lässt. Nach dem Einspielen wird man abgemeldet, weil die eigene
Anmeldung aus der ersetzten Datenbank stammt.

### Schema-Fassung

Jede Sicherung enthält die Fassung des Datenbankschemas — im Dateinamen
(`spinte-2026-08-08-2012-s1.db.enc`) und in der Datei selbst. Beim Einspielen wird
verglichen:

* **Ältere** Sicherung: wird eingespielt und auf den aktuellen Stand gehoben.
* **Neuere** Sicherung: wird abgelehnt; erst die Software aktualisieren, dann einspielen.

Ohne diese Prüfung würden beim Einspielen einer neueren Sicherung die Spalten verloren
gehen, die die ältere Software noch nicht kennt — ohne Fehlermeldung. Einzelheiten in
[Datenbank und Schema-Fassungen](datenbank.md).

### API-Zugänge

Zugriff für andere Systeme, lesend oder schreibend, per Token. Gespeichert wird nur der
Hash; im Klartext wird der Token genau einmal angezeigt, direkt nach dem Anlegen.

![API-Zugänge](bilder/api-zugaenge.png)

### Änderungsverlauf

Wer hat wann was geändert — damit sich Fragen wie „wo ist die Jacke 158 hin?" beantworten
lassen.

![Änderungsverlauf](bilder/verlauf.png)

---

## Dieses Handbuch in der Software

Das Handbuch liegt nicht nur im Repository, sondern auch in der laufenden Installation:
unter *eigener Name → Handbuch*. Es wird bei jedem Update mit aktualisiert, die laufende
Fassung zeigt also immer das passende Handbuch — auch im Gerätehaus ohne Internet.

![Handbuch in der Oberfläche](bilder/handbuch.png)

Oben stehen der Stand der Software und die Schema-Fassung. Über die drei Schaltflächen
erreicht man die beiden anderen Dokumente: die technische Beschreibung (das README) und die
Beschreibung der Datenbank-Fassungen. Sichtbar ist das alles nur für angemeldete Benutzer.

## Bilder neu aufnehmen

Alle Bilder in diesem Handbuch werden automatisch erzeugt. Nach einer Änderung an der
Oberfläche:

```bash
node scripts/doku-daten.js --force
```

```bash
node scripts/doku-bilder.js
```

Das erste Skript legt den Demo-Bestand in `data-doku/` an: 14 erfundene Kinder, 14 Spinte,
75 Teile, sieben Übungsabende — mit offenen Aufgaben und halb gefüllten Spinten, damit die
Bilder den normalen Betrieb zeigen und keine leeren Seiten.

Das zweite Skript startet den Server auf diesem Bestand und steuert Chrome im Kopflos-Modus
über das DevTools-Protokoll. Eine zusätzliche Abhängigkeit braucht es dafür nicht, Node
bringt seit Fassung 22 einen WebSocket mit. Die Bilder landen in `docs/bilder/`.

`data-doku/` steht in `.gitignore`. Der Demo-Bestand selbst wird nicht mitgeliefert, nur
das Skript, das ihn erzeugt.
