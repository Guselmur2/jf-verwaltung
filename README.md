# Spintverwaltung Jugendfeuerwehr

Lokale Verwaltung von Spinten, Mitgliedern und Einsatzkleidung. An jedem Spint hängt ein
QR-Code, der auf die Detailseite dieses Spints im Vereins-WLAN zeigt. Läuft komplett auf
einem Raspberry Pi, ohne Internet und ohne Cloud.

## Was die Seiten können

| Seite | Adresse | Wer |
|---|---|---|
| Spint-Detail (Ziel des QR-Codes) | `/s/<token>` | **jeder, der diesen QR-Code scannt** |
| Lagerort-Detail (Ziel des QR-Codes) | `/l/<token>` | **jeder, der diesen QR-Code scannt** |
| Übersicht aller Spinte | `/` | Betreuer |
| Lager (Ausrüstung ohne Spint) | `/lager` | Betreuer |
| Mitglieder | `/mitglieder` | Betreuer |
| Suche über alles | `/suche` | Betreuer |
| Barcode scannen | `/scannen` | Betreuer |
| Spint-Detail intern | `/spint/7` | Betreuer |
| Spint bearbeiten | `/spint/7/bearbeiten` | Betreuer |
| Tauschen / Bestellen | `/ausruestung/12/tauschen` | Betreuer |
| Aufgaben | `/aufgaben` | Betreuer, zuständig ist der Jugendwart |
| Lagerorte verwalten | `/lagerorte` | Betreuer |
| Ausrüstungsarten | `/ausruestungsarten` | Betreuer |
| Ausgemusterte Teile | `/ausgemustert` | Betreuer |
| QR-Etiketten drucken | `/qr` | Betreuer |
| Änderungsverlauf | `/verlauf` | Betreuer |
| Umkleidebereiche | `/bereiche` | **nur Jugendwart** |
| Betreuer verwalten | `/betreuer` | **nur Jugendwart** |

## Wer was sehen darf

**Ohne Anmeldung ist alles gesperrt — bis auf die eine Seite, deren QR-Code man gerade
gescannt hat.** Keine Übersicht, keine Mitgliederliste, keine Suche, kein Lagerbestand.

Damit das hält, steht im QR-Code **nicht** die laufende Nummer, sondern ein zufälliger
Token: `/s/t8exz96cepde` statt `/s/1`. Sonst könnte jeder im WLAN von einem Etikett auf alle
anderen schließen und einfach `/spint/2`, `/spint/3` … durchprobieren — und hätte damit Namen
und Kleidergrößen aller Jugendlichen. Der Token ist 12 Zeichen aus einem 31-stelligen
Alphabet (rund 59 Bit); Durchprobieren ist ausgeschlossen.

Die Spint-Seite zeigt nur **ihr eigenes** Mitglied und ihren eigenen Inhalt. Für Anonyme gibt
es dort keine Navigation und keinen Link, der irgendwo anders hinführt — nur „Anmelden".

Der Zugriffsschutz ist als **Positivliste** in `server.js` gebaut: gesperrt ist alles, was
nicht ausdrücklich freigegeben ist (Anmeldung, statische Dateien, `/s/<token>`,
`/l/<token>`). Eine neu hinzugefügte Seite ist damit automatisch geschützt, statt
versehentlich offen zu stehen.

Intern verlinkt die Software Spinte weiter über die kurze Nummer (`/spint/7`) — die
funktioniert aber **nur angemeldet**. Nötig ist die interne Nummer, weil die aufgedruckte
Spint-Nummer in verschiedenen Umkleidebereichen doppelt vorkommen darf.

> **Beim Umstieg auf Token müssen alle Etiketten neu gedruckt werden.** Beim ersten Start
> nach dem Update trägt die Software Token für bestehende Spinte und Lagerorte nach und weist
> im Protokoll darauf hin. Alte Etiketten zeigen dann ins Leere.

