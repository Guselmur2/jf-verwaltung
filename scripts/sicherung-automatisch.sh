#!/bin/sh
# Naechtliche Sicherung auf den USB-Stick. Wird vom Timer jf-sicherung.timer
# als root gestartet, weil die WLAN-Zugangsdaten nur root lesen darf.
#
# Gesichert wird zweierlei, beides mit demselben Passwort verschluesselt:
#
#   spinte-JJJJ-MM-TT-hhmm.db.enc   die Datenbank
#   wlan-JJJJ-MM-TT-hhmm.tar.gz.enc die WLAN-Zugangsdaten
#
# Beide im Format von "openssl enc", also auch ohne diese Software zu oeffnen:
#   openssl enc -d -aes-256-cbc -pbkdf2 -in <datei> -out <ziel>
#
# Von Hand ausloesen:  sudo systemctl start jf-sicherung.service

set -eu

ORDNER="${ORDNER:-/opt/jf-spinte}"
ZIEL="${ZIEL:-/mnt/jf-sicherung}"
ERSATZZIEL="${ERSATZZIEL:-$ORDNER/data/sicherungen}"
BENUTZER="${BENUTZER:-sam}"
PASSWORTDATEI="${PASSWORTDATEI:-/etc/jf-spinte/sicherung.passwort}"
STAENDE="${STAENDE:-30}"
STATUS="$ORDNER/data/sicherung-status.json"

ZEIT="$(date '+%Y-%m-%d-%H%M')"
JETZT="$(date '+%Y-%m-%dT%H:%M:%S%z')"

# Schreibt den Stand fuer die Systemseite der Weboberflaeche.
status_schreiben() {
  cat > "$STATUS" <<ENDE
{
  "zeitpunkt": "$JETZT",
  "ergebnis": "$1",
  "meldung": "$2",
  "ziel": "$3",
  "datenbank": "$4",
  "wlan": "$5",
  "staende": $6
}
ENDE
  chown "$BENUTZER:$BENUTZER" "$STATUS" 2>/dev/null || true
  chmod 644 "$STATUS"
}

abbrechen() {
  status_schreiben fehler "$1" "$ZIEL" "" "" 0
  echo "FEHLER: $1" >&2
  exit 1
}

[ -r "$PASSWORTDATEI" ] || abbrechen "Passwortdatei $PASSWORTDATEI fehlt oder ist nicht lesbar."
PASSWORT="$(head -n1 "$PASSWORTDATEI" | tr -d '\r\n')"
[ -n "$PASSWORT" ] || abbrechen "In $PASSWORTDATEI steht kein Passwort."

# ------------------------------------------------------------------- Ziel
# Der Stick soll es sein. Fehlt er — jemand hat ihn abgezogen —, wird auf die
# Speicherkarte ausgewichen. Lieber eine Sicherung am schlechteren Ort als gar
# keine; gemeldet wird es trotzdem.
HINWEIS=""
if mountpoint -q "$ZIEL" 2>/dev/null && [ -w "$ZIEL" ]; then
  :
else
  HINWEIS="USB-Stick nicht eingehängt — auf die Speicherkarte ausgewichen."
  ZIEL="$ERSATZZIEL"
  mkdir -p "$ZIEL"
  chown "$BENUTZER:$BENUTZER" "$ZIEL"
fi

# -------------------------------------------------------------- Datenbank
# Unter dem Dienstbenutzer, damit die Begleitdateien der Datenbank nicht
# ploetzlich root gehoeren.
DB_ERGEBNIS="$(printf '%s\n' "$PASSWORT" |
  runuser -u "$BENUTZER" -- env DATA_DIR="$ORDNER/data" \
    node "$ORDNER/scripts/sicherung-erstellen.js" "$ZIEL" 2>&1)" ||
  abbrechen "Datenbank-Sicherung fehlgeschlagen: $DB_ERGEBNIS"

DB_DATEI="$(printf '%s' "$DB_ERGEBNIS" | sed -n 's/.*"datei":"\([^"]*\)".*/\1/p')"
[ -n "$DB_DATEI" ] || abbrechen "Datenbank-Sicherung lieferte keinen Dateinamen: $DB_ERGEBNIS"

# ------------------------------------------------------------------- WLAN
# Die Zugangsdaten stehen an zwei Stellen: NetworkManager legt von Hand
# angelegte Verbindungen unter /etc/NetworkManager/system-connections ab, die
# bei der Ersteinrichtung erzeugten kommen aus /etc/netplan. Beides mitnehmen,
# sonst fehlt nach einer Neuinstallation ausgerechnet das WLAN.
WLAN_DATEI="wlan-$ZEIT.tar.gz.enc"
WLAN_QUELLEN=""
[ -d /etc/NetworkManager/system-connections ] && WLAN_QUELLEN="$WLAN_QUELLEN /etc/NetworkManager/system-connections"
[ -d /etc/netplan ] && WLAN_QUELLEN="$WLAN_QUELLEN /etc/netplan"

if [ -n "$WLAN_QUELLEN" ]; then
  # shellcheck disable=SC2086
  tar -czf - --absolute-names $WLAN_QUELLEN 2>/dev/null |
    openssl enc -aes-256-cbc -pbkdf2 -pass "file:$PASSWORTDATEI" -out "$ZIEL/$WLAN_DATEI" ||
    abbrechen "WLAN-Sicherung fehlgeschlagen."
  chmod 600 "$ZIEL/$WLAN_DATEI" 2>/dev/null || true
else
  WLAN_DATEI=""
fi

# ---------------------------------------------------------------- Aufraeumen
# Je Sorte nur die juengsten Staende behalten.
aufraeumen() {
  muster="$1"
  # shellcheck disable=SC2012
  ls -1t "$ZIEL"/$muster 2>/dev/null | tail -n "+$((STAENDE + 1))" | while read -r alt; do
    rm -f "$alt"
  done
}
aufraeumen 'spinte-*.db.enc'
aufraeumen 'wlan-*.tar.gz.enc'

ANZAHL="$(ls -1 "$ZIEL"/spinte-*.db.enc 2>/dev/null | wc -l | tr -d ' ')"

if [ -n "$HINWEIS" ]; then
  status_schreiben warnung "$HINWEIS" "$ZIEL" "$DB_DATEI" "$WLAN_DATEI" "$ANZAHL"
  echo "$HINWEIS" >&2
else
  status_schreiben ok "" "$ZIEL" "$DB_DATEI" "$WLAN_DATEI" "$ANZAHL"
fi

echo "Gesichert nach $ZIEL: $DB_DATEI${WLAN_DATEI:+, $WLAN_DATEI} ($ANZAHL Stände)"
