#!/bin/sh
# Spielt den aktuellen Stand aus Git auf den Raspberry Pi und startet den Dienst
# neu. Datenbank, Zertifikat und Einstellungen bleiben unberuehrt.
#
#   sh scripts/deploy-pi.sh
#
# Voraussetzung: SSH-Zugang per Schluessel (siehe README, Abschnitt Raspberry Pi).

set -e

PI_HOST="${PI_HOST:-jfwpi.fritz.box}"
PI_USER="${PI_USER:-sam}"
PI_DIR="${PI_DIR:-/opt/jf-spinte}"
PI_KEY="${PI_KEY:-$HOME/.ssh/jfwpi_key}"

SSH="ssh -i $PI_KEY -o IdentitiesOnly=yes -o BatchMode=yes $PI_USER@$PI_HOST"

if [ -n "$(git status --porcelain)" ]; then
  echo "Achtung: es gibt nicht eingecheckte Aenderungen."
  echo "Uebertragen wird der letzte Commit, nicht der Arbeitsstand."
  echo ""
fi

echo "Stand:      $(git log -1 --format='%h %s')"
echo "Ziel:       $PI_USER@$PI_HOST:$PI_DIR"
echo ""

echo "-> Dateien uebertragen"
git archive --format=tar HEAD | $SSH "tar -x -C $PI_DIR"

echo "-> Abhaengigkeiten pruefen"
$SSH "cd $PI_DIR && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -2"

echo "-> Dienst neu starten"
$SSH "sudo systemctl restart jf-spinte && sleep 3 && systemctl is-active jf-spinte"

echo "-> Erreichbarkeit"
if curl -sk -o /dev/null -w '%{http_code}' "https://$PI_HOST/" | grep -qE '^(200|302)$'; then
  echo "   https://$PI_HOST/ antwortet"
else
  echo "   FEHLER: keine Antwort. Protokoll ansehen mit:"
  echo "   $SSH 'journalctl -u jf-spinte -n 30 --no-pager'"
  exit 1
fi

echo ""
echo "Fertig."