Was der Token **nicht** leistet: Wer einen QR-Code abfotografiert oder die Adresse notiert,
kann diesen einen Spint weiter aufrufen. Ein Token lässt sich derzeit nicht einzeln
zurücksetzen — wenn das gebraucht wird, sag Bescheid.

**Rollen:** Betreuer pflegen Spinte, Ausrüstung, Mitglieder und Ausrüstungsarten.
Jugendwarte sind Betreuer und dürfen zusätzlich Zugänge anlegen, Rollen ändern,
Passwörter zurücksetzen und Zugänge löschen. Es muss immer mindestens ein aktiver
Jugendwart übrig bleiben — die Software verhindert, dass sich die Wehr aussperrt.

## Erster Start

```bash
npm install
npm start
```

Beim ersten Aufruf von <http://localhost:3000> erscheint die Ersteinrichtung. Der dort
angelegte Zugang wird automatisch Jugendwart. Danach ist die Einrichtungsseite gesperrt.

Vorkonfigurierte Ausrüstungsarten: Jacke, Hose, Helm, Handschuhe, Schuhe. Über
`/ausruestungsarten` lassen sich weitere ergänzen und je Art festlegen, ob Größe und
Inventarnummer geführt werden.

## Geburtsdatum in Kurzform

Beim Anlegen genügt die Kurzform mit zweistelligem Jahr; das Jahrhundert wird so ergänzt,
dass das Datum nicht in der Zukunft liegt:

- `5.5.16` → 05.05.2016 (Jugendliche)
- `23.5.87` → 23.05.1987 (ältere Feuerwehrleute)

Ein zweistelliges Jahr `JJ` wird zu `20JJ`, falls das höchstens das aktuelle Jahr ist,
sonst zu `19JJ`. Voll ausgeschrieben (`05.05.2016`) oder als ISO-Datum geht natürlich auch.

## Umkleidebereiche und Geschlecht

Jedes Mitglied hat ein Geschlecht (männlich, weiblich, divers). Spinte liegen in
**Umkleidebereichen**. Die Oberfläche passt sich an, was tatsächlich gebraucht wird:

- Solange nur ein Geschlecht in der Jugendfeuerwehr ist, wird **nicht** nach Bereichen
  unterschieden — keine Gruppierung, keine Bereichsauswahl.
- Der Bereich „Divers“ (und ebenso Jungs/Mädels) erscheint erst, sobald es ein Mitglied
  dieses Geschlechts oder einen Spint dafür gibt.
- Wird das **erste** Mitglied eines neuen Geschlechts angelegt, fragt die Software den
  Jugendwart: eigener Umkleidebereich mit eigenen Spinden, oder alle im selben Bereich?
  Bei einem eigenen Bereich wird zusätzlich gefragt, ob die Spint-Nummerierung dort neu
  bei 1 beginnt oder hinter der höchsten bestehenden Nummer fortläuft. Legt ein Betreuer
  (kein Jugendwart) das erste Mitglied an, bleibt es zunächst im gemeinsamen Bereich; der
  Jugendwart kann das unter `/bereiche` nachträglich einrichten.
- Weil die Nummerierung je Bereich neu beginnen darf, kann „Spint 01“ mehrfach existieren
  (einmal je Bereich). Beim Zuweisen eines Spints werden nur Mitglieder angeboten, deren
  Geschlecht zu diesem Bereich gehört.

Unter `/bereiche` (Jugendwart) lassen sich Bereiche umbenennen, die Nummerierung ändern,
Geschlechter zuordnen sowie Bereiche anlegen und löschen (leere Bereiche).

## Lagerorte

Was in keinem Spint liegt, ist „im Lager". Damit man es auch findet, bekommt jeder Schrank,
jedes Regal und jede Kiste einen **Lagerort** mit eigenem QR-Code. Scannen zeigt sofort,
was drin ist — zusammengefasst als „10 × Jacke, 20 × Schuhe" plus Aufschlüsselung nach Größe.

