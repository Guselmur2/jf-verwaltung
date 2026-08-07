#!/usr/bin/env node
'use strict';

// Zaehlt die Lizenzen aller installierten Pakete und meldet, was Aufmerksamkeit
// braucht. Aufruf: npm run lizenzen
//
// Sinn der Sache: Bei acht direkten Abhaengigkeiten landen ueber 150 Pakete im
// Ordner. Kommt spaeter eines mit Copyleft dazu (GPL, AGPL, SSPL), passt das
// nicht mehr zur MIT-Lizenz dieses Projekts — dann muesste man entweder das
// Paket austauschen oder das ganze Projekt umlizenzieren. Das faellt hier auf,
// bevor es veroeffentlicht ist.

const fs = require('fs');
const path = require('path');

// Lizenzen, die eine Veroeffentlichung unter MIT unmoeglich machen oder
// zumindest Bedingungen stellen, die man kennen muss.
const COPYLEFT = /GPL|AGPL|SSPL|EUPL|CDDL|MPL|CC-BY-NC|CC-BY-SA/i;
const UNKLAR = /UNLICENSED|proprietary|SEE LICENSE/i;

function lizenzVon(paket) {
  const l = paket.license || paket.licenses;
  if (!l) return null;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => x.type || x).join(' / ');
  return l.type || null;
}

function sammeln(ordner, gefunden = new Map()) {
  let eintraege;
  try {
    eintraege = fs.readdirSync(ordner, { withFileTypes: true });
  } catch {
    return gefunden;
  }

  for (const e of eintraege) {
    if (!e.isDirectory()) continue;
    const pfad = path.join(ordner, e.name);

    // @scope/name — eine Ebene tiefer weitersuchen
    if (e.name.startsWith('@')) {
      sammeln(pfad, gefunden);
      continue;
    }

    const pj = path.join(pfad, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        const paket = JSON.parse(fs.readFileSync(pj, 'utf8'));
        const name = paket.name || e.name;
        if (!gefunden.has(name)) {
          gefunden.set(name, { version: paket.version || '?', lizenz: lizenzVon(paket) });
        }
      } catch {
        /* kaputte package.json ueberspringen */
      }
    }

    // Verschachtelte Abhaengigkeiten
    const tiefer = path.join(pfad, 'node_modules');
    if (fs.existsSync(tiefer)) sammeln(tiefer, gefunden);
  }
  return gefunden;
}

const wurzel = path.join(__dirname, '..', 'node_modules');
if (!fs.existsSync(wurzel)) {
  console.error('node_modules fehlt — erst "npm install" ausführen.');
  process.exit(2);
}

const pakete = sammeln(wurzel);
const zaehler = new Map();
const auffaellig = [];

for (const [name, info] of pakete) {
  const l = info.lizenz || '(keine Angabe)';
  zaehler.set(l, (zaehler.get(l) || 0) + 1);
  if (!info.lizenz || COPYLEFT.test(l) || UNKLAR.test(l)) {
    auffaellig.push(`${name}@${info.version} — ${l}`);
  }
}

console.log(`\n${pakete.size} Pakete installiert\n`);
[...zaehler.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([l, n]) => console.log(`  ${String(n).padStart(4)}x  ${l}`));

if (auffaellig.length) {
  console.log('\nBitte ansehen:');
  auffaellig.forEach((z) => console.log(`  ${z}`));
  console.log('\nCopyleft-Lizenzen vertragen sich nicht ohne Weiteres mit MIT.');
  console.log('Entweder das Paket ersetzen oder die eigene Lizenz anpassen.');
  process.exit(1);
}

console.log('\nAlles freizügig lizenziert — nichts, was der MIT-Lizenz widerspricht.\n');
