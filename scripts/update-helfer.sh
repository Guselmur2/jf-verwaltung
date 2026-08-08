#!/bin/sh
# Wird von jf-update.service gestartet, sobald die Weboberflaeche eine
# Aktualisierung anfordert. Laeuft als root und AUSSERHALB der Anwendung —
# das ist der ganze Sinn der Uebung:
#
#   * Die Anwendung kann sich nicht selbst neu starten; "systemctl restart"
#     wuerde den Prozess abschiessen, der den Befehl gerade absetzt.
#   * Ginge beim Einspielen etwas schief, koennte ausgerechnet die kaputte
#     Anwendung keine Rettungsseite mehr ausliefern.
#
# Der Ablauf schreibt seinen Fortschritt nach data/update-status.json, damit
# die Seite ihn anzeigen kann — auch waehrend der Dienst kurz weg ist.
#
# Zwei Versuche, dann zurueck: ein npm ci scheitert gern einmal an einem
# haengenden Netz. Bringt auch der zweite Versuch die Seite nicht zum
# Antworten, wird auf den vorherigen Commit zurueckgesetzt.

set -u

ORDNER="${ORDNER:-/opt/jf-spinte}"
ZWEIG="${ZWEIG:-main}"
DIENST="${DIENST:-jf-spinte}"
MARKE="${MARKE:-/run/jf-spinte/update-anfordern}"
STATUS="${STATUS:-$ORDNER/data/update-status.json}"
ABGLEICH="${ABGLEICH:-$ORDNER/data/update-abgleich.json}"
VERSUCHE="${VERSUCHE:-2}"

BENUTZER="$(stat -c '%U' "$ORDNER/server.js" 2>/dev/null || echo root)"
ALS="runuser -u $BENUTZER --"

# Zeile 1 der Markierung sagt, was gewuenscht ist: nur nachsehen ("pruefen")
# oder wirklich einspielen ("update"). Nachsehen muss der Helfer erledigen, weil
# der Dienst selbst nicht in .git schreiben darf — siehe src/update.js.
MODUS="$(head -n 1 "$MARKE" 2>/dev/null | tr -d '\r')"
case "$MODUS" in
  pruefen | update) ;;
  *) MODUS=update ;;
esac

# Die Markierung sofort wegnehmen. Sonst startet der Waechter gleich noch
# einmal, und beim naechsten Systemstart gleich wieder.
rm -f "$MARKE"

melden() {
  # melden <schritt> <ergebnis> <meldung>
  # Ein blosser Abgleich schreibt in eine eigene Datei — sonst ginge das
  # Ergebnis der letzten echten Aktualisierung verloren, und genau das will man
  # nachlesen, wenn etwas schiefging.
  if [ "$MODUS" = pruefen ]; then ZIEL="$ABGLEICH"; else ZIEL="$STATUS"; fi
  cat > "$ZIEL" <<ENDE
{
  "zeitpunkt": "$(date '+%Y-%m-%dT%H:%M:%S%z')",
  "schritt": "$1",
  "ergebnis": "$2",
  "meldung": "$3",
  "vorher": "${VORHER_KURZ:-}",
  "nachher": "${NACHHER_KURZ:-}"
}
ENDE
  chown "$BENUTZER:$BENUTZER" "$ZIEL" 2>/dev/null || true
  chmod 644 "$ZIEL" 2>/dev/null || true
  echo "[$1/$2] $3"
}

# Antwortet die Weboberflaeche wieder? Zuerst HTTPS auf 443 — so richtet
# install-pi.sh es ein. Die uebrigen Adressen sind fuer Installationen ohne
# Zertifikat oder auf einem anderen Port da: ein erfolgreiches Update darf nicht
# daran scheitern, dass die Probe an der falschen Tuer klopft.
antwortet() {
  for adresse in "https://localhost/" "http://localhost/" "http://localhost:3000/"; do
    code="$(curl -sk -o /dev/null -m 10 -w '%{http_code}' "$adresse" 2>/dev/null || true)"
    case "$code" in
      200 | 302) return 0 ;;
    esac
  done
  return 1
}

VORHER=""
VORHER_KURZ=""
NACHHER_KURZ=""
# Wird in der Versuchsschleife gesetzt. Vorbelegt, weil "set -u" sonst
# zuschlaegt, falls VERSUCHE auf 0 stehen sollte.
GRUND="Unbekannter Fehler."

