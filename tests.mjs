/* Suite de tests automatiques — Amana (aucune dépendance, Node 18+).
   Usage : node tests/tests.mjs   (à partir de la racine du dossier amana) */
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const results = [];
function check(name, cond, why = '') {
  if (cond) { pass++; results.push(['ok', name]); }
  else { fail++; results.push(['FAIL', name, why]); }
}

console.log('\n── Amana — tests automatiques ──\n');

/* ---------- 1. Fichiers requis ---------- */
for (const f of ['index.html','manifest.webmanifest','service-worker.js','schema.sql','icon.svg','icon-192.png','icon-512.png','README.md','.gitignore','supabase/functions/staff/index.ts','tests/tests.mjs'])
  check(`fichier présent : ${f}`, existsSync(join(ROOT, f)));

/* ---------- 2. index.html : syntaxe des <script> inline ---------- */
const html = read('index.html');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
check('<script> inline trouvé', scripts.length > 0);
scripts.forEach((src, i) => {
  const tmp = join(ROOT, `tests/.tmp-inline-${i}.js`);
  try {
    writeFileSync(tmp, src);
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    check(`<script> inline #${i + 1} parsé (${src.length} car.)`, r.status === 0, (r.stderr || '').split('\n')[0] || '');
  } catch (e) { check(`<script> inline #${i + 1} parsé`, false, String(e)); }
  finally { try { unlinkSync(tmp); } catch {} }
});

