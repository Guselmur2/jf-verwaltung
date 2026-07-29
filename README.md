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
| Arten & Größen (inkl. Barcode-Präfix) | `/ausruestungsarten` | Betreuer |
| Ausgemusterte Teile | `/ausgemustert` | Betreuer |
| QR-Aufkleber drucken | `/qr` | Betreuer |
| Spint-Etiketten (1/2/4 je Seite) | `/etiketten`, `/etikett/7` | Betreuer |
| Logo der Wehr | `/logo` | **jeder** |
| Änderungsverlauf | `/verlauf` | Betreuer |
| Umkleidebereiche | `/bereiche` | **nur Jugendwart** |
| Betreuer verwalten | `/betreuer` | **nur Jugendwart** |
| Stammdaten &amp; Logo | `/stammdaten` | **nur Jugendwart** |
| Datensicherung | `/sicherung` | **nur Jugendwart** |
| API-Zugänge | `/api-zugaenge` | **nur Jugendwart** |
| System, Pi herunterfahren | `/system` | **nur Jugendwart** |
| API für andere Systeme | `/api/v1/…` | **Token** |

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
`/l/<token>` und `/logo`). Eine neu hinzugefügte Seite ist damit automatisch geschützt,
statt versehentlich offen zu stehen.

`/logo` steht bewusst offen: das Logo der Wehr erscheint auch im Kopf der Spint-Seite, die
man ohne Anmeldung per QR-Code aufruft. Es verrät nichts über Mitglieder.

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

Das **Einbuchen** steht auf der Lager-Seite ganz oben, nicht am Ende — beim Einräumen ist das
die Aufgabe, und vorher musste man erst nach unten scrollen (am Handy lästig). Ein Sprung
**„↓ Bestand ansehen"** führt trotzdem schnell zur Liste. Es gibt zwei Wege, weil sie sich im
Alltag unterscheiden:

* **Sammelposten** — mehrere gleiche Teile ohne eigene Nummer, etwa 6 Paar Handschuhe Gr. 8.
  Ein Feld **Anzahl**, keine Inventarnummer. Es entstehen einzelne Teile (nicht ein Posten mit
  Stückzahl), sodass jedes später eine eigene Nummer oder einen eigenen Zustand bekommen kann.
* **Einzelteil mit Nummer** — ein Stück mit eigener Inventarnummer (Jacke, Hose, Helm), auch
  per Kamera scannbar.

Mehrere Teile können schlecht dieselbe Inventarnummer haben; Anzahl zusammen mit einer Nummer
weist die Software darum ab.

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

## Der eingerichtete Pi

| | |
|---|---|
| Adresse | **https://jfwpi.fritz.box** |
| Gerät | Raspberry Pi, Debian 13 (arm64), Node 20 |
| Verzeichnis | `/opt/jf-spinte` |
| Datenbank | `/opt/jf-spinte/data/spinte.db` |
| Zertifikat | `/opt/jf-spinte/tls/pi.crt`, gültig bis Juli 2036 |
| Dienst | `jf-spinte.service`, Autostart aktiv, `Restart=always` |
| Benutzer | `sam` |

### Warum der Hostname statt der IP

Das Zertifikat ist auf **`jfwpi.fritz.box`** ausgestellt, nicht auf eine IP-Adresse. Es bleibt
damit gültig, wenn der Pi eine neue IP bekommt — auch beim Umzug in ein anderes Netz, solange
dort ebenfalls eine FRITZ!Box steht und der Pi seinen Hostnamen `JfwPi` behält. Die
Einträge im Zertifikat:

```
DNS:jfwpi.fritz.box, DNS:JfwPi.fritz.box, DNS:jfwpi, DNS:JfwPi,
DNS:localhost, IP:192.168.188.120, IP:127.0.0.1
```

Die IP steht zusätzlich drin, damit der Zugriff auch dann klappt, wenn der Name gerade nicht
auflöst. Ändert sich die IP, verliert nur dieser eine Eintrag seine Bedeutung — über den
Namen läuft weiterhin alles.

**Wann der Name doch nicht auflöst:** Wenn ein Handy „Privates DNS" (DNS-über-HTTPS/TLS)
aktiviert hat, fragt es nicht mehr die FRITZ!Box und findet `jfwpi.fritz.box` nicht. Dann
hilft, privates DNS im WLAN abzuschalten — oder die IP zu verwenden.

### Dienst bedienen

```bash
ssh -i ~/.ssh/jfwpi_key sam@jfwpi.fritz.box
sudo systemctl status jf-spinte
sudo systemctl restart jf-spinte
journalctl -u jf-spinte -n 50 --no-pager
```

### Neue Version aufspielen

```bash
sh scripts/deploy-pi.sh
```

