/* Test e2e — Amana (sans réseau, Chromium headless)
   Stubbe Supabase localement (aucune donnée de production) et vérifie dans un vrai
   navigateur : badge gérant, FAB visible, onglet Stats, filtres, visibilité des reçus. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const body = readFileSync(join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html`;

/* ---------- stub Supabase : gérant + une boutique + 3 reçus ---------- */
const ownerId = 'user-owner-1';
const tables = {
  members: [
    { id: 'mem-owner', org_id: 'org-1', user_id: ownerId, role: 'owner', display_name: 'Ahmad', active: true, skills: '' },
    { id: 'mem-emp', org_id: 'org-1', user_id: 'u-emp', role: 'employee', display_name: 'Fatou', active: true, skills: 'vendeur, comptable' },
  ],
  shops: [
    { id: 'shop-1', org_id: 'org-1', name: 'Boutique Test', plan: 'pro' },
  ],
  member_shops: [
    { member_id: 'mem-owner', shop_id: 'shop-1', permissions: { create_receipt: true, view_stats: true, export: true, edit_shop: true, cancel_receipt: true } },
  ],
  organizations: [{ name: 'Org Test', plan: 'pro' }],
  products: [
    { id: 'p1', org_id: 'org-1', shop_id: 'shop-1', name: 'Coca-Cola 33cl', unit: 'u', qty: 18, min_qty: 5, price_fcfa: 500, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: 'p2', org_id: 'org-1', shop_id: 'shop-1', name: 'Biscuits Petit Beurre', unit: 'u', qty: 0, min_qty: 2, price_fcfa: 200, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  stock_movements: [
    { id: 1, org_id: 'org-1', shop_id: 'shop-1', product_id: 'p1', product_name: 'Coca-Cola 33cl', delta: -2, reason: 'vente REC-0003', source: 'receipt', ref_id: 'r1', user_id: ownerId, created_at: new Date().toISOString() },
  ],
  receipts: [
    { id: 'r1', shop_id: 'shop-1', number: 1, customer_name: 'Awa',  method: 'mtn', total: 12000, pay_status: 'ok',  created_at: new Date().toISOString(), created_by: ownerId, canceled_at: null, tx_id: 'TX-1' },
    { id: 'r2', shop_id: 'shop-1', number: 2, customer_name: 'Paul', method: 'om',  total: 6000,  pay_status: 'pend', created_at: new Date().toISOString(), created_by: ownerId, canceled_at: null, tx_id: null },
    { id: 'r3', shop_id: 'shop-1', number: 3, customer_name: 'Ana',  method: 'cash', total: 9000, pay_status: 'chk', created_at: new Date(Date.now() - 30 * 864e5).toISOString(), created_by: ownerId, canceled_at: new Date().toISOString(), tx_id: null },
  ],
};
const stubBody = `
(function(){
  const tables = ${JSON.stringify(tables)};
  const rowsOf = t => tables[t] || [];
  const mkChain = rows => {
    let filtered = [...rows];
    const api = {
      select: () => api,
      eq: (c, v) => { filtered = filtered.filter(r => r[c] === v); return api; },
      order: () => api,
      limit: () => Promise.resolve({ data: filtered, error: null }),
      maybeSingle: () => Promise.resolve({ data: filtered[0] || null, error: null }),
      single: () => Promise.resolve({ data: filtered[0] || null, error: null }),
      insert: () => Promise.resolve({ data: { id: 'new' }, error: null }),
      update: () => Promise.resolve({ data: null, error: null }),
      then: resolve => Promise.resolve({ data: filtered, error: null }).then(resolve),
    };
    return api;
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: tables.members[0].user_id, email: 'owner@amana.test' } } } }),
      onAuthStateChange: () => {},
      signOut: async () => ({}),
      signInWithPassword: async () => ({}),
      signInWithOtp: async () => ({}),
      verifyOtp: async () => ({}),
      signUp: async () => ({}),
    },
    from: t => mkChain(rowsOf(t)),
    rpc: async (name, args) => ({ data: { number: 7 }, error: null }),
    channel: () => { const a = { on() { return a; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return a; } }; return a; },
    removeChannel: () => {},
  };
  window.supabase = { createClient: () => client };
})();`;

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 880 }, serviceWorkers: 'block' });
const problems = [];
context.on('page', p => p.on('pageerror', e => problems.push('pageerror: ' + e.message)));