# ------------------------------------------------------------------ Pruefen
if [ ! -d "$ORDNER/.git" ]; then
  melden pruefen fehler "Die Installation ist kein Git-Arbeitsverzeichnis."
  exit 1
fi

melden pruefen laeuft "Sehe nach, ob es etwas Neues gibt"
if ! $ALS git -C "$ORDNER" fetch --quiet origin "$ZWEIG" 2>/dev/null; then
  melden pruefen fehler "Das Repository ist nicht erreichbar."
  exit 1
fi

if [ "$MODUS" = pruefen ]; then
  NEUES="$($ALS git -C "$ORDNER" log --oneline "HEAD..origin/$ZWEIG" | wc -l | tr -d ' ')"
  if [ "$NEUES" = 0 ]; then
    melden abgleich ok "Nachgesehen — es gibt nichts Neues."
  else
    melden abgleich ok "Nachgesehen — $NEUES Aenderungen liegen bereit."
  fi
  exit 0
fi

VORHER="$($ALS git -C "$ORDNER" rev-parse HEAD)"
VORHER_KURZ="$($ALS git -C "$ORDNER" log --oneline -1 | tr -d '"\\')"
NEUES="$($ALS git -C "$ORDNER" log --oneline "HEAD..origin/$ZWEIG" | head -20 | tr -d '"\\')"

if [ -z "$NEUES" ]; then
  melden fertig ok "Schon aktuell — nichts zu tun."
  exit 0
fi

# ------------------------------------------------------------------ Sichern
melden sichern laeuft "Sicherung vor dem Einspielen"
if systemctl list-unit-files jf-sicherung.service >/dev/null 2>&1; then
  if systemctl start jf-sicherung.service 2>/dev/null; then
    :
  else
    # Ohne Sicherung wird nicht aktualisiert. Das ist der Preis dafuer, dass
    # der Rueckweg im Zweifel auch die Daten umfasst.
    melden sichern fehler "Die Sicherung ist fehlgeschlagen — Update abgebrochen."
    exit 1
  fi
else
  melden sichern fehler "Es ist keine Sicherung eingerichtet — Update abgebrochen."
  exit 1
fi

# ---------------------------------------------------------------- Einspielen
melden einspielen laeuft "Neuen Stand holen"
if ! $ALS git -C "$ORDNER" merge --quiet --ff-only "origin/$ZWEIG" 2>/dev/null; then
  melden einspielen fehler "Der neue Stand liess sich nicht einspielen (kein Schnellvorlauf)."
  exit 1
fi
NACHHER_KURZ="$($ALS git -C "$ORDNER" log --oneline -1 | tr -d '"\\')"

zuruecksetzen() {
  melden zurueck laeuft "Setze zurueck auf: $VORHER_KURZ"
  $ALS git -C "$ORDNER" reset --hard --quiet "$VORHER" 2>/dev/null
  $ALS sh -c "cd '$ORDNER' && npm ci --omit=dev --no-audit --no-fund" >/dev/null 2>&1
  systemctl restart "$DIENST" 2>/dev/null
  sleep 5
  if antwortet; then
    NACHHER_KURZ="$VORHER_KURZ"
    melden zurueck zurueckgesetzt "$1 Der vorherige Stand laeuft wieder."
  else
    melden zurueck fehler "$1 Auch der vorherige Stand antwortet nicht — bitte per SSH nachsehen."
  fi
}

# ------------------------------------------------------------- Versuche
n=1
while [ "$n" -le "$VERSUCHE" ]; do
  melden einspielen laeuft "Abhaengigkeiten installieren (Versuch $n von $VERSUCHE)"
  if $ALS sh -c "cd '$ORDNER' && npm ci --omit=dev --no-audit --no-fund" >/dev/null 2>&1; then
    melden neustart laeuft "Dienst neu starten (Versuch $n von $VERSUCHE)"
    systemctl restart "$DIENST" 2>/dev/null
    sleep 5
    if antwortet; then
      melden fertig ok "Aktualisiert auf: $NACHHER_KURZ"
      exit 0
    fi
    GRUND="Die Seite antwortete nach dem Neustart nicht."
  else
    GRUND="npm ci ist fehlgeschlagen."
  fi
  n=$((n + 1))
  [ "$n" -le "$VERSUCHE" ] && sleep 5
done

zuruecksetzen "$GRUND"
exit 1
