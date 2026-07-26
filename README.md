# Spintverwaltung Jugendfeuerwehr

Lokale Verwaltung von Spinten, Mitgliedern und Einsatzkleidung. An jedem Spint hängt ein
QR-Code, der auf die Detailseite dieses Spints im Vereins-WLAN zeigt. Läuft komplett auf
einem Raspberry Pi, ohne Internet und ohne Cloud.

## Was die Seiten können

| Seite | Adresse | Wer |
|---|---|---|
| Spint-Detail (Ziel des QR-Codes) | `/spint/7` | alle im WLAN, nur lesen |
| Übersicht aller Spinte | `/` | alle |
| Lager (Ausrüstung ohne Spint) | `/lager` | alle lesen, Betreuer ändern |
| Mitglieder | `/mitglieder` | alle lesen, Betreuer ändern |
| Suche über alles | `/suche` | alle |
| Spint bearbeiten | `/spint/7/bearbeiten` | Betreuer |
| Ausrüstungsarten | `/ausruestungsarten` | Betreuer |
| Ausgemusterte Teile | `/ausgemustert` | Betreuer |
| QR-Etiketten drucken | `/qr` | Betreuer |
| Änderungsverlauf | `/verlauf` | Betreuer |
| Umkleidebereiche | `/bereiche` | **nur Jugendwart** |
| Betreuer verwalten | `/betreuer` | **nur Jugendwart** |

Ein Spint wird über seine interne Nummer (`/spint/<id>`) angesprochen, nicht über die
aufgedruckte Spint-Nummer — denn dieselbe Nummer darf in verschiedenen Umkleidebereichen
doppelt vorkommen. Die id steckt im QR-Code; abtippen muss sie niemand.

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

### Einstellungen (Umgebungsvariablen)

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `3000` | Port des Webservers |
| `HOST` | `0.0.0.0` | Netzwerkschnittstelle |
| `SESSION_SECRET` | fester Vorgabewert | **auf dem Pi unbedingt setzen**, sonst sind Sitzungs-Cookies fälschbar |
| `DATA_DIR` | `./data` | Ablageort der Datenbank |
| `BASE_URL` | Adresse der Anfrage | Adresse, die in den QR-Codes steht |

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

Das Lesen der Spint-Seiten ist bewusst ohne Anmeldung möglich, damit ein QR-Scan sofort
etwas anzeigt. Damit sind Namen und Kleidergrößen der Jugendlichen für jeden im WLAN
sichtbar. Wenn das nicht gewollt ist: Gastnetz vom Vereinsnetz trennen.

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
- **Ausrüstungsstück** — liegt in genau einem Spint oder im Lager (kein Spint).
  Ausgemusterte Teile verschwinden aus allen Listen, bleiben aber unter `/ausgemustert`
  auffindbar und lassen sich zurückholen.
- **Ausrüstungsart** — Jacke, Helm, … Legt fest, ob Größe und Inventarnummer geführt
  werden. Eine Art mit vorhandenen Teilen lässt sich nicht löschen, nur stilllegen.

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
src/model.js           Abfragen, Bereichs- und Geschlechtslogik
src/audit.js           Änderungsprotokoll
src/routes/            eine Datei je Themenbereich
views/                 EJS-Vorlagen
public/                CSS und ein kleines Skript
```

Kein Build-Schritt: Datei ändern, Dienst neu starten, fertig.

`npm test` startet einen eigenen Server mit leerer Datenbank in einem temporären Ordner
und geht die wichtigsten Abläufe durch — Ersteinrichtung, Rollen, Spint anlegen,
Ausrüstung ein- und auslagern, Suche, QR, öffentlicher Lesezugriff. Die echte Datenbank
wird dabei nicht angefasst.
