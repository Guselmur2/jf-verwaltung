'use strict';

// Ausgangsbestand an Groessen. Wird beim ersten Start in die Datenbank
// geschrieben und ist danach über "Ausrüstungsarten" änderbar — jede Wehr führt
// am Ende die Größen, die sie tatsächlich im Schrank hat.
//
// Recherche (Stand Juli 2026):
//
// Körpergrößen (Kinder/Jugend) laufen in Sechserschritten und entsprechen der
// Körperhöhe in Zentimetern: 116, 122, … 170, 176.
//   Quelle: blitzrechner.de/kindergroessen, babelli.de/groessentabelle-kinder
//
// Erwachsenen-Konfektionsgrößen (Herren, Normalgrößen) laufen in Zweierschritten
// von 44 bis 70 und entsprechen etwa dem halben Brustumfang.
//   Quelle: blitzrechner.de/konfektionsgroessen
//
// Übergang: Jugendfeuerwehr-Bekleidung wird bis Körpergröße 170/176 geführt,
// danach beginnen die Konfektionsgrößen. Größe 176 entspricht bei schlankem
// Jugendlichen etwa Konfektion 44–48 (Brustumfang 86–97 cm) — deshalb steht die
// 44 in dieser Reihe direkt hinter der 176.
//   Quelle: Größentabellen Kinder-/Jugendfeuerwehr (MURER-Feuerschutz),
//           Jugendfeuerwehr-Bundhose (feuerwehrversand.de), lieferbar
//           128 … 176 sowie 48 … 60.
//
// Handschuhgrößen nach Handumfang: 4 (Kinderhand) bis 12 (ca. 33 cm, XXXL).
// In der Jugendfeuerwehr kommen die kleinen Größen 4 und 5 vor.
//   Quelle: keiler.net/service/groesse-finden
//
// Schuhgrößen als europäische Zahlenreihe.

const reihe = (von, bis, schritt) => {
  const out = [];
  for (let n = von; n <= bis; n += schritt) out.push(String(n));
  return out;
};

const SCHEMES = [
  {
    name: 'bekleidung',
    label: 'Kleidung (Körpergröße / Konfektion)',
    note: 'Jugend nach Körpergröße in cm, Erwachsene nach Konfektionsgröße. Nach 176 folgt 44.',
    gruppen: [
      { gruppe: 'Körpergröße', werte: reihe(116, 176, 6) },
      { gruppe: 'Konfektion', werte: reihe(44, 70, 2) },
    ],
  },
  {
    name: 'handschuh',
    label: 'Handschuhe',
    note: 'Nach Handumfang: 4 (Kinderhand) bis 12 (ca. 33 cm).',
    gruppen: [{ gruppe: 'Handschuhgröße', werte: reihe(4, 12, 1) }],
  },
  {
    name: 'schuh',
    label: 'Schuhe',
    note: 'Europäische Schuhgrößen.',
    gruppen: [{ gruppe: 'Schuhgröße', werte: reihe(30, 50, 1) }],
  },
];

// Welche Standardart bekommt welches Schema?
const TYP_SCHEMA = {
  Jacke: 'bekleidung',
  Hose: 'bekleidung',
  Handschuhe: 'handschuh',
  Schuhe: 'schuh',
};

module.exports = { SCHEMES, TYP_SCHEMA };