/* bloquer les CDN et servir le stub */
await context.route('**/*', async route => {
  const u = route.request().url();
  if (/cdn\.jsdelivr\.net\/npm\/@supabase/.test(u)) return route.fulfill({ contentType: 'application/javascript', body: stubBody });
  if (/cdn\.jsdelivr\.net\/npm\/tesseract/.test(u)) return route.fulfill({ contentType: 'application/javascript', body: 'window.Tesseract=undefined;' });
  if (/cdnjs\.cloudflare\.com\/ajax\/libs\/html2canvas/.test(u)) return route.fulfill({ contentType: 'application/javascript', body: 'window.html2canvas=()=>Promise.resolve({toBlob:()=>{},toDataURL:()=>\'data:image/png;base64,\'});' });
  if (/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcodejs/.test(u)) return route.fulfill({ contentType: 'application/javascript', body: 'window.QRCode=function(){};' });
  if (/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/.test(u)) return route.fulfill({ contentType: 'application/javascript', body: 'window.jspdf={jsPDF:function(){this.addImage=()=>{};this.save=()=>{};}};' });
  return route.continue();
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) { passed++; console.log('  ✔ ' + name); } else { failed++; console.log('  ✖ ' + name); } };

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  /* attendre le boot */
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(1200);

  console.log('\n── Amana — e2e gérant ──\n');

  /* 1. gérant : badge + FAB + onglet Stats visibles */
  const badge = await page.locator('#roleBadge').isVisible().catch(() => false);
  const fab = await page.locator('#fab').isVisible().catch(() => false);
  const statsTab = await page.locator('#tStats').isVisible().catch(() => false);
  const kpis = await page.locator('.kpis').count();
  check('badge « Gérant » dans l’en-tête', badge);
  check('FAB « + » visible (gérant crée des reçus)', fab);
  check('onglet Stats visible pour le gérant', statsTab);
  check('KPIs du jour présentes', kpis > 0);

  /* 2. onglet Stats */
  await page.click('#tStats');
  await page.waitForTimeout(700);
  const statsH2 = await page.locator('.hd h2').first().textContent().catch(() => null);
  const statsKpi = await page.locator('.kpis').count();
  const statCards = await page.locator('.card').count();
  check('stats : titre « Statistiques »', statsH2 && /Statistiques/.test(statsH2));
  check('stats : KPI grid présent (≥2)', statsKpi >= 1);
  check('stats : cartes « Par mode / Par statut » présentes (≥2)', statCards >= 2);

  /* 2c. onglet Analytique (gérant) */
  const analyticsTab = await page.locator('#tAnalytics').isVisible().catch(() => false);
  check('onglet Analytique visible pour le gérant', analyticsTab);
  await page.click('#tAnalytics');
  await page.waitForTimeout(1100);
  const anTitle = await page.locator('.hd h2').first().textContent().catch(() => null);
  const anKpis = await page.locator('.an-kpi').count();
  const anCurve = await page.locator('.an-curve svg').count();
  const anDonut = await page.locator('.an-donut svg').count();
  const anBars = await page.locator('.an-bars').count();
  const anCards = await page.locator('.an-emp').count();
  const skillsText = await page.locator('text=vendeur').count();
  check('analytics : titre « Analytique »', anTitle && /Analytique/.test(anTitle));
  check('analytics : KPI automatiques présents (≥4)', anKpis >= 4);
  check('analytics : courbe du CA rendue (SVG)', anCurve === 1);
  check('analytics : anneau de statuts rendu (SVG)', anDonut === 1);
  check('analytics : barres de CA présentes', anBars >= 2);
  check('analytics : fiche employé affichée (1)', anCards === 1);
  check('analytics : compétence déclarée affichée (vendeur)', skillsText >= 1);
  await page.click('button[data-t="receipts"]');
  await page.waitForTimeout(400);

  /* 2b. onglet Stock (gérant) */
  const stockTabVisible = await page.locator('#tStock').isVisible().catch(() => false);
  check('onglet Stock visible pour le gérant', stockTabVisible);
  await page.click('#tStock');
  await page.waitForTimeout(900);
  const stockTitle = await page.locator('.hd h2').first().textContent().catch(() => null);
  const stockRows = await page.locator('.stockrow').count();
  const movsSection = await page.getByText(/Mouvements récents/).count();
  check('stock : titre « Stock / Inventaires »', stockTitle && /Stock/.test(stockTitle));
  check('stock : 2 produits affichés', stockRows === 2);
  check('stock : mouvements récents présents', movsSection >= 1);
  await page.locator('#view .srch').fill('coca');
  await page.waitForTimeout(400);
  const filteredRows = await page.locator('.stockrow').count();
  check('stock : recherche « coca » → 1 produit', filteredRows === 1);
  await page.locator('#view .srch').fill('');
  await page.waitForTimeout(400);
  const allRows = await page.locator('.stockrow').count();
  check('stock : recherche vide → 2 produits', allRows === 2);
  await page.click('button[data-t="receipts"]');
  await page.waitForTimeout(700);

  /* 3. retour Reçus — filtres */
  await page.click('button[data-t="receipts"]');
  await page.waitForTimeout(600);
  const sels = await page.locator('select.fltbox').count();
  const dates = await page.locator('input[type="date"]').count();
  check('filtres : 2 selects (statut, mode)', sels === 2);
  check('filtres : 2 dates (Du/Au)', dates === 2);
  const totalBefore = await page.locator('.rc').count();
  check('filtres : 3 reçus affichés (tous)', totalBefore === 3);

  /* 4. filtre statut = confirmé → 1 reçu (Awa) */
  await page.locator('select.fltbox').first().selectOption('ok');
  await page.waitForTimeout(600);
  const okCount = await page.locator('.rc').count();
  check('filtre statut « ✔ Confirmé » → 1 reçu', okCount === 1);

  /* 5. filtre statut = annulé → 1 reçu (Ana) */
  await page.locator('select.fltbox').first().selectOption('canceled');
  await page.waitForTimeout(600);
  const cancelCount = await page.locator('.rc').count();
  check('filtre statut « Annulé » → 1 reçu', cancelCount === 1);

  /* 6. filtre mode = orange → 1 reçu (Paul) */
  await page.locator('select.fltbox').first().selectOption('all');
  await page.locator('select.fltbox').nth(1).selectOption('om');
  await page.waitForTimeout(600);
  const omCount = await page.locator('.rc').count();
  check('filtre mode Orange → 1 reçu', omCount === 1);

  /* 7. effacement des filtres */
  await page.click('button.chip:has-text("Effacer")');
  await page.waitForTimeout(600);
  const afterReset = await page.locator('.rc').count();
  check('« Effacer » réinitialise → 3 reçus', afterReset === 3);

  /* 8. création de reçu par le gérant — OCR en priorité texte */
  await page.click('#fab');
  await page.waitForSelector('#sheet.open', { timeout: 5000 });
  const sheetTitle = await page.locator('#shT').textContent();
  const pasteZone = await page.locator('#shB textarea').count();
  const photoHint = await page.locator('#shB .ocr').count();
  const manualLbl = await page.locator('#shB').getByText(/Ou saisissez manuellement/).count();
  const createBtn = await page.locator('#shB button.btn').nth(-1).count();
  check('fiche création : titre « Nouveau reçu »', sheetTitle && /Nouveau reçu/.test(sheetTitle));
  check('fiche création : zone de texte (OCR priorité) présente', pasteZone === 1);
  check('fiche création : photo en secours présente', photoHint === 1);
  check('fiche création : saisie manuelle présente', manualLbl >= 1);
  check('fiche création : bouton « Créer le reçu » présent', createBtn === 1);

  /* OCR texte colé → remplit l'article */
  await page.locator('#shB textarea').fill('MTN Mobile Money: votre dépôt de 25000 FCFA a été reçu. Ref: 987654321');
  await page.waitForTimeout(1200);
  const price = await page.locator('#shB .row3 input[placeholder="Prix"]').first().inputValue();
  check('OCR texte colé : prix renseigné (25000)', price === '25000');
  await page.keyboard.press('Escape'); // on referme si possible
  await page.keyboard.press('Enter'); // ne change rien
  /* création réelle */
  const goBtn = page.locator('#shB button.btn').nth(-1);
  await goBtn.click();
  await page.waitForTimeout(1500);
  const toastText = await page.locator('#toast').textContent().catch(() => '');
  const detailTitle = await page.locator('#shT').textContent().catch(() => '');
  check('création : toast « Reçu REC-0007 créé »', /REC-0007/.test(toastText));
  check('création : le reçu s’affiche après création', /Reçu/.test(detailTitle));

  /* refermer le reçu, puis re-fermer la fiche */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  /* 9. bannière temps réel absente (SUBSCRIBED) */
  const rtBannerHidden = await page.locator('#rtWarn[hidden]').count();
  check('bannière temps réel masquée (SUBSCRIBED)', rtBannerHidden === 1);

  /* 10. exceptions JS */
  check('aucune exception JS', errors.length === 0);
  if (errors.length) errors.forEach(e => console.log('    ↳ ' + e));
} catch (e) {
  failed++;
  console.log('  ✖ erreur e2e:', e.message);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} ✔ · ${failed} ✖`);
if (failed) process.exitCode = 1;
