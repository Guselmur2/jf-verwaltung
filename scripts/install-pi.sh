#!/bin/sh
# Richtet die Spintverwaltung auf einem frischen Raspberry Pi ein.
#
# Auf dem Pi ausfuehren, im entpackten Projektordner:
#
#   sudo sh scripts/install-pi.sh
#
# Der Aufruf darf wiederholt werden: vorhandene Datenbank, Zertifikat und
# Sitzungsgeheimnis bleiben erhalten. Was schon passt, wird uebersprungen.
#
# Optionen (als Umgebungsvariablen):
#   BENUTZER=pi            unter welchem Konto der Dienst laeuft
#   ORDNER=/opt/jf-spinte   wohin die Software gehoert
#   ADRESSE=jfw-pi.fritz.box unter welchem Namen die Handys sie erreichen
#   ZERTIFIKAT_NEU=1        Zertifikat neu ausstellen (z. B. nach einem Umzug)

set -e

BENUTZER="${BENUTZER:-${SUDO_USER:-$(id -un)}}"
ORDNER="${ORDNER:-/opt/jf-spinte}"
RECHNERNAME="$(hostname | tr '[:upper:]' '[:lower:]')"
ADRESSE="${ADRESSE:-$RECHNERNAME.fritz.box}"

QUELLE="$(cd "$(dirname "$0")/.." && pwd)"

sagen() { printf '%s\n' "$*"; }
schritt() { printf '\n-> %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  sagen "Bitte mit sudo starten:  sudo sh scripts/install-pi.sh"
  exit 1
fi

if ! id "$BENUTZER" >/dev/null 2>&1; then
  sagen "Den Benutzer \"$BENUTZER\" gibt es nicht. Mit BENUTZER=... einen anderen waehlen."
  exit 1
fi

sagen ""
sagen "  Spintverwaltung einrichten"
sagen "  -------------------------"
sagen "  Benutzer: $BENUTZER"
sagen "  Ordner:   $ORDNER"
sagen "  Adresse:  https://$ADRESSE"

# ------------------------------------------------------------------ Pakete
schritt "Pakete pruefen"
FEHLT=""
for paket in nodejs npm openssl polkitd avahi-daemon git; do
  dpkg -s "$paket" >/dev/null 2>&1 || FEHLT="$FEHLT $paket"
done
if [ -n "$FEHLT" ]; then
  sagen "   installiere:$FEHLT"
  apt-get update -qq
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $FEHLT
else
  sagen "   alles vorhanden"
fi

NODE_VERSION="$(node --version 2>/dev/null | sed 's/^v//;s/\..*//')"
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 18 ]; then
  sagen "   ACHTUNG: Node.js 18 oder neuer noetig, gefunden: $(node --version 2>/dev/null || echo keins)"
  exit 1
fi

# ------------------------------------------------------------------ Dateien
schritt "Software nach $ORDNER kopieren"
mkdir -p "$ORDNER"
if [ "$QUELLE" != "$ORDNER" ]; then
  tar -C "$QUELLE" --exclude=.git --exclude=node_modules --exclude=data --exclude=tls -cf - . |
    tar -C "$ORDNER" -xf -
fi
mkdir -p "$ORDNER/data" "$ORDNER/tls"
chown -R "$BENUTZER:$BENUTZER" "$ORDNER"

schritt "Abhaengigkeiten installieren"
su - "$BENUTZER" -c "cd '$ORDNER' && npm install --omit=dev --no-audit --no-fund" >/dev/null
sagen "   fertig"

# ------------------------------------------------------------------ TLS
# Ohne HTTPS gibt der Browser die Kamera nicht frei — dann faellt der
# Barcode-Scan am Handy aus. Das Zertifikat ist selbstsigniert; einmal je Geraet
# bestaetigen genuegt.
schritt "Zertifikat"
if [ -f "$ORDNER/tls/pi.crt" ] && [ -z "$ZERTIFIKAT_NEU" ]; then
  sagen "   vorhanden, bleibt (mit ZERTIFIKAT_NEU=1 neu ausstellen)"
