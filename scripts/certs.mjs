#!/usr/bin/env node
// Erzeugt mit mkcert ein lokales HTTPS-Zertifikat für alle IP-Adressen und Namen dieses Rechners.
// Aufruf: npm run certs   (zusätzliche Namen/IPs: npm run certs -- 192.168.1.50 beamer.local)

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = process.env.CERT_DIR ?? join(root, 'certs');

function mkcert(args, opts = {}) {
  return execFileSync('mkcert', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

try {
  mkcert(['-help']);
} catch {
  console.error('mkcert ist nicht installiert. Auf Zorin/Ubuntu: sudo apt install mkcert libnss3-tools');
  process.exit(1);
}

const ips = [];
for (const list of Object.values(networkInterfaces())) {
  for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
}
const host = hostname();
const names = [...new Set(['localhost', '127.0.0.1', host, `${host}.local`, ...ips, ...process.argv.slice(2)])];

console.log('Lokale Zertifizierungsstelle einrichten (mkcert -install) …');
mkcert(['-install'], { stdio: 'inherit' });

mkdirSync(certDir, { recursive: true });
console.log(`Zertifikat für: ${names.join(', ')}`);
mkcert(['-cert-file', join(certDir, 'cert.pem'), '-key-file', join(certDir, 'key.pem'), ...names], { stdio: 'inherit' });

const caRoot = mkcert(['-CAROOT']).trim();
copyFileSync(join(caRoot, 'rootCA.pem'), join(certDir, 'rootCA.pem'));

console.log(`
Fertig. Zertifikate liegen in ${certDir}
Nächste Schritte:
  1. Server (neu) starten: npm start
  2. Auf iPhone/iPad in Safari öffnen: http://${ips[0] ?? host + '.local'}:${process.env.HTTP_PORT ?? 8080}/
     → Root-Zertifikat laden, installieren und vertrauen (siehe README).
Wichtig: Ändert sich die IP-Adresse des Servers, „npm run certs“ erneut ausführen
(oder im Router eine feste IP vergeben).`);
