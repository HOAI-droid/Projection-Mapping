import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Projektwurzel = erster Ordner oberhalb dieser Datei mit package.json (klappt für tsx und dist/). */
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

const root = findRoot();
const dataDir = resolve(process.env.DATA_DIR ?? join(root, 'data'));
const certDir = resolve(process.env.CERT_DIR ?? join(root, 'certs'));

export const config = {
  root,
  dev: process.argv.includes('--dev'),
  host: process.env.HOST ?? '0.0.0.0',
  httpsPort: Number(process.env.HTTPS_PORT ?? 8443),
  httpPort: Number(process.env.HTTP_PORT ?? 8080),
  clientDir: join(root, 'dist', 'client'),
  dataDir,
  projectsDir: join(dataDir, 'projects'),
  mediaDir: join(dataDir, 'media'),
  uploadTmpDir: join(dataDir, 'tmp'),
  certFile: join(certDir, 'cert.pem'),
  keyFile: join(certDir, 'key.pem'),
  caFile: join(certDir, 'rootCA.pem'),
  ffmpeg: process.env.FFMPEG ?? 'ffmpeg',
  ffprobe: process.env.FFPROBE ?? 'ffprobe',
  /** Max. Uploadgröße in Bytes (Standard 4 GB) */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 4096) * 1024 * 1024,
};
