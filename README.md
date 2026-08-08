# JF-Verwaltung — Technische Dokumentation

Lokale Verwaltung von Spinten, Ausrüstung, Anwesenheit und Übungseinteilung für eine
Jugendfeuerwehr. Läuft autark auf einem Raspberry Pi im Vereins-WLAN, ohne Cloud und ohne
Internet.

Dieses Dokument richtet sich an alle, die die Software **einrichten und betreiben**:
Architektur, Installation, Konfiguration, Betrieb, Sicherung, Datenmodell, API und Tests.

> **Für Betreuer und Jugendwarte:** Die Bedienung der Oberfläche — Anwesenheit erfassen,
> Kleidung tauschen, Einteilung, Etiketten drucken — steht im
> **[Handbuch](docs/handbuch.md)** und nicht hier.

Beide Dokumente liegen auch in der laufenden Installation unter `/handbuch` und werden mit
jedem Update mit aktualisiert.

> **Für andere Wehren:** Das hier ist für *eine* Jugendfeuerwehr gebaut und läuft dort im
> Alltag. Wer es übernehmen will, klont das Repo und folgt Abschnitt 4. Alles
> Wehr-Spezifische — Name, Logo, Ausrüstungsarten, Größenreihen, Barcode-Präfixe — steht in
> der Oberfläche und nicht im Code.
>
> **Nicht ins Internet stellen.** Die Software ist für ein abgeschottetes Vereins-WLAN
> gedacht: keine Verschlüsselung der Datenbank im Betrieb, keine Angriffserkennung, keine
> Ratenbegrenzung an der Anmeldung. Sie enthält Namen, Geburtsdaten und Einschätzungen von
> Kindern. Auf einem öffentlich erreichbaren Server hat sie nichts verloren.

---

## Inhalt

