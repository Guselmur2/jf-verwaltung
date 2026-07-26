'use strict';

// Barcode-Scan mit der Handykamera.
//
// Zwei Wege, in dieser Reihenfolge:
//   1. BarcodeDetector — in Chrome/Android eingebaut, schnell, kein Download.
//   2. html5-qrcode aus /vendor — laeuft ueberall sonst, wird lokal vom Pi
//      geladen (kein CDN, funktioniert also auch ohne Internet).
//
// Ohne HTTPS gibt der Browser die Kamera nur auf localhost frei. Statt einer
// kryptischen Fehlermeldung erklaert der Dialog dann, woran es liegt.
(function () {
  var FORMATE = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code'];

  var overlay = null;
  var stop = null;
  var onFound = null;

  function sichererKontext() {
    return window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  }

  // ------------------------------------------------------------- Oberflaeche

  function baueOverlay() {
    var el = document.createElement('div');
    el.className = 'scan-overlay';
    el.innerHTML =
      '<div class="scan-box">' +
      '<div class="scan-kopf"><strong>Barcode scannen</strong>' +
      '<button type="button" class="btn btn-klein btn-still" data-schliessen>Schließen</button></div>' +
      '<div class="scan-buehne"><div id="scan-ziel"></div><video playsinline muted></video><div class="scan-linie"></div></div>' +
      '<p class="scan-status">Kamera wird gestartet …</p>' +
      '<form class="scan-manuell"><input name="manuell" placeholder="oder Nummer eintippen" inputmode="numeric" autocomplete="off">' +
      '<button class="btn btn-klein" type="submit">Übernehmen</button></form>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('[data-schliessen]').addEventListener('click', schliessen);
    el.addEventListener('click', function (ev) {
      if (ev.target === el) schliessen();
    });
    el.querySelector('.scan-manuell').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var wert = ev.target.manuell.value.trim();
      if (wert) treffer(wert);
    });
    return el;
  }

  function status(text, fehler) {
    if (!overlay) return;
    var p = overlay.querySelector('.scan-status');
    p.textContent = text;
    p.classList.toggle('scan-fehler', !!fehler);
  }

  function schliessen() {
    if (stop) {
      try {
        stop();
      } catch (e) {
        /* Kamera war schon aus */
      }
      stop = null;
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    onFound = null;
  }

  function treffer(wert) {
    var cb = onFound;
    schliessen();
    if (cb) cb(String(wert).trim());
  }

  // ------------------------------------------------------------- Kamerawege

  function starteNativ() {
    var video = overlay.querySelector('video');
    var detector = new window.BarcodeDetector({ formats: FORMATE });
    var laeuft = true;

    return navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (stream) {
        video.srcObject = stream;
        video.style.display = 'block';
        return video.play();
      })
      .then(function () {
        status('Barcode vor die Kamera halten.');
        stop = function () {
          laeuft = false;
          var s = video.srcObject;
          if (s) s.getTracks().forEach(function (t) { t.stop(); });
        };

        (function pruefen() {
          if (!laeuft) return;
          detector
            .detect(video)
            .then(function (codes) {
              if (!laeuft) return;
              if (codes && codes.length) return treffer(codes[0].rawValue);
              requestAnimationFrame(pruefen);
            })
            .catch(function () {
              if (laeuft) requestAnimationFrame(pruefen);
            });
        })();
      });
  }

  function ladeBibliothek() {
    if (window.Html5Qrcode) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/vendor/html5-qrcode.min.js';
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error('Bibliothek /vendor/html5-qrcode.min.js nicht erreichbar'));
      };
      document.head.appendChild(s);
    });
  }

  function starteBibliothek() {
    return ladeBibliothek().then(function () {
      var leser = new window.Html5Qrcode('scan-ziel', { verbose: false });
      stop = function () {
        leser.stop().catch(function () {});
      };
      return leser
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 160 } },
          function (text) {
            treffer(text);
          },
          function () {
            /* jedes nicht erkannte Bild — kein Fehler */
          }
        )
        .then(function () {
          status('Barcode vor die Kamera halten.');
        });
    });
  }

  // ---------------------------------------------------------------- Einstieg

  function oeffnen(callback) {
    schliessen();
    onFound = callback;
    overlay = baueOverlay();

    if (!sichererKontext()) {
      overlay.querySelector('.scan-buehne').style.display = 'none';
      status(
        'Die Kamera ist nur über HTTPS oder auf localhost verfügbar. ' +
          'Diese Seite läuft über HTTP — bitte die Nummer eintippen oder HTTPS einrichten (siehe README).',
        true
      );
      overlay.querySelector('input[name="manuell"]').focus();
      return;
    }

    var weg = window.BarcodeDetector ? starteNativ() : starteBibliothek();
    weg.catch(function (err) {
      overlay.querySelector('.scan-buehne').style.display = 'none';
      // html5-qrcode meldet Fehler teils als Zeichenkette statt als Error.
      var name = (err && err.name) || '';
      var meldung = typeof err === 'string' ? err : (err && err.message) || '';
      var text;

      if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied/i.test(meldung)) {
        text = 'Zugriff auf die Kamera wurde abgelehnt. Bitte im Browser erlauben oder die Nummer eintippen.';
      } else if (name === 'NotFoundError' || /no camera|not found|requested device/i.test(meldung)) {
        text = 'Dieses Gerät hat keine nutzbare Kamera. Bitte die Nummer eintippen.';
      } else {
        text = 'Kamera nicht verfügbar' + (meldung ? ' (' + meldung + ')' : '') + '. Bitte Nummer eintippen.';
      }
      status(text, true);
      overlay.querySelector('input[name="manuell"]').focus();
    });
  }

  window.Barcode = { oeffnen: oeffnen, schliessen: schliessen };

  // Alle Knoepfe mit data-scan verdrahten:
  //   data-scan="feld"  -> traegt den Wert in das zugehoerige Eingabefeld ein
  //   data-scan="suche" -> springt direkt zu /scannen?nr=...
  document.addEventListener('click', function (ev) {
    var knopf = ev.target.closest('[data-scan]');
    if (!knopf) return;
    ev.preventDefault();

    var art = knopf.getAttribute('data-scan');
    if (art === 'suche') {
      oeffnen(function (wert) {
        window.location.href = '/scannen?nr=' + encodeURIComponent(wert);
      });
      return;
    }

    // Das Eingabefeld ist entweder per data-ziel referenziert oder das
    // naechstgelegene Inventarnummer-Feld im selben Formular.
    var ziel = knopf.getAttribute('data-ziel')
      ? document.querySelector(knopf.getAttribute('data-ziel'))
      : (knopf.form || knopf.closest('form')).querySelector('[name="inventory_no"], [name="q"], [name="nr"]');
    if (!ziel) return;

    oeffnen(function (wert) {
      ziel.value = wert;
      ziel.dispatchEvent(new Event('input', { bubbles: true }));
      if (knopf.hasAttribute('data-absenden') && ziel.form) ziel.form.submit();
      else ziel.focus();
    });
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && overlay) schliessen();
  });
})();
