// Blendet Groesse bzw. Inventarnummer aus, wenn die gewaehlte Ausruestungsart
// das Feld gar nicht fuehrt (z. B. Helm ohne Groesse). Ohne JavaScript bleiben
// einfach alle Felder sichtbar - die Seite funktioniert trotzdem.
(function () {
  'use strict';

  var FELDER = [
    ['size', 'size', 'Diese Art führt keine Größe.'],
    ['inventory_no', 'inv', 'Diese Art führt keine Inventarnummer.'],
  ];

  function anpassen(select, vomBenutzer) {
    var form = select.form;
    if (!form) return;
    var opt = select.options[select.selectedIndex];
    if (!opt) return;

    // Passende Größenliste an das Feld hängen (Handschuhe haben andere Größen
    // als Hosen). Ohne hinterlegtes Schema bleibt das Feld frei beschreibbar.
    var groesse = form.querySelector('[name="size"]');
    if (groesse) {
      var schema = opt.dataset.schema;
      if (schema && document.getElementById('groessen-' + schema)) {
        groesse.setAttribute('list', 'groessen-' + schema);
      } else {
        groesse.removeAttribute('list');
      }
    }

    FELDER.forEach(function (def) {
      var feld = form.querySelector('[name="' + def[0] + '"]');
      if (!feld) return;

      // Ohne Angabe (z. B. leere Auswahl "Art wählen …") bleibt alles bedienbar.
      var aus = opt.dataset[def[1]] === '0';
      feld.classList.toggle('feld-aus', aus);
      feld.title = aus ? def[2] : '';

      if (!aus) {
        feld.disabled = false;
        feld.readOnly = false;
        return;
      }

      if (vomBenutzer) {
        // Bewusster Artwechsel: der alte Wert passt nicht mehr.
        feld.value = '';
        feld.disabled = true;
      } else if (feld.value) {
        // Beim Laden nichts wegwerfen - readonly wird beim Speichern mitgesendet,
        // disabled waere ein stiller Datenverlust.
        feld.readOnly = true;
      } else {
        feld.disabled = true;
      }
    });
  }

  document.querySelectorAll('select[name="type_id"]').forEach(function (select) {
    anpassen(select, false);
    select.addEventListener('change', function () {
      anpassen(select, true);
    });
  });

  // Einrichtungsdialog: Unterbereiche je nach gewaehltem Modus ein-/ausblenden.
  var bereichform = document.getElementById('bereichform');
  if (bereichform) {
    var radios = bereichform.querySelectorAll('input[name="modus"]');
    var updateBereich = function () {
      var gewaehlt = bereichform.querySelector('input[name="modus"]:checked');
      var modus = gewaehlt ? gewaehlt.value : null;
      bereichform.querySelectorAll('.untermenue').forEach(function (box) {
        box.style.display = box.dataset.fuer === modus ? '' : 'none';
      });
    };
    radios.forEach(function (r) {
      r.addEventListener('change', updateBereich);
    });
    updateBereich();
  }

  // Anwesenheit: die Liste im Hintergrund abgleichen.
  //
  // Mehrere Betreuer koennen gleichzeitig tippen — die Daten liegen ohnehin in
  // einer Datenbank, aber ohne das hier saehe jedes Handy nur seinen Stand vom
  // letzten Laden. Alle 15 Sekunden wird die Seite neu geholt und nur die Liste
  // ausgetauscht; die Bildlaufposition bleibt damit erhalten.
  //
  // Ohne JavaScript passiert nichts weiter — die Seite funktioniert dann wie
  // vorher, nur eben mit dem Stand vom Laden.
  var liste = document.querySelector('[data-anwesenheit]');
  if (liste && window.fetch && window.DOMParser) {
    var laeuft = false;
    var abgleichen = function () {
      if (laeuft || document.hidden) return;
      laeuft = true;
      fetch(location.pathname, { credentials: 'same-origin' })
        .then(function (antwort) {
          return antwort.ok ? antwort.text() : null;
        })
        .then(function (html) {
          if (!html) return;
          var neu = new DOMParser().parseFromString(html, 'text/html');
          var neueListe = neu.querySelector('[data-anwesenheit]');
          // Nur anfassen, wenn sich wirklich etwas geaendert hat — sonst
          // koennte ein Tipp genau im Austausch verloren gehen.
          if (neueListe && neueListe.innerHTML !== liste.innerHTML) {
            liste.innerHTML = neueListe.innerHTML;
          }
          ['[data-zaehler]', '[data-stand]'].forEach(function (wahl) {
            var hier = document.querySelector(wahl);
            var dort = neu.querySelector(wahl);
            if (hier && dort) hier.innerHTML = dort.innerHTML;
          });
        })
        .catch(function () {
          /* Netz kurz weg — beim naechsten Mal wieder */
        })
        .then(function () {
          laeuft = false;
        });
    };
    setInterval(abgleichen, 15000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) abgleichen();
    });
  }

  // Aktualisierung: den Fortschritt verfolgen, auch über den Neustart hinweg.
  //
  // Währenddessen ist der Dienst für einige Sekunden weg — die Abfrage schlägt
  // dann fehl. Das ist erwartet und kein Grund aufzuhören: es wird einfach
  // weiter gefragt, bis er wieder antwortet. Ohne das stünde die Seite still
  // und man wüsste nicht, ob noch etwas passiert.
  var laufend = document.querySelector('[data-update-laeuft]');
  if (laufend && window.fetch) {
    var meldung = document.querySelector('[data-update-meldung]');
    var wegSeit = 0;
    var nachsehen = function () {
      fetch('/system/update/status.json', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (a) {
          return a.ok ? a.json() : null;
        })
        .then(function (daten) {
          if (!daten) return;
          wegSeit = 0;
          if (!daten.laeuft) {
            location.reload();
            return;
          }
          if (meldung && daten.status) {
            meldung.textContent = (daten.status.schritt || '') + ': ' + (daten.status.meldung || '…');
          }
        })
        .catch(function () {
          // Dienst startet gerade neu. Nach etwa zwei Minuten ohne Antwort
          // sagen wir es, statt endlos still zu warten.
          wegSeit += 1;
          if (meldung && wegSeit > 3) {
            meldung.textContent =
              wegSeit > 40
                ? 'Seit über zwei Minuten keine Antwort. Bitte per SSH nachsehen.'
                : 'Der Dienst startet neu … (' + wegSeit * 3 + ' s)';
          }
        });
    };
    setInterval(nachsehen, 3000);
  }
})();
