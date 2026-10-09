// Einstiegspunkt: HTTP(S)-Server, API, Auslieferung des Frontends, WebSocket.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces, hostname } from 'node:os';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { surfacesOf } from '../shared/state.js';
import { config } from './config.js';
import { Hub } from './hub.js';
import { checkFfmpeg, isImageUpload, isVideoUpload, MediaLibrary } from './media.js';
import { Store } from './store.js';

const PAGES: Record<string, string> = { '/control': 'control.html', '/output': 'output.html' };

async function main(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });

  const ffmpegVersion = await checkFfmpeg();
  if (!ffmpegVersion) console.warn('⚠  ffmpeg nicht gefunden – Video-Uploads werden fehlschlagen. (sudo apt install ffmpeg)');

  const store = new Store();
  await store.init();
  const media = new MediaLibrary();
  await media.init();
  const hub = new Hub(store, media);
  media.onChange = () => hub.broadcastMedia();

  const app = express();
  app.disable('x-powered-by');

  // --- API -----------------------------------------------------------------
  const upload = multer({
    dest: config.uploadTmpDir,
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      cb(null, isVideoUpload(file.mimetype, file.originalname) || isImageUpload(file.mimetype, file.originalname));
    },
  });

  app.get('/api/media', (_req, res) => {
    res.json(media.list());
  });

  app.post('/api/media', upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(415).json({ error: 'Bitte ein Video oder Bild auswählen' });
      return;
    }
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const kind = isImageUpload(req.file.mimetype, name) ? 'image' : 'video';
    const item = await media.add(req.file.path, name, kind);
    hub.broadcastMedia();
    res.status(202).json(item);
  });

  app.delete('/api/media/:id', async (req, res) => {
    const id = req.params.id;
    if (!(await media.remove(id))) {
      res.status(404).json({ error: 'Nicht gefunden' });
      return;
    }
    // Flächen, die das Medium zeigen, leeren
    for (const s of surfacesOf(store.state.project)) {
      if ((s.content.type === 'video' || s.content.type === 'image') && s.content.mediaId === id) {
        const op = { kind: 'setContent', surfaceId: s.id, content: { type: 'none' } } as const;
        store.apply(op);
        hub.broadcast({ t: 'op', op });
      }
    }
    res.status(204).end();
  });

  app.get('/api/info', (_req, res) => {
    res.json({ https: hasCerts(), addresses: lanAddresses(), hostname: hostname(), ffmpeg: ffmpegVersion });
  });

  // Medien (Range-Requests für Video unterstützt express.static von Haus aus)
  app.use('/media', express.static(config.mediaDir, { maxAge: '1h', index: false, dotfiles: 'deny' }));

  app.get(['/rootCA.crt', '/rootCA.pem'], sendRootCa);

  // --- Frontend ------------------------------------------------------------
  let server: http.Server;
  if (hasCerts()) {
    server = https.createServer({ cert: readFileSync(config.certFile), key: readFileSync(config.keyFile) }, app);
  } else {
    server = http.createServer(app);
  }

  if (config.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: join(config.root, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'mpa',
    });
    app.use((req, _res, next) => {
      const page = PAGES[req.path];
      if (page) req.url = `/${page}`;
      next();
    });
    app.use(vite.middlewares);
  } else {
    if (!existsSync(join(config.clientDir, 'index.html'))) {
      console.error('Frontend nicht gebaut. Bitte „npm start“ (baut automatisch) oder „npm run build“ ausführen.');
      process.exit(1);
    }
    for (const [route, file] of Object.entries(PAGES)) {
      app.get(route, (_req, res) => res.sendFile(join(config.clientDir, file), { headers: { 'Cache-Control': 'no-cache' } }));
    }
    app.use(
      express.static(config.clientDir, {
        setHeaders: (res, path) => {
          if (path.includes(`${join('dist', 'client', 'assets')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const tooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    if (!tooLarge) console.error(err);
    res.status(tooLarge ? 413 : 500).json({ error: tooLarge ? 'Datei ist zu groß' : 'Serverfehler' });
  });

  hub.attach(server);

  const mainPort = hasCerts() ? config.httpsPort : config.httpPort;
  server.listen(mainPort, config.host, () => printUrls(mainPort));

  // Bei HTTPS zusätzlich ein kleiner HTTP-Server: Zertifikat herunterladen + Weiterleitung
  if (hasCerts()) {
    http
      .createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/rootCA.crt' || url.pathname === '/rootCA.pem') {
          sendRootCa(req as unknown as Request, res as unknown as Response);
          return;
        }
        if (url.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(certLandingPage(req.headers.host ?? ''));
          return;
        }
        const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
        res.writeHead(302, { Location: `https://${host}:${config.httpsPort}${req.url ?? '/'}` });
        res.end();
      })
      .listen(config.httpPort, config.host);
  }

  const shutdown = async () => {
    console.log('\nBeende …');
    await store.flush().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function hasCerts(): boolean {
  return existsSync(config.certFile) && existsSync(config.keyFile);
}

function sendRootCa(_req: Request, res: Response): void {
  if (!existsSync(config.caFile)) {
    res.status(404).type('text/plain').send('Kein Root-Zertifikat vorhanden. Auf dem Server „npm run certs“ ausführen.');
    return;
  }
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="Projection-Mapping-rootCA.crt"');
  res.end(readFileSync(config.caFile));
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function printUrls(port: number): void {
  const proto = hasCerts() ? 'https' : 'http';
  const local = `${proto}://localhost:${port}`;
  console.log(`\nProjection Mapping läuft${config.dev ? ' (Entwicklungsmodus)' : ''}.`);
  console.log(`  Steuerung: ${local}/control`);
  console.log(`  Ausgabe:   ${local}/output   (oder in der Steuerung „Ausgabe öffnen“)`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    for (const h of [...lanAddresses(), `${hostname()}.local`]) console.log(`  Im Netz:   ${proto}://${h}:${port}/control`);
  }
  console.log('');
  if (process.platform === 'darwin' && !config.dev && process.env.NO_OPEN !== '1') {
    // Steuerung direkt in Chrome öffnen (fällt auf den Standardbrowser zurück)
    const child = spawn('open', ['-a', 'Google Chrome', `${local}/control`], { stdio: 'ignore' });
    child.on('exit', (code) => {
      if (code !== 0) spawn('open', [`${local}/control`], { stdio: 'ignore' });
    });
  }
}

function certLandingPage(host: string): string {
  const h = host.replace(/:\d+$/, '');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zertifikat installieren</title>
<style>body{font:17px/1.5 -apple-system,system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:24px;max-width:640px}
a.btn{display:block;background:#3a7bd5;color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;margin:12px 0;text-align:center}
ol{padding-left:20px}li{margin:6px 0}code{background:#222;padding:2px 6px;border-radius:6px}</style></head><body>
<h1>Projection Mapping</h1>
<p>Damit iPhone und iPad der verschlüsselten Verbindung vertrauen, einmalig das Root-Zertifikat installieren:</p>
<a class="btn" href="/rootCA.crt">1. Zertifikat herunterladen</a>
<ol>
<li>„Zulassen“ tippen → „Profil wurde geladen“.</li>
<li><b>Einstellungen</b> → oben „Profil geladen“ (oder Allgemein → VPN und Geräteverwaltung) → Profil wählen → <b>Installieren</b>.</li>
<li><b>Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen</b> → Schalter beim mkcert-Zertifikat <b>einschalten</b>.</li>
</ol>
<a class="btn" href="https://${h}:${config.httpsPort}/">2. Zur App (HTTPS)</a>
</body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