Überträgt den **letzten Commit**, installiert fehlende Abhängigkeiten, startet den Dienst neu
und prüft, ob er antwortet. Datenbank, Zertifikat und Einstellungen bleiben unberührt.

### Datensicherung

```bash
ssh -i ~/.ssh/jfwpi_key sam@jfwpi.fritz.box \
  "sqlite3 /opt/jf-spinte/data/spinte.db \".backup '/tmp/spinte-\$(date +%F).db'\"" \
  && scp -i ~/.ssh/jfwpi_key sam@jfwpi.fritz.box:/tmp/spinte-*.db .
```

`sqlite3` muss dafür auf dem Pi installiert sein (`sudo apt install sqlite3`). Alternativ den
Dienst kurz stoppen und die Datei mit `scp` kopieren.

## Installation auf einem anderen Raspberry Pi

Getestet mit Raspberry Pi 5, Debian 13 und Node.js 20. Alles Nötige erledigt ein Skript:

```bash
git clone <dein-repo> jf-spinte && cd jf-spinte
sudo sh scripts/install-pi.sh
```

Das war es. Der Aufruf darf wiederholt werden — Datenbank, Zertifikat und
Sitzungsgeheimnis bleiben dabei erhalten.

Was das Skript tut:

| Schritt | |
|---|---|
| Pakete | `nodejs`, `npm`, `openssl`, `polkitd`, `avahi-daemon` nachinstallieren |
| Software | nach `/opt/jf-spinte` kopieren, `npm install --omit=dev` |
| Zertifikat | selbstsigniert für `<name>.fritz.box`, `<name>.local`, `localhost` und die aktuelle IP |
| Dienst | `jf-spinte.service` aus `deploy/` erzeugen, Geheimnis würfeln, starten |
| Herunterfahren | polkit-Regel aus `deploy/` einspielen |
| Sicherung | `jf-sicherung.timer` bereitlegen (schaltet sich ein, sobald ein Passwort hinterlegt ist) |
| Probe | Weboberfläche antwortet? Herunterfahren erlaubt? |

Anpassen lässt sich das über Umgebungsvariablen:

```bash
sudo BENUTZER=pi ORDNER=/opt/jf-spinte ADRESSE=spinte.fritz.box sh scripts/install-pi.sh
```

Nach einem Umzug in ein anderes Netz steht im Zertifikat noch die alte IP. Über den
Hostnamen funktioniert trotzdem alles; wer es sauber will, stellt es neu aus:

```bash
sudo ZERTIFIKAT_NEU=1 sh /opt/jf-spinte/scripts/install-pi.sh
```

> Danach hat das Zertifikat einen neuen Fingerabdruck. Das Sicherungsskript auf dem
> Windows-Rechner merkt sich den alten und bricht ab — einmal mit `-Einrichten` neu starten.

### Warum der Pi über polkit heruntergefahren wird und nicht über sudo

Der Dienst läuft als gewöhnlicher Benutzer und ist mit `NoNewPrivileges=true` abgesichert.
Damit kann er **kein sudo starten** — sudo ist ein setuid-Programm, und genau das unterbindet
diese Einstellung. Das ist so gewollt: der Benutzer, unter dem der Dienst läuft, darf per sudo
meist ohnehin alles, und aus einer Lücke in der Weboberfläche würden sonst sofort Root-Rechte.

`systemctl poweroff` geht stattdessen über D-Bus an `systemd-logind` — kein setuid nötig,
nur eine Erlaubnis. Die steht in
[`deploy/49-jf-spinte-poweroff.rules`](deploy/49-jf-spinte-poweroff.rules) und gilt für genau
eine Aktion und genau einen Benutzer. Neustarten, Dienste verwalten, Dateien lesen: alles
weiterhin gesperrt.

Ohne diese Regel läuft die Software normal weiter, nur der Knopf **Pi herunterfahren** meldet
dann „Interactive authentication required". Von Hand nachrüsten:

```bash
sudo sed 's/@BENUTZER@/sam/' /opt/jf-spinte/deploy/49-jf-spinte-poweroff.rules \
  | sudo tee /etc/polkit-1/rules.d/49-jf-spinte-poweroff.rules
sudo systemctl reload polkit
```

Prüfen, ob es greift — ohne den Pi wirklich abzuschalten:

```bash
busctl --system call org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager CanPowerOff
```

Antwortet das mit `s "yes"`, sitzt die Regel. Bei `s "challenge"` fehlt sie noch.

### Nächtliche Sicherung auf einen USB-Stick

Das Windows-Skript holt die Sicherung nur, wenn der Rechner an ist **und** im selben Netz
steht wie der Pi. Sobald der Pi im Gerätehaus hängt, fällt das weg. Der Pi läuft ohnehin
durch — also sichert er sich selbst, jede Nacht um 3:30 Uhr.

Gesichert wird zweierlei, beides mit demselben Passwort verschlüsselt:

| Datei | Inhalt |
|---|---|
| `spinte-JJJJ-MM-TT-hhmm.db.enc` | die Datenbank |
| `wlan-JJJJ-MM-TT-hhmm.tar.gz.enc` | die WLAN-Zugangsdaten |

Die WLAN-Daten stehen an zwei Stellen: von Hand angelegte Verbindungen unter
`/etc/NetworkManager/system-connections`, die bei der Ersteinrichtung erzeugten in
`/etc/netplan`. Beide gehen mit — sonst fehlt nach einer Neuinstallation ausgerechnet der
Netzzugang, und man steht mit einem Pi da, der nirgends hinkommt.

**Einrichten** (der Timer selbst kommt aus `install-pi.sh`, es fehlt nur Ziel und Passwort):

```bash
sudo mkdir -p /mnt/jf-sicherung
sudo blkid | grep -i usb   # UUID des Sticks herausfinden
```

Den Stick fest einhängen, damit er auch ohne angemeldeten Benutzer da ist — der
Desktop-Automount unter `/media/...` hilft nachts nicht. In `/etc/fstab`:

```
UUID=XXXX-XXXX  /mnt/jf-sicherung  vfat  defaults,nofail,noatime,uid=1000,gid=1000,umask=0077,x-systemd.device-timeout=10  0  0
```

`nofail` ist wichtig: fehlt der Stick, bootet der Pi trotzdem durch. Dann Passwort
hinterlegen und einschalten:

```bash
sudo mkdir -p /etc/jf-spinte
sudo sh -c 'printf "%s\n" "DEIN-PASSWORT" > /etc/jf-spinte/sicherung.passwort'
sudo chmod 600 /etc/jf-spinte/sicherung.passwort
sudo systemctl daemon-reload && sudo mount -a
sudo systemctl enable --now jf-sicherung.timer
sudo systemctl start jf-sicherung.service   # einmal zur Probe
```

Wann zuletzt gesichert wurde, steht unter **System** in der Weboberfläche. Ist der Stand
älter als zwei Tage, sagt die Seite es.

**Fehlt der Stick**, weicht die Sicherung auf die Speicherkarte aus
(`/opt/jf-spinte/data/sicherungen`) und meldet das als Warnung. Eine Sicherung am
schlechteren Ort ist besser als gar keine — verschwiegen wird es aber nicht.

> **Was das nicht leistet:** Passwort und Sicherung liegen beide auf dem Pi. Wer das Gerät
> mitnimmt, hat beides. Der Schutz wirkt für den Stick, wenn man ihn herausnimmt und
> woanders hinlegt — und genau dafür ist er gedacht. Die Sicherung, die du über die
> Weboberfläche von Hand herunterlädst, kann ruhig ein anderes Passwort haben; dann bleibt
> sie auch dann geschützt, wenn der Pi in fremde Hände gerät.

Der Timer läuft als root, weil die WLAN-Zugangsdaten sonst niemand lesen darf. Die
Datenbank-Sicherung reicht das Skript an den Dienstbenutzer weiter — als root gehörten die
Begleitdateien der Datenbank (`-wal`, `-shm`) plötzlich root, und der Dienst könnte danach
nicht mehr schreiben.

Zurückspielen geht mit Standardwerkzeug, die Software wird dafür nicht gebraucht:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in wlan-2026-07-28-0330.tar.gz.enc -out wlan.tar.gz
tar -tzf wlan.tar.gz
```

### Pi herunterfahren

Unter **eigener Name → System & Herunterfahren** (nur Jugendwart) steht der Knopf
**Pi herunterfahren**. Der fährt den Rechner geordnet herunter — wichtig, bevor jemand den
Stecker zieht, sonst kann die Speicherkarte Schaden nehmen.

Die Status-Leuchte sagt, wann es soweit ist:

| Leuchte | Bedeutung |
|---|---|
| grün, blinkend | läuft, es wird geschrieben — **nicht ziehen** |
| ruhig rot | heruntergefahren, noch am Strom — ab hier ist Ziehen sicher |
| aus | kein Strom |

Der Raspberry Pi 5 hat neben dem USB-C-Anschluss einen **Ein-/Ausschalter**: ein kurzer Druck
startet ihn wieder, Kabelziehen ist nicht nötig. Ältere Modelle haben den nicht — dort das
Netzteil ziehen und **ein paar Sekunden warten**, bevor es wieder eingesteckt wird, sonst
merkt der Pi den Unterbruch nicht.

### QR-Codes drucken

Es gibt zwei Formate für dieselbe Sache:

| | `/qr` | `/etiketten` |
|---|---|---|
| Größe | mehrere Aufkleber je Blatt | 1, 2 oder 4 Etiketten je Blatt |
| Zeigt | Nummer, Name, Klartext-Adresse | Logo, Name der Wehr, Name in groß, QR-Code |
| Wofür | Lagerorte, Kisten, kleine Beschriftungen | die Spinttür |

Bei beiden zuerst im Feld „Adresse" die feste Pi-Adresse eintragen (z. B.
`https://jfwpi.fritz.box`), **Übernehmen**, einen Code am Handy testen, dann drucken.

