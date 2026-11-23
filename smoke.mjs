/* Test de fumée — Amana : charge la page dans un vrai navigateur (Chromium headless)
   et vérifie que le boot ne lève aucune exception et que l'UI se rend. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const body = readFileSync(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html`;

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 860 } });
const page = await context.newPage();
const problems = [];
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
page.on('requestfailed', req => {
  const u = req.url();
  if (!u.includes('cdn.jsdelivr.net') && !u.includes('cdnjs.cloudflare.com') && !u.includes('supabase.co')) problems.push('requestfailed (non-CDN): ' + u);
});

const errors = [];
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  /* attendre que le boot se termine (splash masqué) ou que l'auth s'affiche */
  await Promise.race([
    page.waitForSelector('#auth:not([hidden])', { timeout: 20000 }).catch(() => {}),
    page.waitForSelector('#splash[hidden]', { timeout: 20000 }).catch(() => {}),
    new Promise(r => setTimeout(r, 22000)),
  ]);
  const state = await page.evaluate(() => ({
    authVisible: !document.getElementById('auth').hidden,
    splashHidden: document.getElementById('splash').hidden || document.getElementById('splash').style.opacity === '0',
    splashHiddenAttr: document.getElementById('splash').hidden,
    authH1: (document.querySelector('#authbox h1') || {}).textContent || null,
    authHasButton: !!document.querySelector('#authbox button'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    manifestLinked: !!document.querySelector('link[rel="manifest"]'),
    splashImgOk: (document.getElementById('splashImg').src || '').startsWith('data:image/svg+xml'),
    splashImgOk: (document.getElementById('splashImg').src || '').startsWith('data:image/svg+xml'),
    manifestHref: (document.querySelector('link[rel="manifest"]') || {}).href || null,
    headLinks: {
      manifest: !!document.querySelector('link[rel="manifest"]'),
      appleTouchIcon: !!document.querySelector('link[rel="apple-touch-icon"]'),
      themeColor: !!document.querySelector('meta[name="theme-color"]'),
    }
  }));
  console.log('\n── Amana — fumée (navigateur réel) ──\n');
  console.log('  auth visible :', state.authVisible);
  console.log('  splash masqué :', state.splashHidden, '(attribut hidden :', state.splashHiddenAttr + ')');
  console.log('  h1 :', state.authH1);
  console.log('  bouton connexion :', state.authHasButton);
  console.log('  manifest lié :', state.headLinks.manifest);
  console.log('  apple-touch-icon :', state.headLinks.appleTouchIcon);
  console.log('  theme-color :', state.headLinks.themeColor);
  console.log('  splash img (SVG data-URI) :', state.splashImgOk);
  console.log('  manifest href :', state.manifestHref);
  /* fetch manifest et service-worker via le même serveur */
  const resManifest = await page.evaluate(async (u) => { const r = await fetch(new URL('./manifest.webmanifest', u)); return { status: r.status, type: r.headers.get('content-type'), size: (await r.text()).length }; }, url);
  const resSw = await page.evaluate(async (u) => { const r = await fetch(new URL('./service-worker.js', u)); return { status: r.status, size: (await r.text()).length }; }, url);
  console.log('  manifest servi :', resManifest.status, resManifest.type, resManifest.size, 'car.');
  console.log('  service-worker servi :', resSw.status, resSw.size, 'car.');
  if (!state.authVisible) { console.log('  ⚠ l\'écran de connexion n\'est pas visible — impossible de vérifier'); process.exitCode = 1; }
  if (problems.length) {
    const real = problems.filter(p => !p.includes('Failed to load resource') && !p.includes('favicon'));
    if (real.length) { console.log('\n✖ exceptions JS:'); real.forEach(p => console.log('  ', p)); process.exitCode = 1; }
    else if (problems.length) console.log('\n  (sauf avertissements réseau non bloquants :', problems.join(' | ') + ')');
  }
  if (resManifest.status !== 200) { console.log('✖ manifest non servi (', resManifest.status, ')'); process.exitCode = 1; }
} catch (e) {
  console.error('✖ erreur du test de fumée :', e);
  process.exitCode = 1;
} finally {
  await context.close(); await browser.close(); server.close();
}
