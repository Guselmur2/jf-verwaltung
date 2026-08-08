# Benutzerhandbuch

Dieses Handbuch erklärt die Bedienung der Software — für Jugendwarte, Betreuerinnen und
Betreuer. Wie die Software eingerichtet und betrieben wird (Installation, Pi, Updates,
Sicherungstechnik), steht in der [technischen Dokumentation](../README.md).

> **Alle Namen, Größen und Einschätzungen auf den Bildern sind erfunden.** Sie stammen aus
> einem Demobestand, den [`scripts/doku-daten.js`](../scripts/doku-daten.js) erzeugt — echte
> Kinderdaten haben in einem öffentlichen Repository nichts zu suchen. Wie du die Bilder neu
> erzeugst, steht [am Ende](#11-bilder-neu-aufnehmen).

---

## Inhaltsverzeichnis

1. [Anmeldung und Übersicht](#1-anmeldung-und-übersicht)
2. [Der Übungsabend](#2-der-übungsabend)
3. [Mitglieder und Umkleidebereiche](#3-mitglieder-und-umkleidebereiche)
4. [Spinte und Ausrüstung](#4-spinte-und-ausrüstung)
5. [Kleidung tauschen und bestellen](#5-kleidung-tauschen-und-bestellen)
6. [Das Lager](#6-das-lager)
7. [QR-Codes und Etiketten drucken](#7-qr-codes-und-etiketten-drucken)
8. [Am Handy](#8-am-handy)
9. [Verwaltung](#9-verwaltung)
10. [Dieses Handbuch in der Software](#10-dieses-handbuch-in-der-software)
11. [Bilder neu aufnehmen](#11-bilder-neu-aufnehmen)

---

## 1. Anmeldung und Übersicht

Ruf im Gerätehaus die Adresse des Pi auf (z. B. `https://jfwpi.fritz.box`). Ohne Anmeldung
ist alles gesperrt, mit einer Ausnahme: die Seite, deren QR-Code du gerade gescannt hast.

![Anmeldung](bilder/anmeldung.png)

Nach der Anmeldung erscheint die Übersicht — eine Kachel je Spint, gruppiert nach
Umkleidebereich. Auf jeder Kachel steht der Inhalt (Jacke 158, Hose 158, Helm,
Handschuhe 8, Schuhe 39). Freie Spinte sind blass dargestellt. Oben stehen die Kennzahlen;
gibt es ein defektes Teil, ist die Zahl rot.

![Übersicht aller Spinte](bilder/uebersicht.png)

Die Navigation fasst zwei Bereiche in Untermenüs zusammen, damit die Leiste am Handy nicht
umbricht. Unter **Dienst** steht, was du am Übungsabend brauchst, unter **Ausrüstung** die
Verwaltung der Sachen. Die Zahl neben „Ausrüstung" ist die Anzahl der offenen Aufgaben.

![Menü „Dienst"](bilder/navigation-dienst.png)

### Rollen

* **Betreuer** pflegen Spinte, Ausrüstung, Mitglieder und Arten, erfassen Anwesenheit,
  Einschätzung und Einteilung.
* **Jugendwarte** dürfen zusätzlich Zugänge und Rollen verwalten, Stammdaten ändern,
  Sicherungen ziehen und das System aktualisieren.

### Suche

Ein Feld für alles: Namen, Spintnummern, Größen, Inventarnummern. Mehrere Wörter werden
gemeinsam gesucht — `Jacke 158` findet die Jacken in Größe 158, `Helm Ben` das
Ausrüstungsstück eines bestimmten Kindes.

![Suche](bilder/suche.png)

---

## 2. Der Übungsabend

### Anwesenheit erfassen

Ein Tipp je Kind, ohne Speichern-Knopf. Antippen wechselt durch
**da → entschuldigt → fehlt → offen**.

![Anwesenheitsliste](bilder/anwesenheit.png)

Zwei Hinweise für den Alltag:

* Am schnellsten geht meist: erst **„alle da"**, dann die wenigen antippen, die fehlen.
* Ihr könnt zu mehreren gleichzeitig erfassen. Die Seite holt sich alle 15 Sekunden den
  Stand der anderen. Ein Tipp schickt dabei den Zielzustand und nicht „einen weiter" —
  sonst könnte eine veraltete Seite ein „da" versehentlich auf „entschuldigt" stellen.

„Offen" bedeutet: noch nichts erfasst. Das ist etwas anderes als „fehlt" — am Anfang des
Abends steht bei allen „offen", und das sagt nichts über die Kinder aus.

### Anwesenheitsquote

Die Quote je Kind über alle Termine, dazu die Beteiligung je Abend. Bezugsgröße ist, wie oft
für das Kind überhaupt etwas erfasst wurde — wer erst seit Herbst dabei ist, wird nicht an
den Terminen davor gemessen. Für Jugendflamme und Leistungsspange ist das die Zahl, nach der
gefragt wird.

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
5/2/4 ist nicht „besser" als eines mit 2/5/3, es ist anders einsetzbar. Die Liste ist immer
alphabetisch und nicht nach Werten sortierbar. Die Werte erscheinen weder auf den QR-Seiten
am Spint noch in der API; im Änderungsverlauf steht nur, *dass* jemand etwas geändert hat,
nicht *was*. Voreingestellt ist überall 3; was du nicht anfasst, bleibt neutral.

Ein Klick setzt einen Wert — es gibt keinen Speichern-Knopf.

> Einschätzungen von Minderjährigen zu speichern ist etwas anderes als eine Kleidergröße.
> Halte die Merkmale bei **Fähigkeiten**: „Anleiten 2" ist eine Beobachtung, ein Urteil über
> den Charakter hätte hier nichts zu suchen.

### Wer kann welche Funktion?

Führungsfunktionen können nur wenige Kinder, das lässt sich nicht wegrechnen. Wichtig ist
die zweite Stufe `übt`: sie heißt „soll das lernen". Ohne sie bekämen immer dieselben zwei
Kinder den Gruppenführer, und die anderen kämen nie dran.

![Eignung und „Nicht zusammen"](bilder/einschaetzung-eignung.png)

Darunter steht **„Nicht zusammen"**: zwei Namen, die nicht in dieselbe Einheit sollen. Die
Einteilung hält sie auseinander, solange es rechnerisch möglich ist, und meldet es, wenn
nicht.

### Einteilung vorschlagen

Aus der Anwesenheit von heute werden Einheiten gebildet. Die Aufstellungen folgen der
FwDV 3: **Gruppe** (9), **Staffel** (6), **Trupp** (3) oder freie Teams ohne Funktionen für
Spiele und Wettkämpfe.

![Einteilung mit Funktionen](bilder/einteilung.png)

Die Kürzel sind die üblichen: **GF** Gruppenführer, **MA** Maschinist, **Me** Melder,
**AF/AM** Angriffstrupp, **WF/WM** Wassertrupp, **SF/SM** Schlauchtrupp.

Im Bild haben Lea Bruns und Ben Adler den Gruppenführer, beide mit Stufe `übt`. Die beiden
Routinierten (Jonas Kern, Emma Lindner) hatten die Funktion beim letzten Mal — deshalb sind
jetzt die Übenden an der Reihe. `neu` markiert eine Funktion, die ein Kind noch nie hatte.

Ist eine Einheit kleiner als die Aufstellung, fallen die hinteren Plätze weg (erst der
Melder, dann der Schlauchtrupp). Der Gruppenführer bleibt immer besetzt.

Der **Maschinist** zählt nicht als Führungsfunktion: Fahren und Pumpe bedienen die
Betreuer, das Kind assistiert. Dieser Platz eignet sich für Kinder, die erst schnuppern,
weil dort meist eine 1-zu-1-Betreuung besteht.

Eine neue Einteilung entsteht nur auf Knopfdruck — sonst stünde bei jedem Aufruf der Seite
eine andere da als die, die du gerade vorgelesen hast. Gespeichert wird, was auf dem
Bildschirm steht; erst dann zählt die Einteilung für die Rotation beim nächsten Mal.

Das gilt je Gerät: öffnen zwei Betreuer die Seite auf ihren Handys und würfeln beide, sieht
jeder seinen eigenen Vorschlag. Speichert der eine, während der andere seine Seite noch
offen hat, fragt die Software beim zweiten Speichern nach, statt die erste Einteilung
stillschweigend zu ersetzen — mit beiden Einteilungen nebeneinander zur Auswahl.

---

## 3. Mitglieder und Umkleidebereiche

Name, Geburtsdatum, Geschlecht, Telefon, Notiz.

![Mitglieder](bilder/mitglieder.png)

Das Geburtsdatum darf in Kurzform eingegeben werden: aus `5.5.16` wird `05.05.2016`, aus
`23.5.87` wird `23.05.1987`.

Das Geschlecht bestimmt den Umkleidebereich des Spints. Beim ersten Mitglied eines weiteren
Geschlechts fragt die Software einmal, wie die Bereiche aufgeteilt werden sollen — eigener
Bereich oder gemeinsam mit einem bestehenden. Die Spintnummern dürfen je Bereich neu bei 01
beginnen.

---

## 4. Spinte und Ausrüstung

### Einen Spint bearbeiten

Die Seite zu einem Spint zeigt, wer ihn benutzt, was drin liegt und was noch fehlt.

![Spint bearbeiten](bilder/spint-bearbeiten.png)

Die Auswahl „Neues Teil eintragen" ist zweigeteilt: oben steht, was noch fehlt, unten, was
schon im Spint liegt. So legst du am Spint nicht versehentlich eine zweite Jacke an.

Jacken, Hosen, Helme und Schuhe haben eine Inventarnummer und lassen sich scannen.
Handschuhe bewusst nicht — davon gibt es viele gleiche, und eine Nummer je Paar wäre Aufwand
ohne Nutzen.

### Der QR-Code am Spint

Der Aufkleber an der Spinttür führt auf diese Seite. Sie ist ohne Anmeldung erreichbar, weil
Kinder und Eltern kein Passwort haben.

![Spint-Seite ohne Anmeldung](bilder/spint-qr-anonym.png)

Die Seite zeigt nur das eigene Mitglied und den eigenen Inhalt — keine Navigation, keine
Links zu anderen Seiten. Im QR-Code steht deshalb auch nicht die laufende Nummer, sondern
ein zufälliger Token (`/s/t8exz96cepde` statt `/s/1`). Mit fortlaufenden Nummern könnte
sonst jeder im WLAN die übrigen Spinte durchprobieren und bekäme Namen und Kleidergrößen
aller Jugendlichen.

Lagerorte funktionieren genauso:

![Lagerort-Seite ohne Anmeldung](bilder/lagerort-qr-anonym.png)

### Ausgemustertes Material

Ausgemusterte Teile werden nicht gelöscht. Sie bleiben hier einsehbar und lassen sich
zurückholen.

![Ausgemustert](bilder/ausgemustert.png)

---

## 5. Kleidung tauschen und bestellen

Wenn ein Kind aus der Jacke herausgewachsen ist:

![Tauschen](bilder/tauschen.png)

Die Software sucht zuerst im Lager. Liegt dort etwas Passendes, wird getauscht und der
Lagerort genannt; das alte Teil wandert zurück ins Lager. Liegt nichts da, entsteht eine
**Bestellung**. Vor dem Tausch kommt eine Sicherheitsabfrage, weil danach ein echtes Teil in
einen anderen Schrank gehört.

### Aufgabenliste

Alle offenen Bestellungen und Tauschaufträge an einer Stelle. Offene Bestellungen stehen
zusätzlich am Spint, damit nicht ein zweiter Betreuer dasselbe Paar Handschuhe noch einmal
bestellt.

![Aufgaben](bilder/aufgaben.png)

Taucht ein verlorenes Teil wieder auf, gibt es **„Doch gefunden"**: das nimmt die Bestellung
zurück und legt das ausgemusterte Teil in einem Schritt zurück in den Spint.

---

## 6. Das Lager

### Material einbuchen

Es gibt zwei Arten einzubuchen:

* **Sammelposten** — mehrere gleiche Teile ohne Inventarnummer, z. B. sechs Paar Handschuhe
  Größe 8 in einem Formular.
* **Einzelteil** — ein Stück mit eigener Inventarnummer, auch per Scanner.

![Lager](bilder/lager.png)

Auf dem Bild steht das Einbuchen oben, weil der Bestand gerade erfasst wird. Ist die
Ersterfassung abgeschlossen, schaltest du bei den Lagerorten den **Erfassungsmodus** aus —
dann steht der Bestand vorn und das Einbuchen weiter unten.

### Lagerorte verwalten

Jeder Lagerort bekommt einen eigenen QR-Code. Einer kann als **Standard** markiert werden:
neue Teile ohne gewähltes Ziel landen dort.

![Lagerorte](bilder/lagerorte.png)

### Kleidungsarten und Größenreihen

Hier stehen die Ausrüstungsarten, ihre Größenreihen und die Barcode-Präfixe der
Inventarnummern.

![Arten und Größen](bilder/arten-groessen.png)

Die Größenreihen entsprechen den echten Etiketten: Kleidung läuft nach Körpergröße
(116–176 cm) und geht danach in Konfektionsgrößen über — **nach 176 folgt 44**, nicht 182.
Handschuhe und Schuhe haben eigene Reihen. Tippst du eine Größe ein, die es in der Reihe
nicht gibt, fragt die Software nach, statt sie stillschweigend zu übernehmen.

Führt eure Wehr auch 182 und 188, ergänzt ihr sie hier vor der 44. Die Reihenfolge in der
Liste bestimmt, was „eine Nummer größer" bedeutet.

---

## 7. QR-Codes und Etiketten drucken

### QR-Aufkleber

Kleine Aufkleber für Spinte und Lagerorte, mehrere je Blatt.

![QR-Aufkleber](bilder/qr-aufkleber.png)

### Spint-Etiketten

Ein Etikett für die Spinttür: Name der Wehr und Logo oben, der Name des Kindes groß,
seitlich der QR-Code mit dem Hinweis „Was ist hier drin?", unten **JUGENDFEUERWEHR** — zur
Abgrenzung von der Kinderfeuerwehr, wenn beide dasselbe Logo tragen.

![Spint-Etikett](bilder/etikett.png)

Über **Etiketten je Seite** wählst du die Größe. Ein Etikett auf A4 ist für die meisten
Spinte zu groß, zwei je Seite passen in der Regel. Die Schrift skaliert mit, und der Name
wird nach der tatsächlichen Buchstabenbreite umbrochen, damit auch Namen wie „Hofmann" nicht
zerrissen werden.

![Etikettenbogen, zwei je Seite](bilder/etiketten-bogen.png)

Hinweise für den Ausdruck:

* Skalierung auf **100 %** stellen, nicht „An Seite anpassen".
* **Hintergrundgrafiken** einschalten, sonst fehlen die roten Balken.
* Kopf- und Fußzeilen des Browsers (Datum, Adresse) ausschalten.

Um den nicht druckbaren Rand musst du dich nicht kümmern — das Etikett hält von selbst
Abstand zur Blattkante.

Die Adresse im QR-Code ist einstellbar. Sie muss von den Handys erreichbar sein, also
Hostname oder feste IP des Raspberry Pi.

---

## 8. Am Handy

Alle Seiten funktionieren am Handy — am Übungsabend hat in der Umkleide niemand einen Laptop
dabei.

| Anwesenheit | Ein Spint | Nach dem Scannen |
|---|---|---|
| ![Anwesenheit am Handy](bilder/handy-anwesenheit.png) | ![Spint am Handy](bilder/handy-spint.png) | ![QR-Seite am Handy](bilder/handy-spint-qr.png) |

Der Barcode-Scan nutzt die Handykamera. Der Browser gibt die Kamera nur über **HTTPS** frei;
weil das Zertifikat selbstsigniert ist, warnt er beim ersten Aufruf. Nach dem Bestätigen
kommt die Warnung nicht wieder.

Die Darstellung folgt der Einstellung des Geräts — auf dunkel gestellten Handys erscheinen
die Seiten dunkel:

![Übersicht in dunkler Darstellung](bilder/uebersicht-dunkel.png)

---

## 9. Verwaltung

Die folgenden Seiten sieht nur der **Jugendwart**. Es muss immer mindestens ein aktiver
Jugendwart übrig bleiben; die Software lässt den letzten nicht löschen oder sperren.

### Stammdaten

Name der Wehr, Abteilung, Leitspruch, Logo und die Zeiten des Übungsabends.

![Stammdaten](bilder/stammdaten.png)

Aus Beginn und Ende ergibt sich das Zeitfenster, in dem die Software vor einem Neustart
warnt: 10 Minuten vor Beginn bis 45 Minuten nach Ende. Ein Update bleibt in dieser Zeit
möglich, es wird nur davon abgeraten.

Das Logo (PNG, JPEG, GIF, WebP oder SVG, höchstens 2 MB) liegt in der Datenbank, nicht als
Datei daneben. Dadurch ist es in jeder Sicherung enthalten und nach einer Wiederherstellung
sofort wieder da.

### Betreuerzugänge

![Betreuer verwalten](bilder/betreuer.png)

### Datensicherung

Eine Sicherung ist eine einzelne Datei mit allem: Mitglieder, Spinte, Ausrüstung, Aufgaben,
Anwesenheit, Einschätzungen, Logo.

![Datensicherung](bilder/sicherung.png)

Sicherungen sind **immer verschlüsselt**, eine unverschlüsselte Ausgabe gibt es nicht — in
der Datei stehen Namen, Geburtsdaten und Einschätzungen von Kindern. Das Passwort wird
nirgends gespeichert: ohne es ist die Datei wertlos. Also aufschreiben und getrennt von der
Sicherung aufbewahren.

Drei Wege: über diese Seite, nachts automatisch auf einen USB-Stick, oder per Doppelklick
vom Windows-Rechner. Wann zuletzt gesichert wurde, steht auf der Systemseite; ist der Stand
älter als zwei Tage, sagt sie es.

### System, Updates und Herunterfahren

![Systemseite](bilder/system.png)

Vor dem Stromziehen immer über diese Seite **herunterfahren**: wird dem Pi im Betrieb der
Strom getrennt, kann die Speicherkarte Schaden nehmen und damit der ganze Bestand. Die Seite
beschreibt auch, woran du das Ende erkennst (die Leuchte am Pi steht ruhig auf rot).

### Software aktualisieren

**Nach Updates suchen** fragt beim Repository nach, ohne etwas an der Installation zu
ändern. Danach steht auf der Seite, welche Änderungen anstehen, mit Kurztext je Änderung.

![Aktualisierung](bilder/update.png)

Das Suchen ist ein eigener Knopf und passiert nicht automatisch beim Aufruf der Seite. Der
Grund ist Sicherheit: die Weboberfläche darf am Programmordner nichts verändern, auch nicht
an der Versionsverwaltung — sonst könnte eine Lücke in ihr dem nächsten Update fremden Code
unterschieben. Näheres in der [technischen Dokumentation](../README.md).

**Jetzt aktualisieren** führt dann aus: Sicherung erstellen, neuen Stand holen,
Abhängigkeiten installieren, Dienst neu starten, prüfen, ob die Seite antwortet. Schlägt das
nach zwei Versuchen fehl, wird automatisch der vorherige Stand wiederhergestellt.

Während des Updates ist die Software etwa eine Minute nicht erreichbar. Die Seite meldet
sich von selbst zurück, sobald der Dienst wieder da ist — **den Strom dabei nicht trennen**.

### Sicherung wiederherstellen

Für den Fall, dass Daten kaputtgegangen sind — etwa 40 Teile falsch eingebucht oder ein
Mitglied versehentlich gelöscht.

![Sicherung einspielen](bilder/restore.png)

Die Seite listet die Sicherungen vom USB-Stick und von der Speicherkarte auf; eine Datei von
woanders kannst du hochladen. Vor dem Ersetzen legt die Software den aktuellen Stand als
`…-vor-restore.db.enc` daneben ab, sodass sich auch eine falsch gewählte Sicherung
rückgängig machen lässt. Nach dem Einspielen wirst du abgemeldet, weil deine Anmeldung aus
der ersetzten Datenbank stammt — melde dich mit den Zugangsdaten an, die zum Zeitpunkt
dieser Sicherung galten.

Jede Sicherung trägt die Version der Datenbankstruktur, im Dateinamen (das `-s2` in
`spinte-2026-08-08-2241-s2.db.enc`) und in der Datei selbst. Eine **ältere** Sicherung wird
eingespielt und auf den aktuellen Stand gebracht, eine **neuere** abgelehnt — dann erst die
Software aktualisieren. Einzelheiten in [Datenbank und Schema-Fassungen](datenbank.md).

### API-Zugänge

Zugriff für andere Systeme, lesend oder schreibend, per Token. Gespeichert wird nur der
Hash; im Klartext wird der Token genau einmal angezeigt, direkt nach dem Anlegen.

![API-Zugänge](bilder/api-zugaenge.png)

### Änderungsverlauf

Wer hat wann was geändert — damit sich Fragen wie „wo ist die Jacke 158 hin?" beantworten
lassen.

![Änderungsverlauf](bilder/verlauf.png)

---

## 10. Dieses Handbuch in der Software

Das Handbuch liegt nicht nur im Repository, sondern auch in der laufenden Installation:
unter *[dein Name] → Handbuch*. Es wird bei jedem Update mit aktualisiert, die laufende
Fassung zeigt also immer das passende Handbuch — auch im Gerätehaus ohne Internet.

![Handbuch in der Oberfläche](bilder/handbuch.png)

Oben stehen der Stand der Software und die Schema-Version. Über die drei Schaltflächen
erreichst du die beiden anderen Dokumente: die technische Beschreibung und die Beschreibung
der Datenbank-Fassungen. Sichtbar ist das alles nur für angemeldete Benutzer.

---

## 11. Bilder neu aufnehmen

Alle Bilder in diesem Handbuch werden automatisch erzeugt. Nach einer Änderung an der
Oberfläche:

```bash
npm run doku-daten
```

```bash
npm run doku-bilder
```

Das erste Skript baut eine Demodatenbank in `data-doku/` auf: 14 erfundene Kinder, 14
Spinte, 75 Ausrüstungsteile und mehrere Übungsabende — mit offenen Aufgaben und halb
gefüllten Spinten, damit die Bilder den normalen Betrieb zeigen und keine leeren Seiten.

Das zweite Skript startet den Server auf diesem Bestand, steuert Chrome im Headless-Modus
und speichert die Bildschirmfotos in `docs/bilder/`.

`data-doku/` steht in `.gitignore`. Der Demobestand selbst wird nicht mitgeliefert, nur das
Skript, das ihn erzeugt.
