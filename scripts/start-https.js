'use strict';

// Startet die Software als Testinstanz ueber HTTPS, damit der Barcode-Scan am
// Handy funktioniert (Browser geben die Kamera nur im sicheren Kontext frei).
//
//   npm run https
//
// Ermittelt die LAN-Adresse selbst, prueft das Zertifikat dazu und setzt
// BASE_URL, damit die QR-Codes stimmen. PowerShell kann keine
// Umgebungsvariablen vor den Befehl schreiben — darum dieses Skript.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const WURZEL = path.join(__dirname, '..');
const TLS_DIR = path.join(WURZEL, 'tls');
const KEY = path.join(TLS_DIR, 'test.key');
const CRT = path.join(TLS_DIR, 'test.crt');
const PORT = Number(process.env.PORT) || 8443;

/** Erste echte LAN-Adresse. Virtuelle Adapter (Hyper-V, WSL) werden uebergangen. */
function lanAdresse() {
  const kandidaten = [];
  for (const [name, adressen] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtual|wsl|loopback|docker/i.test(name)) continue;
    for (const a of adressen || []) {
      if (a.family === 'IPv4' && !a.internal) kandidaten.push({ name, ip: a.address });
    }
  }
  // Übliche Heimnetz-Bereiche bevorzugen.
  const bevorzugt = kandidaten.find((k) => /^192\.168\./.test(k.ip)) || kandidaten[0];
  return bevorzugt || null;
}

function zertifikatPasst(ip) {
  try {
    const text = execFileSync('openssl', ['x509', '-in', CRT, '-noout', '-ext', 'subjectAltName'], {
      encoding: 'utf8',
    });
    return text.includes(ip);
  } catch {
    return null; // openssl nicht da — dann eben nicht pruefen
  }
}

function zertifikatErzeugen(ip) {
  fs.mkdirSync(TLS_DIR, { recursive: true });
  console.log(`Erzeuge selbstsigniertes Zertifikat für ${ip} …`);
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
      '-keyout', KEY, '-out', CRT,
      '-subj', `/CN=${ip}`,
      '-addext', `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
}

const netz = lanAdresse();
if (!netz) {
  console.error('Keine LAN-Adresse gefunden. Ist der Rechner im Netzwerk?');
  process.exit(1);
}

if (!fs.existsSync(KEY) || !fs.existsSync(CRT)) {
  try {
    zertifikatErzeugen(netz.ip);
  } catch (err) {
    console.error('Zertifikat konnte nicht erzeugt werden:', err.message);
    console.error('OpenSSL fehlt? Dann von Hand anlegen — der Befehl steht in der README.');
    process.exit(1);
  }
} else {
  const passt = zertifikatPasst(netz.ip);
  if (passt === false) {
    console.warn(`WARNUNG: Das Zertifikat in tls/ gilt nicht für ${netz.ip}.`);
    console.warn('Die IP hat sich wohl geändert (DHCP). Zertifikat neu erzeugen:');
    console.warn('  rm -rf tls  und dieses Skript erneut starten.');
    console.warn('Achtung: danach stimmen gedruckte QR-Codes nicht mehr.\n');
  }
}

const basis = `https://${netz.ip}:${PORT}`;
console.log(`Netzwerkadapter: ${netz.name}`);
console.log(`Adresse für das Handy: ${basis}`);
console.log('');

const kind = spawn(process.execPath, [path.join(WURZEL, 'server.js')], {
  cwd: WURZEL,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '0.0.0.0',
    TLS_KEY: KEY,
    TLS_CERT: CRT,
    BASE_URL: basis,
    DATA_DIR: process.env.DATA_DIR || path.join(WURZEL, 'data-test'),
    SESSION_SECRET: process.env.SESSION_SECRET || 'testinstanz-nur-lokal',
  },
});

kind.on('exit', (code) => process.exit(code ?? 0));