else
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  ALT="DNS:$ADRESSE,DNS:$RECHNERNAME,DNS:$RECHNERNAME.local,DNS:localhost,IP:127.0.0.1"
  [ -n "$IP" ] && ALT="$ALT,IP:$IP"

  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -keyout "$ORDNER/tls/pi.key" -out "$ORDNER/tls/pi.crt" \
    -subj "/CN=$ADRESSE" -addext "subjectAltName=$ALT" 2>/dev/null
  chown "$BENUTZER:$BENUTZER" "$ORDNER/tls/pi.key" "$ORDNER/tls/pi.crt"
  chmod 600 "$ORDNER/tls/pi.key"
  sagen "   ausgestellt fuer: $ALT"
fi

# ------------------------------------------------------------------ Dienst
schritt "Dienst einrichten"
DIENST=/etc/systemd/system/jf-spinte.service

# Ein vorhandenes Sitzungsgeheimnis behalten — sonst wird bei jedem Lauf jeder
# Betreuer abgemeldet.
GEHEIMNIS="$(sed -n 's/^Environment=SESSION_SECRET=//p' "$DIENST" 2>/dev/null || true)"
[ -n "$GEHEIMNIS" ] || GEHEIMNIS="$(openssl rand -hex 32)"

sed -e "s|@BENUTZER@|$BENUTZER|g" \
    -e "s|@ORDNER@|$ORDNER|g" \
    -e "s|@ADRESSE@|$ADRESSE|g" \
    -e "s|@GEHEIMNIS@|$GEHEIMNIS|g" \
    "$ORDNER/deploy/jf-spinte.service" > "$DIENST"
# Im Dienst steht das Sitzungsgeheimnis — das geht niemanden sonst etwas an.
chown root:root "$DIENST"
chmod 640 "$DIENST"
sagen "   $DIENST geschrieben"

# --------------------------------------------------------------- polkit
# Erlaubt genau eine Aktion: den Rechner ueber die Weboberflaeche herunterfahren.
schritt "Erlaubnis zum Herunterfahren"
REGEL=/etc/polkit-1/rules.d/49-jf-spinte-poweroff.rules
if [ -d /etc/polkit-1/rules.d ]; then
  sed "s|@BENUTZER@|$BENUTZER|g" "$ORDNER/deploy/49-jf-spinte-poweroff.rules" > "$REGEL"
  chown root:root "$REGEL"
  chmod 644 "$REGEL"
  systemctl reload polkit 2>/dev/null || systemctl restart polkit 2>/dev/null || true
  sagen "   $REGEL geschrieben"
else
  sagen "   ACHTUNG: /etc/polkit-1/rules.d fehlt — der Knopf \"Pi herunterfahren\""
  sagen "   in der Oberflaeche wird dann nicht funktionieren. Alles andere laeuft."
fi

# -------------------------------------------------- Naechtliche Sicherung
# Die Zeitschaltung wird immer eingerichtet, aber nur eingeschaltet, wenn ein
# Passwort hinterlegt ist — ohne Passwort gaebe es keine verschluesselte
# Sicherung, und unverschluesselt gibt es hier keine.
schritt "Naechtliche Sicherung"
ZIEL="${ZIEL:-/mnt/jf-sicherung}"
for einheit in jf-sicherung.service jf-sicherung.timer; do
  sed -e "s|@BENUTZER@|$BENUTZER|g" -e "s|@ORDNER@|$ORDNER|g" -e "s|@ZIEL@|$ZIEL|g" \
    "$ORDNER/deploy/$einheit" > "/etc/systemd/system/$einheit"
  chmod 644 "/etc/systemd/system/$einheit"
done

PASSWORTDATEI=/etc/jf-spinte/sicherung.passwort
if [ -s "$PASSWORTDATEI" ]; then
  systemctl enable --now jf-sicherung.timer >/dev/null 2>&1
  sagen "   eingeschaltet, naechster Lauf: $(systemctl show jf-sicherung.timer -p NextElapseUSecRealtime --value 2>/dev/null)"