Einzeln aufgelistet wird nur, was sich unterscheidet: Teile mit Inventarnummer, Notiz oder
einem Zustand außer „gut". Zwanzig gleiche Paar Schuhe erscheinen als eine Zeile, nicht als
zwanzig — sonst wäre die Seite unlesbar.

Beim Anlegen gibt es ein Feld **Anzahl**: 20 Paar Schuhe Gr. 38 auf einen Schlag. Die
Inventarnummer bleibt dann leer und wird später je Teil nachgetragen (mehrere Teile können
schlecht dieselbe Nummer haben — die Software weist das ab).

Ausrüstung ohne Lagerort ist nicht verloren, sie läuft unter „ohne Ort" und lässt sich von
dort einsortieren. Wird ein Lagerort gelöscht, wandert sein Inhalt genau dorthin.

## Barcode scannen

Auf den Etiketten der Einsatzkleidung steht die Inventarnummer meist auch als Strichcode.
Der 📷-Knopf in der Kopfleiste öffnet die Kamera; erkannt werden Code 128, Code 39, EAN,
UPC, ITF, Codabar und QR-Codes.

Drei Stellen nutzen den Scanner:

- **Kopfleiste und `/scannen`** — Nummer scannen, die Software springt direkt zu dem Spint
  oder Lagerort, in dem das Teil liegt. Bei mehreren Treffern landet man auf der Suche.
- **Suchfeld** — scannen statt tippen.
- **Jedes Inventarnummer-Feld** — beim Erfassen neuer Ausrüstung die Nummer einscannen.

Erkannt wird zuerst über die im Browser eingebaute `BarcodeDetector`-Schnittstelle
(Chrome/Android, ohne Download). Fehlt sie, lädt die Seite `html5-qrcode` nach — **lokal vom
Pi aus `/vendor`**, nicht von einem CDN. Der Scan funktioniert damit auch ohne Internet.

### Testinstanz mit HTTPS (zum Ausprobieren am Handy)

```bash
npm run testdaten
npm run https
```

`npm run testdaten` legt einen kleinen Bestand in `data-test/` an (3 Mitglieder, 3 Spinte,
2 Lagerorte, 48 Teile, eine offene Aufgabe) — getrennt von der echten Datenbank in `data/`.
Anmeldung: **test / test1234**. Erneut mit `--force` setzt den Bestand zurück.

`npm run https` erzeugt beim ersten Start ein selbstsigniertes Zertifikat für die eigene
LAN-Adresse, ermittelt diese Adresse selbst und startet den Server darauf. Die Adresse für
das Handy steht in der Ausgabe. Ändert sich die IP später (DHCP), warnt das Skript.

Am Handy warnt der Browser vor dem unbekannten Zertifikat — das ist bei selbstsignierten
Zertifikaten normal:

- **Chrome/Android:** „Erweitert" → „Weiter zu … (unsicher)"
- **Safari/iOS:** „Details einblenden" → „Diese Website besuchen"

Danach ist die Seite ein sicherer Kontext und die Kamera funktioniert. Sollte iOS die Kamera
trotzdem verweigern, hilft es, `tls/test.crt` per AirDrop oder Mail aufs Gerät zu laden, als
Profil zu installieren und unter *Einstellungen → Allgemein → Info → Zertifikats­vertrauens­einstellungen*
vollständig zu vertrauen.

**Windows-Firewall:** Eingehende Verbindungen sind standardmäßig blockiert. Kommt das Handy
nicht durch, diesen Befehl **als Administrator** in PowerShell ausführen:

```powershell
New-NetFirewallRule -DisplayName "JF Spintverwaltung Test 8443" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private
```

Nach dem Testen wieder entfernen:

```powershell
Remove-NetFirewallRule -DisplayName "JF Spintverwaltung Test 8443"
```

Zum Ausprobieren liegt in den Testdaten die Inventarnummer **112000172** (Hose Gr. 170 in
Spint 01) — dieselbe wie auf dem Etikett einer echten Hose, sodass sich der Scan am
tatsächlichen Kleidungsstück prüfen lässt.