Steht die Adresse dauerhaft fest, besser gleich `Environment=BASE_URL=https://jfwpi.fritz.box`
in die Service-Datei eintragen. Dann stimmen die QR-Codes unabhängig davon, über welchen
Namen man die Seite gerade aufruft.

### Das Spint-Etikett für die Spinttür

`/etiketten` druckt die Etiketten: oben Logo und Name der Wehr, groß **„Dieser Spint wird
benutzt von …"**, daneben der QR-Code mit der Frage *„Was ist hier drin?"*, unten der
Schriftzug der Abteilung. Ein einzelnes Etikett gibt es über den Knopf **Etikett drucken** auf
der Spint-Seite oder unter `/etikett/<nr>`.

**Wie viele je Seite** wählt man oben aus — 1, 2 oder 4. Voreinstellung ist **2 je Seite**;
das passt an den meisten Spinten. Eins je Seite dreht das Blatt ins Querformat (für einen
Aushang), vier je Seite ergibt kleine Etiketten für Kisten und Fächer.

Zum Drucken nur zwei Dinge:

* **„Tatsächliche Größe"** (100 %) statt „An Seite anpassen" — sonst skaliert der Browser das
  Etikett.
* **Hintergrundgrafiken** an — in Chrome unter „Weitere Einstellungen“, sonst bleiben die
  roten Balken weiß.

Um die **Ränder** muss man sich nicht mehr kümmern. Früher lief das Etikett bis an die
Blattkante, und jeder Heimdrucker schnitt die roten Balken ab (der Grund, warum das erste
Exemplar den Umweg über Word nehmen musste). Jetzt sitzt jedes Etikett als umrandete Karte mit
Sicherheitsabstand (`@page`-Rand 8 mm plus Abstand im Raster) sicher innerhalb des bedruckbaren
Bereichs.

**Ein Bauprinzip zum Nachlesen:** Alle Layouts sind dieselbe Karte in verschiedenen Größen. In
`public/etikett.css` steht `--kw` (Kartenbreite) je `data-pro-seite`, `--u` ist ein Hundertstel
davon, und alle Maße darin sind Vielfache von `--u`. So skaliert die Karte als Ganzes. Die
Schriftgröße des Namens wird nicht geschätzt, sondern in `namensgroesse()`
(`src/routes/etiketten.js`) ausgerechnet: der Zeilenumbruch wird nachgestellt und der größte
Grad genommen, bei dem kein Wort breiter als eine Zeile ist und alle Zeilen in die Höhe passen.
Dabei zählen `m` und `w` breiter als `i` und `l` — ohne diese Gewichtung zerriss der Browser
„Wollmann“ mitten im Wort. Weil die Karte in allen Layouts gleich geformt ist, genügt der
Anteil (`NAME_SPALTE`, `NAME_HOEHE`); die passende Schrift skaliert dann mit `kartenBreiteMm`
aus `LAYOUTS`.

> Ändert sich die Kartengröße in `public/etikett.css` (`--kw`), muss `kartenBreiteMm` in
> `LAYOUTS` (`src/routes/etiketten.js`) mitgezogen werden — beide beschreiben dieselbe Karte.

### Stammdaten: Name und Logo

Unter `/stammdaten` (nur Jugendwart) stehen drei Textfelder und das Logo:

| Feld | steht auf dem Etikett | Beispiel |
|---|---|---|
| Name der Wehr | oben im roten Balken | `Jugendfeuerwehr Ebertsheim` |
| Abteilung | unten in Großbuchstaben | `Jugendfeuerwehr` |
| Leitspruch | unten rechts, klein | `Wir sind die Helden von morgen!` |

Die **Abteilung** ist dafür da, sich von der Kinderfeuerwehr abzuheben, wenn beide dasselbe
Logo tragen — auf dem Blatt steht dann groß, zu wem der Spint gehört.

Das Logo (PNG, JPEG, GIF, WebP oder SVG, höchstens 2 MB) liegt **in der Datenbank**, nicht
als Datei daneben. Damit steckt es in jeder Datensicherung und ist nach einer
Wiederherstellung ohne Zutun wieder da. Ob eine hochgeladene Datei wirklich ein Bild ist,
prüft die Software am Dateiinhalt, nicht am Namen oder am gemeldeten Typ.

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

