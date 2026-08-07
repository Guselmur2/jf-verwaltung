#!/bin/sh
# Holt den neuesten Stand aus dem Repository und startet den Dienst neu.
#
# Auf dem Pi ausfuehren:
#
#   sudo sh /opt/jf-spinte/scripts/update-pi.sh
#
# Voraussetzung: die Installation ist ein Git-Arbeitsverzeichnis. Falls nicht,
# einmalig auf-git-umstellen.sh laufen lassen.
#
# Zeigt erst, was kommen wuerde, und fragt dann nach. Mit -j / --ja laeuft es
# ohne Rueckfrage durch (fuer eine Zeitschaltung).

set -e

ORDNER="${ORDNER:-/opt/jf-spinte}"
ZWEIG="${ZWEIG:-main}"
DIENST="${DIENST:-jf-spinte}"
OHNE_FRAGE=""
case "${1:-}" in -j|--ja) OHNE_FRAGE=1 ;; esac

sagen() { printf '%s\n' "$*"; }
schritt() { printf '\n-> %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { sagen "Bitte mit sudo starten."; exit 1; }
[ -d "$ORDNER/.git" ] || {
  sagen "$ORDNER ist kein Git-Arbeitsverzeichnis."
  sagen "Einmalig umstellen:"
  sagen "  sudo sh $ORDNER/scripts/auf-git-umstellen.sh https://github.com/NAME/REPO.git"
  exit 1
}

BENUTZER="$(stat -c '%U' "$ORDNER/server.js")"
ALS="runuser -u $BENUTZER --"

schritt "Nach Neuerungen sehen"
$ALS git -C "$ORDNER" fetch -q origin "$ZWEIG"

NEUES="$($ALS git -C "$ORDNER" log --oneline HEAD..origin/"$ZWEIG")"
if [ -z "$NEUES" ]; then
  sagen "   Alles aktuell — nichts zu tun."
  exit 0
fi

sagen "   Diese Aenderungen kaemen dazu:"
printf '%s\n' "$NEUES" | sed 's/^/     /'

if [ -z "$OHNE_FRAGE" ]; then
  printf '\nEinspielen? [j/N] '
  read -r antwort
  case "$antwort" in j|J|ja|Ja) ;; *) sagen "Abgebrochen."; exit 0 ;; esac
fi

# Vor dem Einspielen sichern — dauert Sekunden und erspart im Zweifel alles.
if systemctl list-unit-files jf-sicherung.service >/dev/null 2>&1; then
  schritt "Sicherung vorher"
  systemctl start jf-sicherung.service 2>/dev/null && sagen "   erledigt" || sagen "   uebersprungen"
fi

schritt "Neuen Stand holen"
$ALS git -C "$ORDNER" merge -q --ff-only origin/"$ZWEIG"
sagen "   jetzt auf $($ALS git -C "$ORDNER" log --oneline -1)"

# npm ci statt npm install: genau die Fassungen aus package-lock.json, mit
# Pruefsumme je Paket. Siehe README, Abschnitt Updates.
schritt "Abhaengigkeiten"
$ALS env -C "$ORDNER" npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 ||
  { sagen "   FEHLER bei npm ci"; exit 1; }
sagen "   fertig"

schritt "Dienst neu starten"
systemctl restart "$DIENST"
sleep 3
if [ "$(systemctl is-active "$DIENST")" != "active" ]; then
  sagen "   FEHLER: der Dienst laeuft nicht. Protokoll:"
  journalctl -u "$DIENST" -n 20 --no-pager
  exit 1
fi
sagen "   laeuft"

schritt "Probe"
if curl -sk -o /dev/null -w '%{http_code}' "https://localhost/" | grep -qE '^(200|302)$'; then
  sagen "   Weboberflaeche antwortet"
else
  sagen "   FEHLER: keine Antwort von https://localhost/"
  exit 1
fi

sagen ""
sagen "  Fertig."
sagen ""