### Wichtig: die Kamera braucht HTTPS

Browser geben `getUserMedia` nur in einem **sicheren Kontext** frei — also über HTTPS oder
auf `localhost`. Ruft man die Seite im WLAN über `http://192.168.1.50:3000` auf, bleibt die
Kamera gesperrt. Das ist eine Browser-Regel, keine Einstellung der Software; der Scan-Dialog
sagt das dann auch klar und bietet die Eingabe per Tastatur an.

Wer am Handy scannen will, braucht also ein Zertifikat. Selbstsigniert genügt:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /opt/jf-spinte/tls.key -out /opt/jf-spinte/tls.crt \
  -subj "/CN=192.168.1.50" -addext "subjectAltName=IP:192.168.1.50"
```

Dann in der Service-Datei ergänzen:

```ini
Environment=TLS_KEY=/opt/jf-spinte/tls.key
Environment=TLS_CERT=/opt/jf-spinte/tls.crt
Environment=BASE_URL=https://192.168.1.50:3000
```

Beim ersten Aufruf warnt das Handy vor dem unbekannten Zertifikat — einmal bestätigen, dann
ist die Seite ein sicherer Kontext und die Kamera funktioniert. **Nach dem Umstieg auf HTTPS
müssen die QR-Codes neu gedruckt werden**, weil `http://` darin steht.

Fehlt `TLS_KEY`/`TLS_CERT`, läuft alles unverändert über HTTP — nur eben ohne Kamera.

Eine Alternative ohne Zertifikat: ein USB- oder Bluetooth-Handscanner. Der verhält sich wie
eine Tastatur, tippt die Nummer ins fokussierte Feld und braucht keinen Kamerazugriff.

## Tauschen und Bestellen

Wächst ein Jugendlicher aus der Jacke heraus oder geht etwas kaputt, klickt der Betreuer im
Spint beim betreffenden Teil auf **Tauschen / Bestellen**.

1. **Wunschgröße wählen.** Für die gängigen Zahlenschemata schlägt die Software die nächsten
   Größen vor: Körpergrößen in Schritten von 6 (164 → 170 → 176), Schuh- und
   Handschuhgrößen in Einerschritten (32 → 34 bei zwei Nummern größer). Freitext-Größen wie
   „S/M/L" bekommen keinen Vorschlag, dort tippt man selbst.