Alles steckt in einer einzigen SQLite-Datei. Der Jugendwart findet die Sicherung im Menü
hinter dem eigenen Namen unter **Datensicherung**. Dort ein Passwort vergeben — heraus kommt
`spinte-2026-07-27-2241.db.enc`.

Erzeugt wird der Abzug über die **Sicherungsfunktion von SQLite**, nicht durch Kopieren der
Datei. Das ist wichtig: die Datenbank läuft im WAL-Modus, ein Teil der Änderungen steht in
`spinte.db-wal` und noch nicht in `spinte.db`. Ein einfaches `cp` liefert deshalb einen
unvollständigen Stand. Die Software darf während der Sicherung weiterlaufen.

### Immer verschlüsselt

In der Sicherung stehen Namen und Geburtsdaten von Kindern, deshalb wird sie **ausnahmslos
verschlüsselt** (AES-256-CBC, Schlüssel über PBKDF2 mit 10 000 Runden). Das Passwort wird
**nirgends gespeichert** — ohne es ist die Datei wertlos. Also aufschreiben und getrennt von
der Sicherung aufbewahren.

Bewusst gewählt ist das Format von `openssl enc`. Damit lässt sich die Sicherung mit einem
Standardbefehl öffnen, auch wenn diese Software einmal nicht mehr läuft:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in spinte-2026-07-27-2241.db.enc -out spinte.db
```

Eine Sicherung, die nur das eigene Programm lesen kann, ist im Ernstfall keine.

### Zurückspielen

**Der einfache Weg:** eine leere Installation aufsetzen — auf der Ersteinrichtungsseite steht
neben „Neu anfangen" der Punkt **„Mit Sicherung fortsetzen"**. Datei hochladen, Passwort
eingeben, fertig. Danach meldet man sich mit den *bisherigen* Zugangsdaten an, denn die
Benutzer stecken mit in der Sicherung.

Eingespielt wird der Inhalt in die laufende Datenbank, statt die Datei auszutauschen. Das
spart den Neustart und hat einen nützlichen Nebeneffekt: übernommen werden nur Spalten, die es
hier auch gibt — eine **ältere Sicherung wächst dadurch automatisch mit** und bekommt
anschließend fehlende Dinge wie die QR-Token nachgetragen.

Der Punkt ist nur sichtbar, solange **kein Zugang existiert**. Eine laufende Installation
lässt sich damit also nicht überschreiben.

**Von Hand** geht es auch — erst entschlüsseln, dann die Datei an ihren Platz legen:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in spinte-2026-07-27-2241.db.enc -out spinte.db

sudo systemctl stop jf-spinte
cp spinte.db /opt/jf-spinte/data/spinte.db
rm -f /opt/jf-spinte/data/spinte.db-wal /opt/jf-spinte/data/spinte.db-shm
sudo systemctl start jf-spinte
```

Die beiden Dateien `-wal` und `-shm` müssen weg, sonst mischt SQLite alte Änderungen in den
zurückgespielten Stand.

**Automatisch sichern** geht über die API (siehe unten). Die Datei gehört auf ein anderes
Gerät — bei einem Defekt der SD-Karte wäre sie sonst mit weg.

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

## Datensicherung

Alles steckt in einer einzigen SQLite-Datei. Der Jugendwart findet die Sicherung im Menü
hinter dem eigenen Namen unter **Datensicherung** — ein Klick erzeugt einen frischen Abzug
und lädt ihn als `spinte-2026-07-27-2241.db` herunter.

Die Sicherung entsteht über die **Sicherungsfunktion von SQLite**, nicht durch Kopieren der
Datei. Das ist wichtig: die Datenbank läuft im WAL-Modus, ein Teil der Änderungen steht in
`spinte.db-wal` und noch nicht in `spinte.db`. Ein einfaches `cp` liefert deshalb einen
unvollständigen Stand. Die Software darf während der Sicherung weiterlaufen.

**Zurückspielen** — Dienst anhalten, Datei ersetzen, die WAL-Reste entfernen, starten:

```bash
sudo systemctl stop jf-spinte
cp spinte-2026-07-27-2241.db /opt/jf-spinte/data/spinte.db
rm -f /opt/jf-spinte/data/spinte.db-wal /opt/jf-spinte/data/spinte.db-shm
sudo systemctl start jf-spinte
```

Die beiden Dateien `-wal` und `-shm` müssen weg, sonst mischt SQLite alte Änderungen in den
zurückgespielten Stand.

**Automatisch sichern** geht über die API (siehe unten) — die Datei gehört auf ein anderes
Gerät, bei einem Defekt der SD-Karte wäre sie sonst mit weg. Sie enthält Namen und
Geburtsdaten der Jugendlichen und gehört damit nicht in eine offene Cloud.

## API

