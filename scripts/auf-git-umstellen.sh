#!/bin/sh
# Macht aus einer vorhandenen Installation ein Git-Arbeitsverzeichnis.
#
# Auf dem Pi ausfuehren, einmalig:
#
#   sudo sh /opt/jf-spinte/scripts/auf-git-umstellen.sh https://github.com/NAME/REPO.git
#
# Danach genuegt fuer jedes Update ein Aufruf von update-pi.sh — ohne den
# Rechner, auf dem das Repository liegt. Vorher ging das nur mit deploy-pi.sh
# aus dem Projektordner heraus, weil die Dateien per "git archive" uebertragen
# wurden und auf dem Pi kein .git lag.
#
# Datenbank, Zertifikat, node_modules und die eigene Konfiguration bleiben
# unberuehrt: sie stehen in .gitignore und werden von Git nicht angefasst.

set -e

ORDNER="${ORDNER:-/opt/jf-spinte}"
HERKUNFT="${1:-$HERKUNFT}"
ZWEIG="${ZWEIG:-main}"

sagen() { printf '%s\n' "$*"; }
schritt() { printf '\n-> %s\n' "$*"; }

if [ -z "$HERKUNFT" ]; then
  sagen "Aufruf: sudo sh $0 https://github.com/NAME/REPO.git"
  exit 2
fi

if [ ! -f "$ORDNER/server.js" ]; then
  sagen "In $ORDNER liegt keine Installation (server.js fehlt)."
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  sagen "Bitte mit sudo starten."
  exit 1
fi

# Alles unter dem Dienstbenutzer, damit die Dateirechte bleiben wie sie sind.
BENUTZER="$(stat -c '%U' "$ORDNER/server.js")"
ALS="runuser -u $BENUTZER --"

sagen ""
sagen "  Auf Git umstellen"
sagen "  -----------------"
sagen "  Ordner:   $ORDNER"
sagen "  Benutzer: $BENUTZER"
sagen "  Herkunft: $HERKUNFT"

if [ -d "$ORDNER/.git" ]; then
  schritt "Schon umgestellt"
  sagen "   $ORDNER ist bereits ein Git-Arbeitsverzeichnis."
  $ALS git -C "$ORDNER" remote -v | sed 's/^/   /'
  exit 0
fi

command -v git >/dev/null 2>&1 || { sagen "git fehlt: sudo apt-get install -y git"; exit 1; }

schritt "Repository anlegen und holen"
$ALS git -C "$ORDNER" init -q -b "$ZWEIG"
$ALS git -C "$ORDNER" remote add origin "$HERKUNFT"
$ALS git -C "$ORDNER" fetch -q --depth=1 origin "$ZWEIG"
sagen "   geholt"

# --mixed setzt nur die Verwaltung, ruehrt die Dateien nicht an. So laesst sich
# vorher sehen, worin sich die Installation vom Repository unterscheidet.
schritt "Vergleich mit dem Repository"
$ALS git -C "$ORDNER" reset -q --mixed FETCH_HEAD
$ALS git -C "$ORDNER" branch -q --set-upstream-to=origin/"$ZWEIG" "$ZWEIG" 2>/dev/null || true

UNTERSCHIED="$($ALS git -C "$ORDNER" status --porcelain --untracked-files=no)"
if [ -n "$UNTERSCHIED" ]; then
  sagen "   Diese Dateien weichen ab:"
  printf '%s\n' "$UNTERSCHIED" | sed 's/^/     /'
  schritt "Auf den Stand des Repositories bringen"
  $ALS git -C "$ORDNER" checkout -q -- .
  sagen "   angeglichen"
else
  sagen "   identisch — nichts anzugleichen"
fi

schritt "Fertig"
sagen "   Ab jetzt genuegt fuer ein Update:"
sagen ""
sagen "     sudo sh $ORDNER/scripts/update-pi.sh"
sagen ""
sagen "   Datenbank, Zertifikat und Einstellungen wurden nicht angefasst."