2. **Lager wird geprüft.** Liegt ein passendes Stück da, sagt die Software, **wo** es ist
   („Schrank 1, 6 Stück, Gr. 176").
3. **Kontrolle vor dem Tausch** (siehe unten) — beide Teile werden geprüft.
4. **Getauscht.** Das Ersatzteil wandert in den Spint, das alte wahlweise zurück ins Lager,
   in einen bestimmten Schrank oder in die Ausmusterung. Defekte Teile stehen dabei auf
   „ausmustern" vorbelegt.
5. **Nichts da? Dann wird es eine Aufgabe.** Sie landet im Tab **Aufgaben** und bleibt dort
   offen, bis jemand sie abhakt.

### Kontrolle vor dem Tausch

In der Umkleide vergreift man sich schnell — deshalb kommt vor dem Tausch ein Zwischenschritt,
der **beide** Teile abfragt:

- **Altes Teil aus dem Spint:** muss exakt stimmen. Führt die Art eine Inventarnummer, wird
  diese gescannt oder eingetippt; sonst (z. B. Handschuhe) die Größe eingetragen. Passt es
  nicht, bricht die Software ab und sagt, was nicht stimmt.
- **Neues Teil aus dem Lager:** hier zählt **jedes** Teil der gesuchten Größe an dieser
  Fundstelle als richtig — es ist ja gleichwertig. Geprüft wird nur, dass die gescannte
  Nummer wirklich zu dieser Fundstelle gehört.

Praktischer Nebeneffekt: Wurde das neue Teil als Sammelposten ohne Inventarnummer erfasst
(20 Paar Schuhe auf einmal), **trägt die Software die gescannte Nummer jetzt ein**. So füllen
sich die Nummern beim Ausgeben von selbst, statt dass jemand sie vorab abtippen muss.

Die erwarteten Werte stehen bewusst **nicht** auf der Kontrollseite — sonst wäre das Scannen
ein Klick ins Leere. Sie stehen auf dem Etikett am Teil in der Hand.

**Wenn das alte Teil fehlt:** unter „Altes Teil nicht auffindbar?" lässt sich die Kontrolle
mit Grund überspringen (verloren, Etikett unlesbar, sonstiges). Bei „verloren" wird das alte
Teil automatisch ausgemustert, denn es kann nicht zurück ins Lager. Der übersprungene Check
landet mit Grund im Verlauf. Das **neue** Teil wird trotzdem geprüft.

Diese Kontrolle ist ein Schutz gegen Verwechslung, keine Sicherheitsmaßnahme — wer will,
kann die Nummer abschreiben. Darum geht es nicht; es geht darum, dass niemand versehentlich
die Jacke des Nachbarn einbucht.

Der Aufgaben-Tab zeigt Art, Mitglied, Spint, Größenwechsel (`164 → 188`), Grund, Notiz und
wer sie wann angelegt hat. Ein Zähler in der Navigation zeigt die offenen Aufgaben. Aufgaben
lassen sich erledigen, abbrechen und wieder öffnen; löschen darf nur der Jugendwart. Über
„Aufgabe ohne konkretes Teil" geht auch eine reine Bestellung wie „5 Paar Stiefel Gr. 42".

Zuständig für die Aufgaben ist der Jugendwart — sichtbar und bearbeitbar sind sie aber für
alle Betreuer, weil in der Praxis oft der die Lieferung annimmt, der gerade da ist.

### Einstellungen (Umgebungsvariablen)

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `3000` | Port des Webservers |
| `HOST` | `0.0.0.0` | Netzwerkschnittstelle |
| `SESSION_SECRET` | fester Vorgabewert | **auf dem Pi unbedingt setzen**, sonst sind Sitzungs-Cookies fälschbar |
| `DATA_DIR` | `./data` | Ablageort der Datenbank |
| `BASE_URL` | Adresse der Anfrage | Adresse, die in den QR-Codes steht |
| `TLS_KEY` / `TLS_CERT` | leer | Pfade zu Schlüssel und Zertifikat. Nur gesetzt läuft die Seite über HTTPS — nötig für den Barcode-Scan per Kamera |

## Installation auf dem Raspberry Pi

Getestet mit Raspberry Pi OS (64 Bit) und Node.js 18+.

```bash
sudo apt update && sudo apt install -y nodejs npm git
git clone <dein-repo> /opt/jf-spinte && cd /opt/jf-spinte
npm install --omit=dev
```

Feste IP-Adresse vergeben (z. B. im Router als DHCP-Reservierung) — die Adresse steckt
in den gedruckten QR-Codes und darf sich nicht mehr ändern.

Als Dienst einrichten, damit die Software nach einem Stromausfall von selbst hochkommt —
`/etc/systemd/system/jf-spinte.service`:

```ini
[Unit]
Description=Spintverwaltung Jugendfeuerwehr
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/jf-spinte
Environment=PORT=3000
Environment=SESSION_SECRET=hier-eine-lange-zufallszeichenkette-eintragen
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now jf-spinte
sudo systemctl status jf-spinte
```

Zufälliges Secret erzeugen: `openssl rand -hex 32`

### QR-Codes drucken

`/qr` aufrufen, im Feld „Adresse" die feste Pi-Adresse eintragen (z. B.
`http://192.168.1.50:3000`), **Übernehmen**, einen Code am Handy testen, dann drucken.
Jedes Etikett zeigt Spintnummer, Name und die Klartext-Adresse — falls das Scannen mal
nicht klappt, kann man sie abtippen.