Andere Systeme greifen über `/api/v1/` zu. Zugänge legt der Jugendwart im Menü unter
**API-Zugänge** an; der Schlüssel wird **einmalig** angezeigt, gespeichert wird nur seine
Prüfsumme. Jeder Zugang darf entweder `nur lesen` oder `lesen und schreiben`.

Der Schlüssel gehört in die Kopfzeile — beide Schreibweisen funktionieren:

```bash
curl -k -H "X-API-Key: jfw_…"           https://jfwpi.fritz.box/api/v1/
curl -k -H "Authorization: Bearer jfw_…" https://jfwpi.fritz.box/api/v1/
```

`GET /api/v1/` listet alle Endpunkte auf. Die Felder heißen deutsch wie die Oberfläche.

### Lesen

| Endpunkt | liefert |
|---|---|
| `GET /status` | Zahlen im Überblick |
| `GET /spinte`, `/spinte/:id` | Spinte, Detail mit Inhalt |
| `GET /mitglieder?alle=1` | Mitglieder (`alle=1` inkl. ausgetretene) |
| `GET /ausruestung?art=&groesse=&spint=&lagerort=&nummer=&ausgemustert=1` | Ausrüstung, gefiltert |
| `GET /ausruestung/:id` | ein Teil |
| `GET /lagerorte`, `/lagerorte/:id` | Lagerorte, Detail mit Zusammenfassung |
| `GET /aufgaben?status=offen\|erledigt\|abgebrochen\|alle` | Aufgaben |
| `GET /arten` | Ausrüstungsarten mit Größen und Barcode-Präfix |
| `GET /groessen` | Größenschemata mit ihren Reihen |
| `GET /stammdaten` | Name der Wehr, Abteilung, Leitspruch, ob ein Logo hinterlegt ist |
| `GET /suche?q=Jacke+164` | Suche über alles |
| `GET /sicherung` | Datensicherung als `.db.enc` (Passwort in `X-Sicherung-Passwort`) |
| `GET /sicherung/info` | Größe und Umfang des Bestands |

Bei `nummer=` greift der Barcode-Präfix: `?nummer=172` findet auch `112000172`.

### Schreiben

| Endpunkt | Zweck |
|---|---|
| `POST /ausruestung` | Teile anlegen (`art`, `groesse`, `inventarnummer`, `anzahl`, `spint_id`/`lagerort_id`) |
| `PATCH /ausruestung/:id` | Größe, Nummer, Zustand, Notiz oder Ablageort ändern |
| `POST /aufgaben` | Bestellung oder Tauschwunsch anlegen |
| `PATCH /aufgaben/:id` | Status auf `offen`, `erledigt` oder `abgebrochen` setzen |
| `POST /arten` | Ausrüstungsart anlegen |
| `PATCH /arten/:id` | Art ändern (Name, Größenschema, Barcode-Präfix, stilllegen) |
| `DELETE /arten/:id` | Art löschen (nur ohne zugehörige Teile) |
| `POST /groessen` | Größenschema anlegen |
| `PUT /groessen/:schema` | Größenreihe eines Schemas ersetzen |
| `DELETE /groessen/:schema` | Schema löschen (nur, wenn keine Art es benutzt) |
| `PATCH /stammdaten` | Name der Wehr, Abteilung oder Leitspruch ändern |

Größen ersetzen — die Reihenfolge in der Liste bestimmt, was „eine Nummer größer" ist:

```bash
curl -k -X PUT -H "X-API-Key: jfw_…" -H "content-type: application/json" \
  -d '{"gruppen":[{"gruppe":"Körpergröße","groessen":["116","122","128"]},
                  {"gruppe":"Konfektion","groessen":["44","46"]}]}' \
  https://jfwpi.fritz.box/api/v1/groessen/bekleidung
```

### Umlaute

Die API nimmt **nur gültiges UTF-8** an. Kommt etwas anderes, gibt es `400` mit Angabe des
Feldes — statt dass „Doppelgrößen“ still als „Doppelgr??en“ in der Datenbank landet. Das ist
kein theoretischer Fall: genau so sind die Größenschemata einmal zerlegt worden, weil eine
Shell die Umlaute als Windows-1252 verschickt hat. Rückgängig machen lässt sich das nicht,
das Byte ist weg.

Wer sich nicht sicher ist, welche Kodierung sein Werkzeug verwendet, schreibt Umlaute als
`\u`-Escape — das ist reines ASCII und kommt garantiert heil an:

```bash
curl -k -X POST -H "X-API-Key: jfw_…" -H "content-type: application/json" \
  -d '{"schema":"jacke","bezeichnung":"Jacke (Doppelgrößen)",
       "gruppen":[{"gruppe":"Körpergröße","groessen":["146/152"]}]}' \
  https://jfwpi.fritz.box/api/v1/groessen
```

Die Prüfungen der Oberfläche gelten auch hier: doppelte Inventarnummern werden mit `409`
abgelehnt, und eine unbekannte Größe liefert `409` samt Vorschlag:

