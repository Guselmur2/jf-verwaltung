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
})();
