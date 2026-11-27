/* Vérifie que le site servi sert bien le fichier local (anti double-échappement/staleness).
   Usage : node tests/check-served.mjs [URL]
   Par défaut : https://amana-ahmad.vercel.app/
   Sortie : exit 0 si le sha256 servi = le sha256 en local ; sinon exit 1. */
import { createHash } from 'node:crypto';
import { readFileSync as rfs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'https://amana-ahmad.vercel.app/';

const res = await fetch(url, { redirect: 'follow' });
const body = await res.text();
const local = rfs(join(ROOT, 'index.html'), 'utf8');

const sha256 = t => createHash('sha256').update(t).digest('hex');
const servedHash = sha256(body);
const localHash = sha256(local);

console.log('── Amana — vérification du déploiement servi ──');
console.log('  URL          :', url, `(HTTP ${res.status})`);
console.log('  Served bytes :', body.length);
console.log('  Local bytes  :', local.length);
console.log('  sha256 servi :', servedHash);
console.log('  sha256 local :', localHash);

const problems = [];
if (res.status !== 200) problems.push(`HTTP ${res.status}`);
if (body.includes('\\u') || body.includes('\\n')) problems.push('le HTML servi contient des séquences d’échappement au lieu du contenu réel (double-échappement ?)');
if (!body.includes('<script>')) problems.push('le HTML servi ne contient pas de bloc <script>');

if (servedHash === localHash) {
  console.log('\n✅ OK — le déploiement servi = le fichier local (byte-à-byte).');
} else {
  if (problems.length === 0) problems.push('le sha256 servi ne correspond pas au fichier local (déployé daté ou mal servi ?)');
  console.log('\n❌ ÉCHEC du déploiement servi :');
  for (const p of problems) console.log('  • ' + p);
  process.exitCode = 1;
}