```json
{ "fehler": "Die Größe „162“ gibt es bei Jacke nicht.",
  "vorschlag": "164",
  "hinweis": "Mit \"groesse_ok\": true trotzdem übernehmen." }
```

Änderungen über die API landen im Verlauf, gekennzeichnet als `API: <Name des Zugangs>`.

### Sicherung auf Knopfdruck (Windows)

Im Projektordner liegt **`Sicherung holen.cmd`**. Doppelklick genügt — die Sicherung landet
verschlüsselt in einem Ordner auf diesem Rechner.

Beim **ersten** Start richtet sich das Skript ein und fragt drei Dinge:

1. Adresse des Pi (Vorgabe `jfwpi.fritz.box`)
2. Passwort für die Sicherung — **das wählst du hier, und ohne dieses Passwort ist die
   Sicherung später nicht zu öffnen**
3. Zielordner und wie viele Sicherungen aufgehoben werden (Vorgabe 14)

Den API-Schlüssel nimmt es automatisch aus `api.txt`, falls die Datei danebenliegt.

Danach ist jeder weitere Doppelklick ein einziger Klick: Sicherung holen, prüfen, ablegen,
alte aufräumen.

**Wo die Zugangsdaten liegen:** in `%LOCALAPPDATA%\jf-spintverwaltung\sicherung.json`,
verschlüsselt mit der Windows-Datenschutzfunktion (DPAPI). Sie lassen sich nur von *diesem*
Benutzerkonto auf *diesem* Rechner wieder lesen — im Klartext steht dort nichts.

**Zertifikat wird festgenagelt:** Beim Einrichten merkt sich das Skript den Fingerabdruck des
Pi-Zertifikats und vergleicht ihn bei jedem Lauf. Ändert er sich, bricht es ab, statt
blind weiterzumachen. Wurde das Zertifikat absichtlich neu erstellt, einmal neu einrichten:

```
"Sicherung holen.cmd" -Einrichten
```

**Für die Aufgabenplanung** (automatisch, ohne Fenster):

```
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Dev\jugendfeuerwehr\scripts\sicherung-holen.ps1" -Still
```

Rückgabewert 0 = geklappt, 1 = Fehler, 2 = Zertifikat hat sich geändert.

### Tägliche Sicherung einrichten (Linux/macOS)

```bash
curl -k -H "X-API-Key: jfw_…" \
  -H "X-Sicherung-Passwort: DeinSicherungsPasswort" \
  -o "spinte-$(date +%F).db.enc" \
  https://jfwpi.fritz.box/api/v1/sicherung
```

Dafür genügt ein Zugang mit `nur lesen`. Das Passwort steht bewusst in einer Kopfzeile und
nicht im Adressteil — sonst landete es in jedem Protokoll. **Ohne Passwort gibt es die
Sicherung nicht**, auch nicht über die API. Das `-k` ist nötig, weil das Zertifikat
selbstsigniert ist.

## Barcode-Präfix

Auf den Etiketten einer Ausrüstungsart steht meist derselbe Anfang — im Gerätehaus etwa
`KKJF.1202.` bei den Helmen und `112000` bei Jacken und Hosen. Trägt man diesen Anfang unter
**Arten & Größen** je Art ein, genügt beim Eintippen der hintere Teil:

| Art | Präfix | Stellen | Eingabe | wird zu |
|---|---|---|---|---|
| Jacke | `112000` | 3 | `172` | `112000172` |
| Jacke | `112000` | 3 | `12` | `112000012` |
| Helm | `KKJF.1202.` | — | `77` | `KKJF.1202.77` |

**Stellen** füllt den eingetippten Rest mit Nullen auf. Bleibt das Feld leer, wird nicht
aufgefüllt und die Ergänzung greift bis drei Stellen.

Unverändert bleibt alles, was schon den Präfix trägt, länger als die eingestellte Stellenzahl
ist oder Buchstaben enthält — **eine gescannte Nummer geht also immer unberührt durch**.
Ergänzt wird beim Anlegen, beim Bearbeiten, bei der Kontrolle vor dem Tausch und beim Scannen
über die Tastatur (`/scannen` findet auch die Kurznummer).

Arten ohne Präfix bleiben, wie sie sind.

## Größen

Jede Ausrüstungsart hat ihr eigenes Größenschema — Handschuhe zählen anders als Hosen.
Vorbelegt sind drei Reihen, änderbar unter **Ausrüstungsarten**:

| Schema | Größen |
|---|---|
| Kleidung (Jacke, Hose) | Körpergröße `116 … 176`, danach Konfektion `44 … 70` |
| Handschuhe | `6 … 12` |
| Schuhe | `30 … 50` |

Arten ohne Schema (z. B. Helm, der keine Größe führt) nehmen jede Eingabe an.