else
  sagen "   Zeitschaltung liegt bereit, aber noch aus — es fehlt das Passwort."
  sagen "   Einschalten mit:"
  sagen "     sudo mkdir -p /etc/jf-spinte"
  sagen "     sudo sh -c 'printf \"%s\\n\" \"DEIN-PASSWORT\" > $PASSWORTDATEI'"
  sagen "     sudo chmod 600 $PASSWORTDATEI"
  sagen "     sudo systemctl enable --now jf-sicherung.timer"
fi

# ------------------------------------------------- Update aus der Oberflaeche
# Der Dienst darf sich nicht selbst neu starten. Er legt darum nur eine
# Markierung unter /run ab; diese .path-Einheit sieht sie und startet den
# Helfer als root. Zwei getrennte Rechte statt einem Dienst, der alles kann.
schritt "Aktualisierung ueber die Oberflaeche"
for einheit in jf-update.path jf-update.service; do
  sed -e "s|@BENUTZER@|$BENUTZER|g" -e "s|@ORDNER@|$ORDNER|g"     "$ORDNER/deploy/$einheit" > "/etc/systemd/system/$einheit"
  chmod 644 "/etc/systemd/system/$einheit"
done
systemctl daemon-reload
systemctl enable --now jf-update.path >/dev/null 2>&1
sagen "   Wache auf /run/jf-spinte/update-anfordern eingeschaltet"

if [ -d "$ORDNER/.git" ]; then
  sagen "   Git-Arbeitsverzeichnis vorhanden — der Update-Knopf ist einsatzbereit."
else
  sagen "   Dieser Ordner ist kein Git-Arbeitsverzeichnis. Der Knopf \"Aktualisieren\""
  sagen "   in der Oberflaeche bleibt aus, bis einmalig umgestellt wurde:"
  sagen "     sudo ORDNER=$ORDNER scripts/auf-git-umstellen.sh"
fi

# ------------------------------------------------------------------ Start
schritt "Dienst starten"
systemctl daemon-reload
systemctl enable --now jf-spinte >/dev/null 2>&1
sleep 3
if [ "$(systemctl is-active jf-spinte)" != "active" ]; then
  sagen "   FEHLER: der Dienst laeuft nicht. Protokoll:"
  journalctl -u jf-spinte -n 20 --no-pager
  exit 1
fi
sagen "   laeuft"

# ------------------------------------------------------------------ Probe
schritt "Probe"
if curl -sk -o /dev/null -w '%{http_code}' "https://localhost/" | grep -qE '^(200|302)$'; then
  sagen "   Weboberflaeche antwortet"
else
  sagen "   FEHLER: keine Antwort von https://localhost/"
  exit 1
fi

# Prueft die polkit-Regel, ohne den Rechner abzuschalten: CanPowerOff meldet
# genau das, was beim echten Versuch herauskaeme.
ANTWORT="$(su - "$BENUTZER" -c "busctl --system call org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager CanPowerOff" 2>/dev/null || true)"
case "$ANTWORT" in
  *yes*) sagen "   Herunterfahren aus der Oberflaeche: erlaubt" ;;
  *challenge*) sagen "   ACHTUNG: Herunterfahren verlangt eine Rueckfrage — polkit-Regel greift nicht." ;;
  *) sagen "   Herunterfahren liess sich nicht pruefen (Antwort: ${ANTWORT:-keine})" ;;
esac

sagen ""
sagen "  Fertig."
sagen ""
sagen "  Weboberflaeche:  https://$ADRESSE"
sagen "  ersatzweise:     https://$RECHNERNAME.local"
sagen ""
sagen "  Beim ersten Aufruf legt die Software den Jugendwart an — oder man"
sagen "  waehlt dort \"Mit Sicherung fortsetzen\" und spielt eine Sicherung ein."
sagen ""
sagen "  Das Zertifikat ist selbstsigniert. Jedes Handy meldet einmal eine"
sagen "  Warnung; nach dem Bestaetigen ist Ruhe und die Kamera funktioniert."
sagen ""