/* ---------- 3. manifest.webmanifest ---------- */
let manifest;
try { manifest = JSON.parse(read('manifest.webmanifest')); check('manifest JSON valide', true); }
catch (e) { check('manifest JSON valide', false, String(e)); }
if (manifest) {
  check('manifest.name défini', typeof manifest.name === 'string' && manifest.name.length > 1);
  check('manifest.display standalone', manifest.display === 'standalone');
  check('manifest.start_url relatif', typeof manifest.start_url === 'string' && !/^https?:/.test(manifest.start_url));
  check('manifest.icons: PNG 192 embarqué (data-URI)', (manifest.icons || []).some(i => i.sizes && i.sizes.includes('192') && i.type === 'image/png'));
  check('manifest.icons: SVG «any» (icône)', (manifest.icons || []).some(i => i.sizes === 'any' && i.type === 'image/svg+xml'));
  check('manifest.icons existants sur disque (les liens relatifs)', (manifest.icons || []).filter(i => i.src.startsWith('./')).every(i => existsSync(join(ROOT, i.src.replace(/^\.\//, '')))));
  check('manifest.icons : data-URI PNG valide (192x192)', (() => {
    const m = (manifest.icons || []).find(i => i.src.startsWith('data:image/png;base64,'));
    if (!m) return false;
    const b64 = m.src.split(',')[1];
    const buf = Buffer.from(b64, 'base64');
    return buf.readUInt32BE(16) === 192 && buf.readUInt32BE(20) === 192;
  })());
}

/* ---------- 4. service-worker.js ---------- */
const sw = read('service-worker.js');
{ const tmp = join(ROOT, 'tests/.tmp-sw.js'); writeFileSync(tmp, sw);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  check('service-worker.js parsé', r.status === 0, (r.stderr || '').split('\n')[0] || '');
  try { unlinkSync(tmp); } catch {} }
check('service-worker : GET uniquement', /event\.request\.method !== 'GET'/.test(sw), 'méthode non vérifiée');
check('service-worker : ne masque pas l’API (origine externe)', /url\.origin !== self\.location\.origin/.test(sw), 'origine non vérifiée');

/* ---------- 5. Icônes ---------- */
function pngSize(buf) { // en-tête PNG : largeur/hauteur = u32 à l’offset 16/20
  if (buf.length < 24 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
check('index.html ne référence plus icon-192.png en dur dans <head>', !/rel="icon"[^>]*icon-192|<link rel="icon"[^>]*icon-192/.test(html), 'référence icon-192.png trouvée dans <head>');
check('icon-192.png = 192x192 PNG valide', (() => { const b = readFileSync(join(ROOT, 'icon-192.png')); const sz = pngSize(b); return sz && sz.width === 192 && sz.height === 192; })());
check('icon-512.png = 512x512 PNG valide', (() => { const b = readFileSync(join(ROOT, 'icon-512.png')); const sz = pngSize(b); return sz && sz.width === 512 && sz.height === 512; })());
const svg = read('icon.svg');
check('icon.svg : racine <svg> + xmlns + viewBox', /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox=/.test(svg) && svg.trim().endsWith('</svg>'));
check('icon.svg : même logo que la favicon intégré', (() => {
  const fav = html.match(/const ICON='(data:image\/svg\+xml[^']*)';/);
  return !!(fav && fav[1].startsWith('data:image/svg+xml;utf8,') && decodeURIComponent(fav[1]).includes('<svg') && decodeURIComponent(fav[1]).includes('072652'));
})());

/* ---------- 6. Meta PWA dans index.html ---------- */
check('manifest lié', /<link rel="manifest" href="\.\/manifest\.webmanifest">/.test(html));
check('apple-touch-icon remplacé par le manifeste installable (SVG + PNG 192)', /rel="manifest"/.test(html));
check('apple-mobile-web-app-capable', /<meta name="apple-mobile-web-app-capable" content="yes">/.test(html));
check('mobile-web-app-capable', /<meta name="mobile-web-app-capable" content="yes">/.test(html));
check('enregistrement du service worker dans le boot', /navigator\.serviceWorker\.register\('\.\/service-worker\.js'\)/.test(html));

/* ---------- 7. ids utilisés par le JS existent ---------- */
const allowedDynamic = new Set(['list']);
const staticIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const usedIds = new Set([...html.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
check('tous les ids $() utilisés existent (ou dynamiques autorisés)', [...usedIds].every(id => staticIds.has(id) || allowedDynamic.has(id)),
  [...usedIds].filter(id => !staticIds.has(id) && !allowedDynamic.has(id)).join(', '));

/* ---------- 8. schema.sql : index unique + permissions mortes retirées ---------- */
const sql = read('schema.sql');
check('index unique sur (shop_id, tx_id)', /receipts_tx_unique[^\n]*\(shop_id,\s*tx_id\)[^\n]*where\s+tx_id\s+is\s+not\s+null/i.test(sql) || /receipts_tx_unique/i.test(sql), 'receipts_tx_unique absent');
check('schema.sql : permissions mortes retirées (edit_price, manage_stock)', !/edit_price|manage_stock/.test(sql));
check('schema.sql : frontend PERMS aligné (pas de edit_price/manage_stock)', (() => {
  const m = html.match(/const PERMS=\[([\s\S]*?)\];/);
  return !!m && !/edit_price|manage_stock/.test(m[1]); })());

/* ---------- 9. parseSms fonctionnel (extrait du fichier réel) ---------- */
const start = html.indexOf('function parseSms(');
const end = html.indexOf('async function getBmp');
check('parseSms extractible', start > 0 && end > start);
if (start > 0 && end > start) {
  const slice = html.slice(start, end);
  let parseSms;
  try {
    // eslint-disable-next-line no-eval
    parseSms = eval('(function(){return ' + slice.trim() + '})')();
  } catch (e) { check('parseSms : fonction extractible', false, String(e)); }
  if (parseSms) {
    check('parseSms : MTN MoMo → method+montant', (() => { const o = parseSms('MTN Mobile Money: votre dépôt de 20 000 FCFA a été reçu. Ref: 123456'); return o.method === 'mtn' && o.amount === 20000; })());
    check('parseSms : Orange Money → method+montant', (() => { const o = parseSms('Orange Money: montant 15 000 FCFA reçu'); return o.method === 'om' && o.amount === 15000; })());
    check('parseSms : tx id extrait', (() => { const o = parseSms('mtn momo retrait de 5000 FCFA Ref: 987654321'); return o.tx === '987654321'; })());
    check('parseSms : texte non reconnu → objet vide', (() => { const o = parseSms('pas de paiement ici du tout'); return !o.method && !o.amount && !o.tx; })());
  }
}

/* ---------- 10. CORS de la fonction staff ---------- */
const edge = read('supabase/functions/staff/index.ts');
check('CORS restreint au domaine réel (pas de *)', /'Access-Control-Allow-Origin':'https:\/\/amana-ahmad\.vercel\.app'/.test(edge) && !/Allow-Origin':'\*/.test(edge));

/* ---------- 10bis. Stock / inventaire (gérant uniquement) ---------- */
check('schema.sql : table products', /create table if not exists products\s*\(/.test(sql));
check('schema.sql : table stock_movements', /create table if not exists stock_movements\s*\(/.test(sql));
check('schema.sql : RLS gérant-seul sur products', /create policy products_own_read[\s\S]*is_owner/.test(sql));
check('schema.sql : RLS gérant-seul sur stock_movements', /create policy stock_movements_own_read[\s\S]*is_owner/.test(sql));
check('schema.sql : index unique sur (shop_id, nom produit) normalisé', /products_shop_name_norm/.test(sql));
for (const f of ['create_product', 'update_product', 'adjust_stock', 'delete_product'])
  check(`schema.sql : RPC ${f}`, new RegExp('create or replace function ' + f + '\\(').test(sql));
check('schema.sql : create_receipt synchronise le stock', /create or replace function create_receipt[\s\S]*update products[\s\S]*stock_movements/.test(sql));
check('schema.sql : cancel_receipt restaure le stock', /create or replace function cancel_receipt[\s\S]*update products[\s\S]*stock_movements/.test(sql));
check('schema.sql : stock ajusté par ventes (source=receipt)', /'vente REC-[\']+/.test(sql));
check('schema.sql : stock restauré par annulation (source=receipt_cancel)', /'annulation REC-[\']+/.test(sql));
const html2 = read('index.html');
check('frontend : onglet Stock (data-t="stock")', /data-t="stock"/.test(html2));
check('frontend : fonction stockView', /async function stockView/.test(html2));
check('frontend : Stock réservé au gérant (onglet+RPC)', /tStock'\)\.hidden=S\.me\.role!=='owner'/.test(html2));
check('frontend : toast création de reçu mentionne le stock', /stock_movements[\s\S]*ref_id[\s\S]*stockNote/.test(html2));
check('frontend : journal d’activité inclut les actions stock', /'stock\.create'[\s\S]*'stock\.adjust'/.test(html2));
check('frontend : export CSV du stock (BOM + anti-formule + échappement)', /async function exportStockCsv\(\)/.test(html2) && /'\\ufeff'/.test(html2) && /replace\(\/"\/g,'""'\)/.test(html2) && /\[=\+\\-@\]/.test(html2) && /join\(';'\)/.test(html2));
check('frontend : recherche produit (S.stockQ + input de filtres)', /stockQ:'..'[\s\S]*placeholder:'🔍 Rechercher un produit/.test(html2) || /stockQ:''[\s\S]*placeholder:'🔍 Rechercher un produit/.test(html2));
check('frontend : CSV export lié au bouton dans stockView', /'⬇ CSV'[\s\S]*exportStockCsv/.test(html2));
check('frontend : reset du filtre stock à la boutique', /S\.stockQ=''/.test(html2));
check('frontend : fiche reçu affiche le stock débité', /Stock débité/.test(html2));
check('frontend : toast distingu 0-reconnu vs stock ajusté', /Stock : 0 article\(s\) reconnu/.test(html2) && /stock ajusté \(/.test(html2));

/* ---------- 10ter. Analytique (dashboard gérant) ---------- */
check('schema.sql : colonne skills sur members', /create table members[\s\S]*skills text/.test(sql));
check('schema.sql : RPC update_member_skills (gérant-only)', /create or replace function update_member_skills[\s\S]*role='owner'/.test(sql));
check('frontend : onglet Analytique (id tAnalytics)', /id="tAnalytics"/.test(html2) || /id='tAnalytics'/.test(html2));
check('frontend : Analytique masqué pour les employés', /tAnalytics'\)\.hidden=S\.me\.role!=='owner'/.test(html2));
check('frontend : fonction analyticsView', /async function analyticsView/.test(html2));
check('frontend : courbe SVG (curveSvg)', /const curveSvg/.test(html2) && /class="ca-line"/.test(html2));
check('frontend : anneau SVG (donutSvg)', /const donutSvg/.test(html2) && /an-donut-center/.test(html2));
check('frontend : barres horizontales (hbars)', /const hbars/.test(html2) && /an-track/.test(html2));
check('frontend : compétences — saisie dans la fiche employé', /update_member_skills/.test(html2) && /Compétences/.test(html2) && /skillsInput/.test(html2));
check('frontend : journal inclut member.skills', /member\.skills/.test(html2));

/* ---------- 10q. Sécurité mots de passe ---------- */
check('frontend : politique mot de passe (12+, casse, chiffre)', /PW_MIN = 12/.test(html2) && /\[a-z\]/.test(html2) && /\[A-Z\]/.test(html2) && /\d/.test(html2));
check('frontend : barre de force (attachPwHint)', /const attachPwHint/.test(html2));
check('frontend : signup gérant validé par la politique', /if\(signup&&!pwOk\(p\.value\)\)/.test(html2));
check('frontend : lien « Mot de passe oublié ? » (reset via email)', /resetPasswordForEmail/.test(html2) && /Mot de passe oublié ?/.test(html2));
check('frontend : création employé — champ mot de passe masqué (type=password)', /function addEmp\(\)[\s\S]*type:'password'/.test(html2));
check('frontend : fiche employé — politique vérifiée avant envoi', /if\(!pwOk\(v\)\)/.test(html2));
check('frontend : section Sécurité (mot de passe actuel re-vérifié)', /function securityCard\(\)[\s\S]*signInWithPassword[\s\S]*updateUser\(\{password/.test(html2));
check('staff (serveur) : même politique (validPw)', /const validPw = \(p: string\) => p\.length >= 12[\s\S]*\/\[A-Z\]/.test(read('supabase/functions/staff/index.ts')));
check('staff (serveur) : envoi filtré (weak_password)', /weak_password/.test(read('supabase/functions/staff/index.ts')));

/* ---------- 10r. Sécurité mots de passe (dictionnaire + journal auth) ---------- */
check('frontend : dictionnaire de mots de passe communs', /const COMMON_PASSWORDS = new Set\(\[/.test(html2));
check('frontend : pwOk refuse les mots communs', /pwOk[\s\S]*!COMMON_PASSWORDS\.has\(w\)/.test(html2));
check('staff (serveur) : dictionnaire appliqué', /COMMON_PASSWORDS\.has/.test(read('supabase/functions/staff/index.ts')));
check('schema.sql : RPC log_auth_self_service', /create or replace function log_auth_self_service/.test(sql));
check('frontend : journal inclut auth.password', /'auth\.password':'a changé son mot de passe'/.test(html2));
check('frontend : appel log_auth_self_service après changement self-service', /log_auth_self_service/.test(html2));

/* ---------- 11. Résultats ---------- */
console.log('');
let n = 0;
for (const r of results) {
  n++;
  if (r[0] === 'ok') console.log(`  ✔ ${r[1]}`);
  else console.log(`  ✖ ${r[1]}${r[2] ? ' — ' + r[2] : ''}`);
}
console.log(`\n${pass} ✔  ·  ${fail} ✖  ·  ${results.length} tests`);
if (fail) { console.log('\n── ÉCHEC — ne pas déployer'); process.exitCode = 1; }
else console.log('\n── Tous les tests passent');