Steht die Adresse dauerhaft fest, besser gleich `Environment=BASE_URL=http://192.168.1.50:3000`
in die Service-Datei eintragen. Dann stimmen die QR-Codes unabhängig davon, über welchen
Namen man die Seite gerade aufruft.

## Sicherheit — was diese Software leistet und was nicht

Passwörter liegen als bcrypt-Hash in der Datenbank, Formulare sind CSRF-geschützt, die
Sitzungs-ID wechselt beim Anmelden. Das reicht für ein abgeschottetes Vereins-WLAN.

Was **nicht** enthalten ist: Die Verbindung läuft über HTTP, nicht HTTPS. Wer im selben
Netz mitliest, sieht Passwörter im Klartext. Deshalb gehört der Pi ins Heim-/Vereinsnetz
und **nicht** ins Internet — kein Portfreigeben am Router. Wer die Seite von außen braucht,
setzt ein VPN davor.

Das Lesen **einer** Spint-Seite ist bewusst ohne Anmeldung möglich, damit ein QR-Scan sofort
etwas anzeigt — aber nur die Seite, deren Token man gescannt hat (siehe „Wer was sehen
darf"). Alles andere verlangt eine Anmeldung.

Wer im Netz mitliest, sieht über HTTP allerdings auch die Token im Klartext. Für den
Praxisbetrieb ist HTTPS deshalb doppelt sinnvoll: für die Kamera und für die Token.

## Datensicherung

Alles steckt in `data/spinte.db`. Sicherungskopie im laufenden Betrieb:

```bash
sqlite3 /opt/jf-spinte/data/spinte.db ".backup '/pfad/zum/backup/spinte-$(date +%F).db'"
```

Einfaches Kopieren der Datei reicht **nicht** zuverlässig, weil die Datenbank im
WAL-Modus läuft — `.backup` oder vorher den Dienst stoppen.

## Wie die Daten zusammenhängen

- **Mitglied** — ein Jugendlicher, mit Geschlecht (männlich/weiblich/divers). Hat höchstens
  einen Spint.
- **Umkleidebereich** — bündelt die Spinte eines oder mehrerer Geschlechter. Jedes
  Geschlecht ist genau einem Bereich zugeordnet.
- **Spint** — trägt die Nummer vom Etikett (je Bereich eindeutig), liegt in einem Bereich,
  gehört keinem oder genau einem Mitglied.
- **Lagerort** — Schrank, Regal, Kiste. Eigener QR-Code.
- **Ausrüstungsstück** — liegt entweder in einem Spint **oder** an einem Lagerort **oder**
  im Lager ohne Ort. Nie an zwei Stellen gleichzeitig; das stellt `setPlacement()` in
  `model.js` an einer einzigen Stelle sicher. Ausgemusterte Teile verschwinden aus allen
  Listen, bleiben aber unter `/ausgemustert` auffindbar und lassen sich zurückholen.
- **Ausrüstungsart** — Jacke, Helm, … Legt fest, ob Größe und Inventarnummer geführt
  werden. Eine Art mit vorhandenen Teilen lässt sich nicht löschen, nur stilllegen.

### Suche über mehrere Wörter

Die Suche zerlegt die Eingabe in Wörter; **jedes** Wort muss irgendwo passen, aber nicht
alle in derselben Spalte. Damit findet `Jacke 162` genau die Jacken in Größe 162, obwohl
nirgends „Jacke 162“ am Stück steht. Weitere Beispiele:

| Eingabe | findet |
|---|---|
| `Jacke 162` | Jacken in Größe 162 |
| `Helm Ben` | den Helm in Bens Spint |
| `Jacke Schrank1` | Jacken, die in Schrank1 liegen |
| `Muster Max` | das Mitglied, auch bei umgedrehtem Namen |
| `112000172` | das Teil mit dieser Inventarnummer |

Groß- und Kleinschreibung sowie die Reihenfolge der Wörter spielen keine Rolle. Bei
Ausrüstung wird in Art, Größe, Inventarnummer, Zustand, Notiz, Lagerort, Spintnummer und
Besitzer gesucht.

### Inventarnummern sind eindeutig

Eine Inventarnummer gehört zu genau einem Teil — sonst führt jeder Scan ins Ungewisse.
Der Versuch, eine schon vergebene Nummer einzutragen, wird abgewiesen; die Meldung nennt,
wo die Nummer bereits steckt („… ist schon vergeben: Jacke Gr. 164 in Spint 01 (Max Meier)").
Groß- und Kleinschreibung zählen dabei nicht: `JA-1` und `ja-1` sind dieselbe Nummer.

Ausgenommen sind Teile **ohne** Nummer — davon darf es beliebig viele geben, sonst wären
Sammelposten (20 Paar Schuhe auf einmal) unmöglich.

Abgesichert ist das doppelt: im Programm für eine verständliche Meldung und zusätzlich als
Regel in der Datenbank, damit die Eindeutigkeit auch dann hält, wenn später eine Codestelle
übersehen wird.

Enthält eine ältere Datenbank bereits doppelte Nummern, lässt sich die Datenbank-Regel nicht
anlegen. Die Software startet dann trotzdem — man käme sonst an die Daten nicht mehr heran,
um sie zu berichtigen — und meldet die Fälle beim Start:

```
WARNUNG: Diese Inventarnummern sind mehrfach vergeben:
  0001 — 2 Teile
```

Betroffene Teile über die Suche aufrufen und die Nummer korrigieren oder leeren. Neue
Duplikate verhindert das Programm auch in diesem Zustand. Nach dem Berichtigen greift beim
nächsten Start zusätzlich die Datenbank-Regel.
- **Aufgabe** — Tausch- oder Bestellwunsch. Art, Mitglied und Spint stehen zusätzlich als
  eigene Felder darin, damit die Aufgabe lesbar bleibt, wenn das Teil später wegfällt.

Nichts wird beim Löschen mitgerissen: Wird ein Spint gelöscht, wandert sein Inhalt ins
Lager. Tritt ein Mitglied aus, wird sein Spint frei, die Ausrüstung bleibt liegen.

Jede Änderung landet mit Zeitstempel und Name im Verlauf (`/verlauf`). Die Zeiten stehen
in UTC, so wie SQLite sie speichert — im Sommer also zwei Stunden vor der Ortszeit.

## Aufbau

```
server.js              Start, Sitzungen, Router-Reihenfolge
src/db.js              SQLite öffnen, Schema anwenden, migrieren, Standardarten anlegen
src/schema.sql         Tabellen
src/auth.js            Anmeldung, Rollen, CSRF
src/dates.js           Geburtsdatum aus Kurzform parsen und anzeigen
src/sizes.js           Größenschritte (164 -> 170, Schuh 32 -> 34)
src/tokens.js          Geheimnisse für die QR-Links
scripts/               Testdaten anlegen, HTTPS-Testinstanz starten
src/model.js           Abfragen, Bereichs-, Lager- und Aufgabenlogik
src/audit.js           Änderungsprotokoll
src/routes/            eine Datei je Themenbereich
views/                 EJS-Vorlagen
public/                CSS, kleine Skripte, Barcode-Scanner
```

Kein Build-Schritt: Datei ändern, Dienst neu starten, fertig.

`npm test` startet einen eigenen Server mit leerer Datenbank in einem temporären Ordner
und geht die wichtigsten Abläufe durch — Ersteinrichtung, Rollen, Umkleidebereiche,
Spinte, Lagerorte mit Mengenanlage, Barcode-Endpunkt, Tauschen mit und ohne Lagertreffer,
Aufgaben, Suche, QR und öffentlicher Lesezugriff. Die echte Datenbank wird nicht angefasst.