### Der Übergang 176 → 44

Kinder- und Jugendgrößen sind die **Körpergröße in Zentimetern** und laufen in
Sechserschritten. Erwachsenen-Konfektionsgrößen entsprechen etwa dem **halben Brustumfang**
und laufen in Zweierschritten. Zwei verschiedene Systeme also — Jugendfeuerwehr-Bekleidung
wird bis 170/176 als Körpergröße geführt, danach beginnen die Konfektionsgrößen.

In der Größenreihe steht deshalb die **44 direkt hinter der 176**. „Eine Nummer größer" als
176 ergibt 44, nicht 182. Für einen schlanken Jugendlichen von 176 cm passt Konfektion 44–48
(Brustumfang 86–97 cm).

Führt eure Wehr auch die Jugendgrößen 182 und 188, lassen sie sich unter
*Ausrüstungsarten → Größen* einfach vor der 44 ergänzen. **Die Reihenfolge in der Liste
bestimmt, was „eine Nummer größer" bedeutet.**

Quellen: [Kindergrößen](https://www.blitzrechner.de/kindergroessen/),
[Konfektionsgrößen](https://www.blitzrechner.de/konfektionsgroessen/),
[Größentabellen Kinder-/Jugendfeuerwehr](https://shop.murer-feuerschutz.de/gr%C3%B6%C3%9Fentabellen-feuerwehrdienstbekleidung-kinder-und-jugendfeuerwehr),
[Jugendfeuerwehr-Bundhose](https://www.feuerwehrversand.de/9/pid/7140/apg/176/Jugendfeuerwehr-Bundhose.htm),
[Handschuhgrößen](https://www.keiler.net/service/groesse-finden/)

### Wenn eine Größe nicht existiert

Wird eine Größe eingetippt, die es für diese Art nicht gibt, fragt die Software nach:

> Die Größe **162** gibt es bei **Jacke** nicht. Meintest du **164** (Körpergröße)?
> [164 verwenden] [162 trotzdem übernehmen] [Abbrechen]

Der Vorschlag ist die nächstliegende gültige Größe. Wer die Eingabe für richtig hält, kann
sie behalten — geblockt wird nichts, es wird nur nachgefragt. Dieselbe Rückfrage greift beim
Bearbeiten und bei der Wunschgröße im Tausch-Ablauf.

Damit es gar nicht erst dazu kommt, hängt an jedem Größenfeld eine Auswahlliste mit den
gültigen Größen der gewählten Art.

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
src/sizes.js           Größen prüfen, nächstliegende finden, Nummer größer/kleiner
src/size-catalog.js    Ausgangsbestand der Größenreihen (mit Quellenangaben)
src/barcode.js         Barcode-Präfix an kurze Inventarnummern setzen
src/backup.js          Datensicherung über die SQLite-Sicherungsfunktion
src/api-auth.js        Token für die API prüfen und verwalten
src/backup.js          Sicherung erzeugen und verschlüsseln
src/restore.js         Sicherung entschlüsseln und einspielen
src/tokens.js          Geheimnisse für die QR-Links
src/settings.js        Stammdaten der Wehr und das Logo (in der Datenbank)
src/upload.js          Dateiannahme für Sicherung und Logo
scripts/               Testdaten, HTTPS-Testinstanz, Installation, Deployment, Sicherung
deploy/                Dienst-Datei und polkit-Regel als Vorlage (siehe install-pi.sh)
src/model.js           Abfragen, Bereichs-, Lager- und Aufgabenlogik
src/audit.js           Änderungsprotokoll
src/routes/            eine Datei je Themenbereich
views/                 EJS-Vorlagen
public/                CSS, kleine Skripte, Barcode-Scanner
public/etikett.css     nur für das A4-Etikett (enthält die @page-Regel: quer, randlos)
```

Kein Build-Schritt: Datei ändern, Dienst neu starten, fertig.

`npm test` startet einen eigenen Server mit leerer Datenbank in einem temporären Ordner
und geht die wichtigsten Abläufe durch — Ersteinrichtung, Rollen, Umkleidebereiche,
Spinte, Lagerorte mit Mengenanlage, Barcode-Endpunkt, Tauschen mit und ohne Lagertreffer,
Aufgaben, Suche, QR, Stammdaten mit Logo, A4-Etiketten und öffentlicher Lesezugriff.
Die echte Datenbank wird nicht angefasst.

Auch das Herunterfahren wird geprüft: der Abschaltbefehl lässt sich über `ABSCHALT_BEFEHL`
austauschen, im Test durch ein Skript, das eine Datei anlegt statt den Rechner abzuschalten.
So läuft der ganze Weg durch — Rechte, Token, Protokolleintrag und Fehlerfall —, ohne dass
ein Testlauf den Rechner mitnimmt.