1. [Überblick](#1-überblick)
2. [Architektur](#2-architektur)
3. [Rechte- und Sicherheitskonzept](#3-rechte--und-sicherheitskonzept)
4. [Installation](#4-installation)
5. [Konfiguration](#5-konfiguration)
6. [Betrieb](#6-betrieb)
7. [Datensicherung und Wiederherstellung](#7-datensicherung-und-wiederherstellung)
8. [Datenmodell](#8-datenmodell)
9. [API](#9-api)
10. [Entwicklung und Tests](#10-entwicklung-und-tests)
11. [Lizenzen der Abhängigkeiten](#11-lizenzen-der-abhängigkeiten)
12. [Mit KI entwickelt](#12-mit-ki-entwickelt)
13. [Lizenz](#13-lizenz)

---

## 1. Überblick

| Eigenschaft | |
|---|---|
| Betrieb | vollständig lokal auf einem Raspberry Pi, kein Internet nötig |
| Oberfläche | serverseitig gerendert (EJS), für Handy und Tablet gebaut |
| Datenhaltung | eine SQLite-Datei, WAL-Modus |
| Zugriff ohne Anmeldung | ausschließlich die eine per QR-Code aufgerufene Seite |
| Sicherungen | ausnahmslos verschlüsselt (AES-256-CBC, Format `openssl enc`) |
| Aktualisierung | über die Oberfläche, mit automatischem Rückweg |

Kein Build-Schritt: Datei ändern, Dienst neu starten, fertig. Das ist Absicht — auf einem
Pi im Gerätehaus soll niemand eine Werkzeugkette pflegen müssen.

## 2. Architektur

Node.js mit Express, EJS-Vorlagen, SQLite über `better-sqlite3` (synchron, kein
Verbindungspool nötig). Acht direkte Abhängigkeiten.

```
        Vereins-WLAN (kein Internet-Zugang nötig)
                        │  HTTPS, selbstsigniertes Zertifikat
                        ▼
┌─────────────────────────────────────────────────────┐
│ Raspberry Pi                                        │
│                                                     │
│  systemd: jf-spinte.service   (Node, Dienstbenutzer)│
│      │        NoNewPrivileges, ProtectSystem=strict │
│      │        schreibt nur in data/                 │
│      ▼                                              │
│  server.js ─ src/routes/*.js ─ src/model.js         │
│      │                                              │
│      ▼                                              │
│  data/spinte.db  (SQLite, WAL)                      │
│                                                     │
│  systemd: jf-sicherung.timer  nächtliche Sicherung  │
│  systemd: jf-update.path      wartet auf Markierung │
│              └─> scripts/update-helfer.sh (root)    │
└─────────────────────────────────────────────────────┘
```

### Ordnerstruktur

```
server.js              Start, Sitzungen, Router-Reihenfolge, Zugriffsschutz
src/db.js              SQLite öffnen, Schema anwenden, migrieren
src/schema.sql         Tabellen — immer der vollständige, aktuelle Stand
src/migrationen.js     Schema-Fassungen und der Weg von einer zur nächsten
src/model.js           Abfragen, Bereichs-, Lager- und Aufgabenlogik
src/dienst.js          Anwesenheit, Einschätzung, Einteilung mit Funktionen
src/auth.js            Anmeldung, Rollen, CSRF
src/backup.js          Sicherung erzeugen und verschlüsseln
src/restore.js         Sicherung entschlüsseln und einspielen
src/update.js          nach Neuem sehen, Aktualisierung anfordern
src/markdown.js        kleiner Markdown-Übersetzer für /handbuch
src/sizes.js           Größen prüfen, nächstliegende finden
src/size-catalog.js    Ausgangsbestand der Größenreihen (mit Quellenangaben)
src/barcode.js         Barcode-Präfix an kurze Inventarnummern setzen
src/tokens.js          Geheimnisse für die QR-Links
src/settings.js        Stammdaten der Wehr und das Logo (in der Datenbank)
src/routes/            eine Datei je Themenbereich
views/                 EJS-Vorlagen
public/                CSS, kleine Skripte, Barcode-Scanner
deploy/                systemd-Einheiten und polkit-Regel als Vorlage
scripts/               Installation, Deployment, Sicherung, Update, Doku-Bilder
docs/                  Handbuch und Datenbank-Beschreibung
test/                  smoke.mjs (Abläufe) und schema.mjs (Migrationen)
tls/                   Zertifikat und Schlüssel (nicht im Repo)
data/                  Datenbank (nicht im Repo)
```

## 3. Rechte- und Sicherheitskonzept

### Rollen

| Rolle | Darf |
|---|---|
| Betreuer | Spinte, Ausrüstung, Mitglieder, Arten, Anwesenheit, Einschätzung, Einteilung |
| Jugendwart | zusätzlich Zugänge, Rollen, Stammdaten, Sicherung, API-Zugänge, System und Update |
| ohne Anmeldung | **nur** die eine Seite, deren QR-Code gerade gescannt wurde |

Es muss immer mindestens ein aktiver Jugendwart übrig bleiben; die Software verhindert, dass
sich die Wehr aussperrt.

### Zugriff ohne Anmeldung

Ohne Anmeldung ist **alles** gesperrt — keine Übersicht, keine Mitgliederliste, keine Suche,
kein Lagerbestand. Offen sind nur die Anmeldung, statische Dateien, das Logo und die beiden
Token-Adressen aus den QR-Codes.

Deshalb steht im QR-Code nicht die laufende Nummer, sondern ein zufälliger Token
(`/s/t8exz96cepde` statt `/s/1`): 12 Zeichen aus einem 31-stelligen Alphabet, rund 59 Bit.
Mit fortlaufenden IDs könnte sonst jeder im WLAN von einem Etikett auf alle anderen
schließen und hätte Namen und Kleidergrößen aller Jugendlichen.

Der Schutz ist als **Positivliste** in `server.js` gebaut: gesperrt ist alles, was nicht
ausdrücklich freigegeben ist. Eine neu hinzugefügte Seite ist damit automatisch geschützt,
statt versehentlich offen zu stehen.

### Einschätzungen

Die Drei-Achsen-Einschätzung der Jugendlichen ist der heikelste Datenbestand. Sie steht in
einer eigenen Tabelle, erscheint **nicht** auf den QR-Seiten und wird von der API **nicht**
herausgegeben. Im Änderungsverlauf steht, *dass* jemand eine Einschätzung geändert hat,
nicht *welche Werte*. In der Oberfläche sind die Werte erst nach einem Klick sichtbar.

### Härtung des Dienstes

`deploy/jf-spinte.service` setzt `NoNewPrivileges=true`, `ProtectSystem=strict`,
`ProtectHome=true` und `PrivateTmp=true` und gibt als einzigen beschreibbaren Pfad `data/`
frei. Der Dienst kann damit kein `sudo` starten — deshalb läuft das Herunterfahren über
polkit (Abschnitt 6) und die Aktualisierung über einen getrennten Helfer.

### Was die Software nicht leistet

* Das Zertifikat ist **selbstsigniert**. Jedes Gerät bestätigt es einmal. Gegen jemanden,
  der bereits im Netz sitzt und sich dazwischenschaltet, hilft das nicht.
* Die **Datenbank ist im Betrieb unverschlüsselt**. Wer die Speicherkarte in die Hand
  bekommt, liest sie. Verschlüsselt sind nur die Sicherungen.
* **Keine Ratenbegrenzung** an der Anmeldung, keine Angriffserkennung, keine Sperre nach
  Fehlversuchen.

Deshalb gehört der Pi ins Vereinsnetz und nicht ins Internet — kein Portfreigeben am Router.
Wer die Seite von außen braucht, setzt ein VPN davor.

## 4. Installation

### Voraussetzungen

* Raspberry Pi (im Einsatz: Pi 5, Debian 13 trixie, arm64) oder ein beliebiger Linux-Rechner
* Node.js 18 oder neuer (auf dem Pi läuft 20; `scripts/doku-bilder.js` braucht 22)
* `git`, `openssl`, `curl`

### Entwicklung

```bash
git clone https://github.com/Guselmur2/jf-verwaltung.git
cd jf-verwaltung
npm ci
npm start
```

Danach `http://localhost:3000`. Beim ersten Aufruf führt die Software durch die
Ersteinrichtung. Für den Barcode-Scan am Handy braucht der Browser HTTPS:

```bash
npm run https
```

Ein Testbestand zum Ausprobieren:

```bash
npm run testdaten
```

### Raspberry Pi

```bash
sudo sh scripts/install-pi.sh
```

Das Skript ist wiederholbar — Datenbank, Zertifikat und Sitzungsgeheimnis bleiben erhalten.
Was es tut:

| Schritt | |
|---|---|
| Pakete | `nodejs`, `npm`, `openssl`, `polkitd`, `avahi-daemon`, `git` |
| Software | nach `/opt/jf-spinte` kopieren, Abhängigkeiten installieren |
| Zertifikat | selbstsigniert für `<name>.fritz.box`, `<name>.local`, `localhost`, aktuelle IP |
| Dienst | `jf-spinte.service` erzeugen, Sitzungsgeheimnis würfeln, starten |
| Herunterfahren | polkit-Regel einspielen |
| Sicherung | `jf-sicherung.timer` bereitlegen |
| Update | `jf-update.path` einschalten |
| Probe | antwortet die Oberfläche? ist das Herunterfahren erlaubt? |

Anpassbar über Umgebungsvariablen:

```bash
sudo BENUTZER=pi ORDNER=/opt/jf-spinte ADRESSE=spinte.fritz.box sh scripts/install-pi.sh
```

### WLAN einrichten (ohne Monitor und Tastatur)

Eine zweite Verbindung anlegen, solange der Pi noch am alten Netz hängt — danach findet er
sich am neuen Ort von selbst ein:

```bash
sudo nmcli connection add type wifi con-name Feuerwehr ifname wlan0 ssid "FRITZ!Box 7530 CA"
sudo nmcli connection modify Feuerwehr wifi-sec.key-mgmt wpa-psk wifi-sec.psk "DAS-WLAN-PASSWORT"
sudo nmcli connection up Feuerwehr
```

Zwei Stolpersteine aus der Praxis: die **SSID unterscheidet Groß- und Kleinschreibung**
(`FRITZ!Box` ist nicht `FRITZ!BOX`), und ohne das abschließende `up` bleibt die Verbindung
angelegt, aber inaktiv.

### Eigene Angaben: `deploy.config`

Hostname, Benutzername und Schlüsselpfad des eigenen Pi stehen **nicht** im Repo:

```bash
cp deploy.config.beispiel deploy.config
```

Die Datei ist von der Versionsverwaltung ausgeschlossen. `scripts/deploy-pi.sh` liest sie
automatisch; alternativ gelten die Umgebungsvariablen `PI_HOST`, `PI_USER`, `PI_KEY`.

## 5. Konfiguration

Die Konfiguration erfolgt über **Umgebungsvariablen**; auf dem Pi stehen sie in
`/etc/systemd/system/jf-spinte.service`. Eine `.env`-Datei wird nicht gelesen.

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `3000` | Port des Webservers (auf dem Pi 443) |
| `HOST` | `0.0.0.0` | Netzwerkschnittstelle |
| `SESSION_SECRET` | fester Vorgabewert | **auf dem Pi unbedingt setzen**, sonst sind Sitzungs-Cookies fälschbar |
| `DATA_DIR` | `./data` | Ablageort der Datenbank |
| `BASE_URL` | Adresse der Anfrage | Adresse, die in den QR-Codes steht |
| `TLS_KEY` / `TLS_CERT` | leer | Pfade zu Schlüssel und Zertifikat. **Nur wenn beide gesetzt sind, läuft die Seite über HTTPS** — sonst über HTTP, und der Barcode-Scan geht dann nur auf `localhost` |
| `ABSCHALT_BEFEHL` | `systemctl poweroff --no-block` | Befehl hinter „Pi herunterfahren" |
| `SICHERUNG_ZIEL` | `/mnt/jf-sicherung` | wo `/restore` nach Sicherungen sucht |
| `GIT_ORDNER` | Programmordner | Arbeitsverzeichnis, aus dem aktualisiert wird |
| `UPDATE_ZWEIG` | `main` | Git-Zweig, aus dem geholt wird |
| `UPDATE_MARKE` | `/run/jf-spinte/update-anfordern` | Markierung, die den Helfer anstößt |
| `UPDATE_STATUS` | `<DATA_DIR>/update-status.json` | Ergebnis der letzten Aktualisierung |
| `UPDATE_ABGLEICH` | `<DATA_DIR>/update-abgleich.json` | Ergebnis der letzten Suche |

API-Zugänge sind **keine** Umgebungsvariable: die Token werden in der Oberfläche angelegt
und liegen als Hash in der Datenbank.

## 6. Betrieb

### Dienst

```bash
sudo systemctl status jf-spinte
sudo systemctl restart jf-spinte
journalctl -u jf-spinte -n 50 --no-pager
```

### Hostname statt IP

Die Adresse in den QR-Codes sollte der **Hostname** sein (`https://jfwpi.fritz.box`), nicht
die IP: nach einem Routertausch oder einer neuen DHCP-Vergabe zeigen sonst alle gedruckten
Etiketten ins Leere. Funktioniert der Name auf dem Handy nicht, hilft es meist, privates DNS
abzuschalten — oder ersatzweise `<name>.local` (avahi).

### Herunterfahren über polkit

Der Dienst läuft mit `NoNewPrivileges=true` und kann deshalb **kein sudo starten** — sudo
ist ein setuid-Programm, und genau das unterbindet das Flag. Stattdessen spricht
`systemctl poweroff` über D-Bus mit systemd-logind; eine polkit-Regel
(`deploy/49-jf-spinte-poweroff.rules`) gibt genau diese eine Aktion für genau diesen
Benutzer frei. Die Weboberfläche bekommt damit die Erlaubnis zum Abschalten, ohne
irgendwelche Root-Rechte zu erhalten.

Geordnet herunterzufahren ist wichtiger, als es klingt: reißt man dem Pi im Betrieb den
Strom weg, kann die Speicherkarte Schaden nehmen und damit der ganze Bestand.

### Aktualisierung

Drei Wege:

**1. Über die Oberfläche** (empfohlen) — *System → Zur Update-Seite → Nach Updates suchen →
Jetzt aktualisieren*. Der Ablauf: Sicherung ziehen, neuen Stand holen, `npm ci`, Dienst neu
starten, prüfen, ob die Seite antwortet. Klappt das nach zwei Versuchen nicht, setzt der
Helfer per `git reset --hard` auf den vorherigen Stand zurück.

**2. Auf dem Pi per SSH**

```bash
sudo sh /opt/jf-spinte/scripts/update-pi.sh
```

**3. Vom Projektordner aus** (überträgt den lokalen Stand per SSH)

```bash
bash scripts/deploy-pi.sh
```

#### Einmalige Umstellung auf Git

Eine mit `install-pi.sh` eingerichtete Installation enthält kein `.git`. Das Umstell-Skript
liegt deshalb anfangs auch nicht auf dem Pi und wird zuerst geholt — **beides in der
SSH-Sitzung auf dem Pi**, nicht in der Windows-Eingabeaufforderung:

```bash
curl -fsSL https://raw.githubusercontent.com/NAME/REPO/main/scripts/auf-git-umstellen.sh -o /tmp/auf-git-umstellen.sh
sudo sh /tmp/auf-git-umstellen.sh https://github.com/NAME/REPO.git
```

Datenbank, Zertifikat, `node_modules` und `deploy.config` bleiben unberührt.

#### Warum der Dienst nicht selbst aktualisiert

Die Anwendung **kann sich nicht selbst neu starten** — `systemctl restart` würde den Prozess
abschießen, der den Befehl gerade absetzt. Und wäre nach einem misslungenen Update die
Anwendung hin, könnte ausgerechnet sie keine Rettungsseite mehr ausliefern.

Sie legt deshalb nur eine Markierung unter `/run/jf-spinte/` ab. Eine systemd-`.path`-Einheit
sieht diese Datei und startet `scripts/update-helfer.sh` als root, **außerhalb** des
Dienstes. `/run` ist eine RAM-Platte: nach einem Stromausfall mitten im Vorgang ist die
Anforderung weg und löst beim nächsten Start nicht versehentlich ein Update aus.

Aus demselben Grund läuft auch die **Suche nach Updates** über den Helfer. `git fetch` müsste
`.git/FETCH_HEAD` schreiben, der Dienst darf aber außer `data/` nirgends schreiben.
`.git` in `ReadWritePaths` freizugeben wäre keine Lösung: wer dort schreiben kann, kann die
Herkunftsadresse ändern oder Objekte unterschieben — und der Helfer würde sie anschließend
als root einspielen und `npm ci` darauf laufen lassen. Eine Lücke in der Weboberfläche würde
damit zu Rootzugriff.

#### Warum `npm ci` und nicht `npm install`

`npm install` darf stillschweigend neuere Fassungen holen. `npm ci` installiert genau das,
was in `package-lock.json` steht — mit **Prüfsumme je Paket**. Aus 8 direkten
Abhängigkeiten werden über 150 Pakete; würde eines davon gekapert und neu veröffentlicht,
fiele es beim Prüfsummenvergleich auf.

#### Wo das eigentliche Risiko liegt

| Risiko | Gegenmittel |
|---|---|
| GitHub-Konto übernommen | Zwei-Faktor-Anmeldung, am besten Passkey |
| Pull Request ungelesen zusammengeführt | Diff lesen, bei Fremdbeiträgen immer |
| Gekapertes npm-Paket | `npm ci` mit Prüfsummen, kein blindes `npm update` |
| Update ungeprüft eingespielt | die Update-Seite zeigt die Änderungen vorher an |

Zur Einordnung: `npm ci` läuft als Dienstbenutzer, und der darf per `sudo` ohne Passwort
alles. Ein bösartiges Installationsskript hätte damit den ganzen Pi. Der Dienst selbst ist
dagegen abgesichert — die Lücke ist der Update-Vorgang, nicht der Betrieb.

## 7. Datensicherung und Wiederherstellung

Der Abzug entsteht über die **Sicherungsfunktion von SQLite**, nicht durch Kopieren der
Datei: die Datenbank läuft im WAL-Modus, ein Teil der Änderungen steht in `spinte.db-wal`
und noch nicht in `spinte.db`. Ein einfaches `cp` liefert deshalb einen unvollständigen
Stand. Die Software darf während der Sicherung weiterlaufen.

Sicherungen sind **ausnahmslos verschlüsselt** (AES-256-CBC, Schlüssel über PBKDF2 mit
10 000 Runden). Das Passwort wird nirgends gespeichert. Verwendet wird das Format von
`openssl enc`, damit sich eine Sicherung auch ohne diese Software öffnen lässt:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in spinte-2026-08-08-2241-s2.db.enc -out spinte.db
```

Der Dateiname trägt Datum, Uhrzeit und die **Schema-Fassung** (`-s2`).

### Nächtliche Sicherung auf einen USB-Stick

Der Timer kommt aus `install-pi.sh`; es fehlen nur Ziel und Passwort. Den Stick fest
einhängen — der Desktop-Automount unter `/media/...` hilft nachts nicht:

```
UUID=XXXX-XXXX  /mnt/jf-sicherung  vfat  defaults,nofail,noatime,uid=1000,gid=1000,umask=0077,x-systemd.device-timeout=10  0  0
```

`nofail` ist wichtig: fehlt der Stick, bootet der Pi trotzdem durch. Dann:

```bash
sudo mkdir -p /etc/jf-spinte
sudo sh -c 'printf "%s\n" "DEIN-PASSWORT" > /etc/jf-spinte/sicherung.passwort'
sudo chmod 600 /etc/jf-spinte/sicherung.passwort
sudo systemctl daemon-reload && sudo mount -a
sudo systemctl enable --now jf-sicherung.timer
sudo systemctl start jf-sicherung.service   # einmal zur Probe
```

Läuft um 3:30 Uhr und hebt die letzten 30 Stände auf. Gesichert wird zweierlei, beides mit
demselben Passwort:

| Datei | Inhalt |
|---|---|
| `spinte-JJJJ-MM-TT-hhmm-sN.db.enc` | die Datenbank |
| `wlan-JJJJ-MM-TT-hhmm.tar.gz.enc` | die WLAN-Zugangsdaten |

Die WLAN-Daten gehen mit, weil nach einer Neuinstallation sonst ausgerechnet der Netzzugang
fehlt. Der Timer läuft als root, weil die Zugangsdaten sonst niemand lesen darf; die
Datenbank-Sicherung reicht das Skript an den Dienstbenutzer weiter. Fehlt der Stick, weicht
die Sicherung auf `data/sicherungen` aus und meldet das als Warnung.

> **Was das nicht leistet:** Passwort und Sicherung liegen beide auf dem Pi. Wer das Gerät
> mitnimmt, hat beides. Der Schutz wirkt für den Stick, wenn man ihn herausnimmt und
> woanders hinlegt. Die von Hand heruntergeladene Sicherung darf ruhig ein anderes Passwort
> haben.

### Zurückspielen

| Lage | Weg |
|---|---|
| leere Installation | Ersteinrichtung → „Mit Sicherung fortsetzen" |
| laufende Installation | `/restore` (nur Jugendwart) |
| ohne die Software | `openssl enc -d …`, dann die Datei bei gestopptem Dienst nach `data/spinte.db` |

Eingespielt wird der **Inhalt** in die laufende Datenbank, statt die Datei auszutauschen.
Übernommen werden nur Spalten, die es in beiden gibt — eine ältere Sicherung wächst dadurch
in das neuere Schema hinein. `/restore` legt vorher den aktuellen Stand als
`…-vor-restore.db.enc` daneben und meldet die Sitzung danach ab.

Beim Zurückspielen von Hand müssen `spinte.db-wal` und `spinte.db-shm` weg, sonst mischt
SQLite alte Änderungen in den zurückgespielten Stand.

### Schema-Fassungen

Jede Sicherung trägt die Fassung des Datenbankschemas. Eine **ältere** Sicherung wird
eingespielt und gehoben, eine **neuere** abgelehnt — sonst fielen die Spalten weg, die die
ältere Software noch nicht kennt, ohne Fehler und ohne Meldung.

Wie die Fassungen gezählt werden, welche Regeln für eine neue Migration gelten und was
bisher dazukam, steht in **[docs/datenbank.md](docs/datenbank.md)**. Diese Datei gehört
inhaltlich zu diesem README; sie steht getrennt, weil sie eine Arbeitsanleitung für
Schema-Änderungen ist und ihre Fassungsliste mit jeder Migration wächst.

## 8. Datenmodell

Alles in einer SQLite-Datei. Die wichtigsten Tabellen:

| Tabelle | Inhalt |
|---|---|
| `members` | Jugendliche: Name, Geburtsdatum, Geschlecht, Telefon, Notiz |
| `areas`, `gender_area` | Umkleidebereiche und die Zuordnung je Geschlecht |
| `lockers` | Spinte: Nummer (nur je Bereich eindeutig), QR-Token, Mitglied |
| `storages` | Lagerorte mit QR-Token, einer davon Standard |
| `equipment` | einzelne Teile: Art, Größe, Inventarnummer, Zustand, Ort |
| `equipment_types` | Arten mit Größenschema und Barcode-Präfix |
| `size_schemes`, `sizes` | Größenreihen, Reihenfolge über `sort_order` |
| `tasks` | Tausch- und Bestellwünsche |
| `termine`, `anwesenheit` | Übungsabende und wer da war |
| `einschaetzung`, `funktion_eignung`, `trennen` | Grundlage der Einteilung |
| `teams`, `team_mitglieder` | gespeicherte Einteilungen je Termin |
| `settings`, `assets` | Stammdaten und Logo |
| `users`, `api_tokens`, `audit_log`, `sessions` | Zugänge, Protokoll, Sitzungen |
| `schema_version` | angewendete Migrationen |

Wo ein Teil liegt, ergibt sich aus zwei Feldern: `locker_id` gesetzt → im Spint,
`storage_id` gesetzt → am Lagerort, beide leer → im Lager ohne Ort. Beides gleichzeitig gibt
es nicht, dafür sorgt der Code.

Beim Löschen geht nichts mit verloren: Wird ein Spint gelöscht, wandert sein Inhalt ins
Lager; tritt ein Mitglied aus, wird sein Spint frei und die Ausrüstung bleibt liegen. Jede
Änderung landet mit Zeitstempel und Name im Verlauf (`/verlauf`); die Zeiten stehen in UTC,
so wie SQLite sie speichert.

### Größenreihen

Kinder- und Jugendgrößen sind die **Körpergröße in Zentimetern** (Sechserschritte),
Erwachsenengrößen die **Konfektion** (Zweierschritte). In der Reihe steht deshalb die **44
direkt hinter der 176** — „eine Nummer größer" als 176 ergibt 44, nicht 182. Die
Reihenfolge in der Liste bestimmt, was „größer" heißt; wer 182 und 188 führt, ergänzt sie
vor der 44. Handschuhe und Schuhe haben eigene Reihen.

Quellen: [Kindergrößen](https://www.blitzrechner.de/kindergroessen/),
[Konfektionsgrößen](https://www.blitzrechner.de/konfektionsgroessen/),
[Größentabellen Kinder-/Jugendfeuerwehr](https://shop.murer-feuerschutz.de/gr%C3%B6%C3%9Fentabellen-feuerwehrdienstbekleidung-kinder-und-jugendfeuerwehr),
[Handschuhgrößen](https://www.keiler.net/service/groesse-finden/)

### Inventarnummern

Eine Inventarnummer gehört zu genau einem Teil; Groß- und Kleinschreibung zählen nicht.
Teile **ohne** Nummer sind ausgenommen — sonst wären Sammelposten unmöglich. Abgesichert ist
das doppelt: im Programm für eine verständliche Meldung und als Regel in der Datenbank.

Enthält eine ältere Datenbank bereits doppelte Nummern, lässt sich die Datenbank-Regel nicht
anlegen. Die Software startet dann trotzdem — man käme sonst an die Daten nicht mehr heran,
um sie zu berichtigen — und meldet die Fälle beim Start:

```
WARNUNG: Diese Inventarnummern sind mehrfach vergeben:
  0001 — 2 Teile
```

### Barcode-Präfix

Je Art lässt sich ein fester Anfang der Inventarnummern hinterlegen (`barcode_prefix`) und
auf wie viele Stellen der eingetippte Rest aufgefüllt wird (`barcode_digits`). Tippt man
`12`, ergänzt die Software daraus die vollständige Nummer.

## 9. API

Unter `/api/v1/`, JSON, Anmeldung über die Kopfzeile `X-API-Key`. Die Zugänge werden in der
Oberfläche unter *API-Zugänge* angelegt; gespeichert wird nur der Hash, im Klartext bekommt
man den Token genau einmal zu sehen. Zwei Rechtestufen: `lesen` und `schreiben`.

**Lesen**

```
GET /api/v1/status
GET /api/v1/spinte            GET /api/v1/spinte/:id
GET /api/v1/mitglieder
GET /api/v1/ausruestung?art=&groesse=&spint=&lagerort=&nummer=&ausgemustert=
GET /api/v1/ausruestung/:id
GET /api/v1/lagerorte         GET /api/v1/lagerorte/:id
GET /api/v1/aufgaben?status=offen|erledigt|abgebrochen|alle
GET /api/v1/arten             GET /api/v1/groessen
GET /api/v1/stammdaten        GET /api/v1/suche?q=
GET /api/v1/sicherung         (Kopfzeile X-Sicherung-Passwort nötig)
```

**Schreiben**

```
POST   /api/v1/ausruestung          PATCH  /api/v1/ausruestung/:id
POST   /api/v1/aufgaben             PATCH  /api/v1/aufgaben/:id
POST   /api/v1/arten                PATCH  /api/v1/arten/:id
DELETE /api/v1/arten/:id            POST   /api/v1/groessen
PUT    /api/v1/groessen/:schema     DELETE /api/v1/groessen/:schema
PATCH  /api/v1/stammdaten
```

Einschätzungen gibt die API nicht heraus — auch nicht über `/mitglieder`.

**Umlaute:** alles ist UTF-8. Eingehende Texte werden geprüft und mit einem Fehler
abgewiesen, wenn sie das Ersatzzeichen U+FFFD enthalten — sonst landen „Doppelgrößen" als
„Doppelgr���en" in der Datenbank, und niemand merkt es rechtzeitig.

## 10. Entwicklung und Tests

```bash
npm test          # smoke.mjs und schema.mjs
npm run test-schema
npm run lizenzen
```

`test/smoke.mjs` startet einen eigenen Server mit leerer Datenbank in einem temporären
Ordner und geht die Abläufe durch — Ersteinrichtung, Rollen, Umkleidebereiche, Spinte,
Lagerorte, Tauschen, Aufgaben, Suche, QR, Etiketten, Anwesenheit, Einschätzung, Einteilung,
Sicherung, Wiederherstellung, Update und Handbuch. Die echte Datenbank wird nicht angefasst.

Herunterfahren und Aktualisierung werden dabei nachgestellt: `ABSCHALT_BEFEHL` zeigt im Test
auf ein harmloses Skript, und `GIT_ORDNER`, `UPDATE_MARKE`, `UPDATE_STATUS` sowie
`UPDATE_ABGLEICH` zeigen in einen temporären Ordner mit einem kleinen Repository. So läuft
der ganze Weg durch, ohne dass ein Testlauf den Rechner mitnimmt oder wirklich aktualisiert.

`test/schema.mjs` prüft die Migrationen gegen `schema.sql`: eine frisch aus `schema.sql`
angelegte Datenbank darf sich nicht mehr verändern, wenn alle Migrationen darauf laufen.
Damit hängen zwei Regeln an einer Prüfung — was eine Migration anlegt, muss auch in
`schema.sql` stehen, und jede Migration muss mehrfach ausführbar sein. Einzelheiten in
[docs/datenbank.md](docs/datenbank.md).

### Bilder für das Handbuch

```bash
npm run doku-daten     # Demo-Bestand mit erfundenen Namen
npm run doku-bilder    # Chrome kopflos über das DevTools-Protokoll
```

Die Bilder landen in `docs/bilder/`. `data-doku/` ist von der Versionsverwaltung
ausgeschlossen — nur das Skript wird mitgeliefert, nicht der Bestand.

## 11. Lizenzen der Abhängigkeiten

`npm run lizenzen` zählt die Pakete durch und meldet alles, was Aufmerksamkeit braucht —
insbesondere Copyleft (GPL, AGPL, SSPL), das sich mit der MIT-Lizenz dieses Projekts nicht
ohne Weiteres verträgt. Stand heute: alles freizügig (MIT, ISC, Apache-2.0, BSD).

`node_modules` ist von der Versionsverwaltung ausgeschlossen. Das Repo gibt die fremden
Pakete also gar nicht weiter — sie holt `npm` beim Installieren direkt von der Quelle, und
die üblichen Weitergabe-Pflichten entstehen hier nicht. Anders wäre es bei einem fertigen
SD-Karten-Abbild: dann gehört eine Auflistung der enthaltenen Lizenzen dazu.

Die einzige Bibliothek, die an Browser ausgeliefert wird, ist `html5-qrcode` (Apache-2.0)
unter `/vendor`. Sie wird unverändert weitergereicht und trägt ihren Lizenzhinweis selbst.

> **Nicht ins Repo gehört das Logo eurer Wehr.** Das Emblem der Jugendfeuerwehr ist
> geschützt — ihr dürft es führen, ein beliebiger Dritter, der euer Repo klont, nicht. Es
> liegt in der Datenbank und damit unter `data/`, das ausgeschlossen ist. Bitte dabei
> belassen und nicht „zur Bequemlichkeit" als Datei dazulegen.

## 12. Mit KI entwickelt

Diese Software ist in Zusammenarbeit mit einer KI entstanden (Claude von Anthropic). Der
Code, die Tests und der größte Teil der Dokumentation wurden im Dialog geschrieben:
Anforderungen, Entscheidungen und die Erfahrungen aus dem Betrieb kamen aus der
Jugendfeuerwehr, die Umsetzung von der KI.

Das gehört hierher, weil es zwei praktische Fragen berührt:

* **Prüft, was ihr einsetzt.** Das Repo ist öffentlich, der Code lesbar, und es gibt
  automatische Tests. Wer die Software auf einen eigenen Pi mit den Daten eigener Kinder
  stellt, sollte trotzdem selbst hineinsehen — das gilt für KI-Code genauso wie für fremden
  Code von Menschen.
* **Fehler sind trotzdem Fehler.** Was hier läuft, läuft im echten Betrieb einer Wehr und
  ist dort gewachsen: mehrere Sachen in dieser Software gibt es nur, weil im Gerätehaus
  etwas nicht funktioniert hat. Für die Richtigkeit gibt es keine Garantie, weder durch die
  Herkunft des Codes noch durch die Tests.

Die Verantwortung für den Einsatz liegt bei dem, der ihn betreibt — siehe Lizenz.

## 13. Lizenz

[MIT](LICENSE) — benutzen, ändern und weitergeben ausdrücklich erwünscht. Ohne Gewähr; wer
sie einsetzt, ist für seine Daten selbst verantwortlich.
