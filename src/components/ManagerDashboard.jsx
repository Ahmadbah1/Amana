import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { exportToExcel, exportToPDF } from '../utils/printersAndExports';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { useToast } from './Toast';

const PAGE_SIZE = 20;
const PERIODS = [['TODAY', "Aujourd'hui"], ['D7', '7 jours'], ['D30', '30 jours'], ['ALL', 'Tout']];
const fmt = (n) => Number(n).toLocaleString('fr-FR');

function periodStart(p) {
  const d = new Date();
  if (p === 'TODAY') d.setHours(0, 0, 0, 0);
  else if (p === 'D7') d.setDate(d.getDate() - 7);
  else if (p === 'D30') d.setDate(d.getDate() - 30);
  else return null;
  return d.toISOString();
}

async function fnErrorMessage(error) {
  try { const body = await error.context.json(); return body.error || error.message; }
  catch { return error.message; }
}

export function ManagerDashboard({ profile }) {
  const { notify, toastEl } = useToast();

  const [tab, setTab] = useState('ANALYTICS');
  const [storesList, setStoresList] = useState([]);
  const [activeStoreId, setActiveStoreId] = useState(profile.store_id);
  const [storeInfo, setStoreInfo] = useState({ name: '', logo_url: '', receipt_footer: '' });

  const [period, setPeriod] = useState('D7');
  const [page, setPage] = useState(0);
  const [receipts, setReceipts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [products, setProducts] = useState([]);
  const [team, setTeam] = useState([]);

  const [newProduct, setNewProduct] = useState({ name: '', price: '', stock: '' });
  const [newStoreName, setNewStoreName] = useState('');
  const [member, setMember] = useState({ email: '', password: '', name: '', role: 'employee' });
  const [busy, setBusy] = useState(false);

  const isOwnerManager = profile.role === 'manager';
  const activeRef = useRef(activeStoreId);
  activeRef.current = activeStoreId;

  // ---------- chargement ----------
  const fetchAccessibleStores = useCallback(async () => {
    const { data, error } = await supabase.from('stores').select('*').order('created_at');
    if (error) return notify(error.message, 'error');
    if (data?.length) {
      setStoresList(data);
      if (!data.some((s) => s.id === activeRef.current)) setActiveStoreId(data[0].id);
    }
  }, [notify]);

  useEffect(() => { fetchAccessibleStores(); }, [fetchAccessibleStores]);

  // Infos boutique : chargées uniquement au changement de boutique (n'écrase pas une saisie en cours)
  useEffect(() => {
    if (!activeStoreId) return;
    supabase.from('stores').select('*').eq('id', activeStoreId).single()
      .then(({ data }) => { if (data && activeRef.current === data.id) setStoreInfo(data); });
  }, [activeStoreId]);

  const loadStoreData = useCallback(async (storeId) => {
    let recQuery = supabase.from('receipts').select('*, profiles(full_name)').eq('store_id', storeId)
      .order('created_at', { ascending: false }).limit(2000);
    const start = periodStart(period);
    if (start) recQuery = recQuery.gte('created_at', start);

    const [rec, msg, prods, tm] = await Promise.all([
      recQuery,
      supabase.from('incident_reports')
        .select('*, profiles!reported_by(full_name), receipts(transaction_ref, amount, operator, status)')
        .eq('store_id', storeId).order('created_at', { ascending: false }).limit(200),
      supabase.from('products').select('*').eq('store_id', storeId).order('name'),
      supabase.from('profiles').select('id, full_name, role, is_active').eq('store_id', storeId).order('full_name'),
    ]);
    if (storeId !== activeRef.current) return; // réponse obsolète (changement de boutique entre-temps)

    const failed = [rec, msg, prods, tm].find((r) => r.error);
    if (failed) notify(failed.error.message, 'error');
    if (rec.data) setReceipts(rec.data);
    if (msg.data) setMessages(msg.data);
    if (prods.data) setProducts(prods.data);
    if (tm.data) setTeam(tm.data);
  }, [period, notify]);

  useEffect(() => {
    if (!activeStoreId) return;
    setPage(0);
    loadStoreData(activeStoreId);

    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => loadStoreData(activeStoreId), 400); };
    const filter = `store_id=eq.${activeStoreId}`;
    const channel = supabase
      .channel(`store-realtime-${activeStoreId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incident_reports', filter }, () => {
        notify('🔔 Nouveau signalement reçu', 'warn');
        refresh();
      })
      .subscribe();

    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [activeStoreId, loadStoreData, notify]);

  // ---------- analytics ----------
  const analytics = useMemo(() => {
    const valid = receipts.filter((r) => r.status !== 'CANCELLED');
    const totalRevenue = valid.reduce((s, r) => s + Number(r.amount), 0);
    const sumOp = (op) => valid.filter((r) => r.operator === op).reduce((s, r) => s + Number(r.amount), 0);
    const opData = [
      { name: 'MTN MoMo', value: sumOp('MTN'), color: '#FACC15' },
      { name: 'Orange Money', value: sumOp('ORANGE'), color: '#F97316' },
    ];
    const empMap = {};
    valid.forEach((r) => {
      const name = r.profiles?.full_name || 'Inconnu';
      if (!empMap[name]) empMap[name] = { name, chiffreAffaires: 0 };
      empMap[name].chiffreAffaires += Number(r.amount);
    });
    return {
      totalRevenue, totalCount: valid.length, flaggedCount: receipts.filter((r) => r.status === 'FLAGGED').length,
      opData, empPerf: Object.values(empMap),
    };
  }, [receipts]);

  const pageCount = Math.max(1, Math.ceil(receipts.length / PAGE_SIZE));
  const pagedReceipts = receipts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ---------- actions ----------
  async function handleAddProduct(e) {
    e.preventDefault();
    const { error } = await supabase.from('products').insert([{
      store_id: activeStoreId, name: newProduct.name.trim(),
      price: Number(newProduct.price), stock_quantity: Number(newProduct.stock),
    }]);
    if (error) return notify(error.message, 'error');
    setNewProduct({ name: '', price: '', stock: '' });
    loadStoreData(activeStoreId);
  }

  async function handleRestock(p) {
    const n = parseInt(window.prompt(`Quantité à ajouter pour « ${p.name} » ?`) || '', 10);
    if (!n || n <= 0) return;
    const { error } = await supabase.rpc('restock_product', { p_product_id: p.id, p_qty: n });
    if (error) return notify(error.message, 'error');
    notify('Stock mis à jour.', 'success');
    loadStoreData(activeStoreId);
  }

  async function handleCreateNewStore(e) {
    e.preventDefault();
    const { data, error } = await supabase.from('stores')
      .insert([{ name: newStoreName.trim(), owner_id: profile.id }]).select().single();
    if (error) return notify(error.message, 'error');
    setNewStoreName('');
    await fetchAccessibleStores();
    setActiveStoreId(data.id);
    notify('Nouvelle boutique créée et activée.', 'success');
  }

  async function handleResolve(msg, action) {
    if (action === 'cancel' && !window.confirm('Annuler définitivement ce reçu (le stock sera restitué) ?')) return;
    const { error } = await supabase.rpc('resolve_incident', { p_report_id: msg.id, p_action: action });
    if (error) return notify(error.message, 'error');
    notify('Signalement traité.', 'success');
    loadStoreData(activeStoreId);
  }

  async function saveStoreSettings(e) {
    e.preventDefault();
    const { error } = await supabase.from('stores').update({
      name: storeInfo.name.trim(), logo_url: storeInfo.logo_url || null, receipt_footer: storeInfo.receipt_footer || null,
    }).eq('id', activeStoreId);
    if (error) return notify(error.message, 'error');
    fetchAccessibleStores();
    notify('Paramètres enregistrés.', 'success');
  }

  // Création via Edge Function (la session du gérant n'est PAS remplacée)
  async function addMember(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('create-collaborator', {
      body: {
        email: member.email.trim(), password: member.password, full_name: member.name.trim(),
        store_id: activeStoreId, role: member.role,
      },
    });
    setBusy(false);
    if (error) return notify(await fnErrorMessage(error), 'error');
    if (data?.error) return notify(data.error, 'error');
    notify('Membre ajouté.', 'success');
    setMember({ email: '', password: '', name: '', role: 'employee' });
    loadStoreData(activeStoreId);
  }

  async function toggleMember(p) {
    const { error } = await supabase.rpc('set_profile_active', { p_profile_id: p.id, p_active: !p.is_active });
    if (error) return notify(error.message, 'error');
    loadStoreData(activeStoreId);
  }

  function safeExport(fn) {
    try { fn(); } catch (err) { notify(err.message, 'error'); }
  }

  const unreadAlerts = messages.filter((m) => !m.is_resolved).length;
  const tabBtn = (id, label, extra) => (
    <button onClick={() => setTab(id)} className={`px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 ${tab === id ? 'bg-slate-900 text-white' : 'bg-gray-100'}`}>
      {label}{extra}
    </button>
  );
  const roleLabel = { manager: 'Gérant', collaborator: 'Collaborateur', employee: 'Employé' };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Console Gérant</h1>
          <select value={activeStoreId} onChange={(e) => setActiveStoreId(e.target.value)} className="border-2 border-blue-600 rounded-lg px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-900">
            {storesList.map((s) => <option key={s.id} value={s.id}>🏪 {s.name}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          {tabBtn('ANALYTICS', '📊 Performances')}
          {tabBtn('STOCKS', '📦 Catalogue & Stocks')}
          {tabBtn('MESSAGES', '✉️ Signalements', unreadAlerts > 0 && <span className="bg-red-600 text-white px-1.5 rounded-full text-[10px]">{unreadAlerts}</span>)}
          {tabBtn('SETTINGS', '⚙️ Boutiques & Équipe')}
          <button onClick={() => safeExport(() => exportToExcel(receipts, storeInfo.name))} className="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-semibold">📥 Excel</button>
          <button onClick={() => safeExport(() => exportToPDF(receipts, storeInfo.name, analytics.totalRevenue))} className="bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-semibold">📄 PDF</button>
        </div>
      </div>

      {tab === 'ANALYTICS' && (
        <div className="space-y-6">
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500">Période :</span>
            {PERIODS.map(([id, label]) => (
              <button key={id} onClick={() => setPeriod(id)} className={`px-3 py-1 rounded-full text-xs font-semibold border ${period === id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white'}`}>{label}</button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border shadow-sm">
              <p className="text-xs text-gray-500">Chiffre d'Affaires ({storeInfo.name})</p>
              <p className="text-2xl font-bold mt-1">{fmt(analytics.totalRevenue)} FCFA</p>
            </div>
            <div className="bg-white p-5 rounded-xl border shadow-sm">
              <p className="text-xs text-gray-500">Total Reçus Valides</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">{analytics.totalCount}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border shadow-sm">
              <p className="text-xs text-gray-500">Reçus Signalés</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{analytics.flaggedCount}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-5 rounded-xl border h-72">
              <h3 className="text-xs font-bold mb-2">Performance des Caissiers</h3>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.empPerf}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="chiffreAffaires" fill="#2563EB" /></BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white p-5 rounded-xl border h-72">
              <h3 className="text-xs font-bold mb-2">Répartition MTN vs Orange</h3>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={analytics.opData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>{analytics.opData.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><Tooltip /><Legend /></PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl border overflow-x-auto">
            <div className="p-4 bg-gray-50 font-bold text-xs border-b">Reçus ({receipts.length})</div>
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b text-xs">
                <tr><th className="p-3">Date</th><th className="p-3">Op.</th><th className="p-3">Réf</th><th className="p-3">Articles</th><th className="p-3">Montant</th><th className="p-3">Statut</th><th className="p-3">Caissier</th></tr>
              </thead>
              <tbody className="divide-y">
                {pagedReceipts.map((r) => (
                  <tr key={r.id} className={r.status === 'CANCELLED' ? 'text-gray-400 line-through' : ''}>
                    <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString('fr-FR')}</td>
                    <td className="p-3">{r.operator}</td>
                    <td className="p-3">{r.transaction_ref}</td>
                    <td className="p-3">{r.items_summary || '-'}</td>
                    <td className="p-3">{fmt(r.amount)}</td>
                    <td className="p-3">{r.status}</td>
                    <td className="p-3">{r.profiles?.full_name || '-'}</td>
                  </tr>
                ))}
                {pagedReceipts.length === 0 && <tr><td colSpan="7" className="p-4 text-xs text-gray-500">Aucun reçu sur cette période.</td></tr>}
              </tbody>
            </table>
            <div className="p-3 flex justify-between items-center text-xs border-t">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">← Précédent</button>
              <span>Page {page + 1} / {pageCount}</span>
              <button disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">Suivant →</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'STOCKS' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <form onSubmit={handleAddProduct} className="bg-white p-5 rounded-xl border space-y-4 h-fit">
            <h3 className="font-bold text-sm border-b pb-2">Ajouter un Article au Stock</h3>
            <input type="text" required placeholder="Nom du produit" value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} className="w-full border p-2 rounded text-sm" />
            <input type="number" required min="0" placeholder="Prix unitaire (FCFA)" value={newProduct.price} onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })} className="w-full border p-2 rounded text-sm" />
            <input type="number" required min="0" placeholder="Quantité initiale en stock" value={newProduct.stock} onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })} className="w-full border p-2 rounded text-sm" />
            <button type="submit" className="w-full bg-slate-900 text-white text-xs font-bold py-2.5 rounded">Ajouter au Catalogue</button>
          </form>

          <div className="md:col-span-2 bg-white rounded-xl border overflow-hidden">
            <div className="p-4 bg-gray-50 font-bold text-xs border-b">État des Stocks en Temps Réel ({storeInfo.name})</div>
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b text-xs">
                <tr><th className="p-3">Article</th><th className="p-3">Prix</th><th className="p-3">Stock Restant</th><th className="p-3"></th></tr>
              </thead>
              <tbody className="divide-y">
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className="p-3 font-medium">{p.name}</td>
                    <td className="p-3">{fmt(p.price)} FCFA</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${p.stock_quantity <= 5 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{p.stock_quantity} unités</span>
                    </td>
                    <td className="p-3 text-right"><button onClick={() => handleRestock(p)} className="text-xs border px-2 py-1 rounded">+ Stock</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'SETTINGS' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <form onSubmit={saveStoreSettings} className="bg-white p-5 rounded-xl border space-y-3 h-fit">
            <h3 className="font-bold text-sm border-b pb-2">Personnalisation Reçu</h3>
            <input type="text" value={storeInfo.name || ''} onChange={(e) => setStoreInfo({ ...storeInfo, name: e.target.value })} className="w-full border p-2 rounded text-sm" required />
            <input type="url" placeholder="URL Logo" value={storeInfo.logo_url || ''} onChange={(e) => setStoreInfo({ ...storeInfo, logo_url: e.target.value })} className="w-full border p-2 rounded text-sm" />
            <textarea rows="2" placeholder="Mot de la fin du ticket" value={storeInfo.receipt_footer || ''} onChange={(e) => setStoreInfo({ ...storeInfo, receipt_footer: e.target.value })} className="w-full border p-2 rounded text-sm" />
            <button type="submit" className="w-full bg-slate-900 text-white text-xs py-2 rounded font-semibold">Enregistrer</button>
          </form>

          <form onSubmit={addMember} className="bg-white p-5 rounded-xl border space-y-3 h-fit">
            <h3 className="font-bold text-sm border-b pb-2">Ajouter un Membre d'Équipe</h3>
            <select value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value })} className="w-full border p-2 rounded text-sm">
              <option value="employee">Employé (caisse uniquement)</option>
              <option value="collaborator">Collaborateur (droits gérant)</option>
            </select>
            <input type="text" placeholder="Nom complet" value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} className="w-full border p-2 rounded text-sm" required />
            <input type="email" placeholder="Email" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} className="w-full border p-2 rounded text-sm" required />
            <input type="password" placeholder="Mot de passe (8 car. min.)" minLength={8} value={member.password} onChange={(e) => setMember({ ...member, password: e.target.value })} className="w-full border p-2 rounded text-sm" required />
            <button type="submit" disabled={busy} className="w-full bg-emerald-600 disabled:opacity-60 text-white text-xs py-2 rounded font-semibold">{busy ? 'Création…' : 'Créer le membre'}</button>
          </form>

          {isOwnerManager && (
            <form onSubmit={handleCreateNewStore} className="bg-white p-5 rounded-xl border space-y-3 h-fit">
              <h3 className="font-bold text-sm border-b pb-2">Ouvrir une Nouvelle Boutique</h3>
              <input type="text" placeholder="Nom de la nouvelle succursale" value={newStoreName} onChange={(e) => setNewStoreName(e.target.value)} className="w-full border p-2 rounded text-sm" required />
              <button type="submit" className="w-full bg-blue-600 text-white text-xs py-2 rounded font-semibold">+ Ajouter la Boutique</button>
            </form>
          )}

          <div className="md:col-span-3 bg-white rounded-xl border divide-y text-sm">
            <div className="p-3 bg-gray-50 font-bold text-xs">Équipe de {storeInfo.name}</div>
            {team.map((p) => (
              <div key={p.id} className="p-3 flex justify-between items-center">
                <span>
                  <strong>{p.full_name}</strong> <span className="text-xs text-gray-500">({roleLabel[p.role] || p.role})</span>
                  {!p.is_active && <span className="ml-2 text-[10px] bg-gray-200 px-1.5 py-0.5 rounded">Désactivé</span>}
                </span>
                {p.id !== profile.id && p.id !== storeInfo.owner_id && (
                  <button onClick={() => toggleMember(p)} className="text-xs border px-3 py-1 rounded">{p.is_active ? 'Désactiver' : 'Réactiver'}</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'MESSAGES' && (
        <div className="bg-white rounded-xl border divide-y">
          <div className="p-4 bg-gray-50 font-bold text-xs">Signalements d'erreurs en direct</div>
          {messages.length === 0 ? <p className="p-4 text-xs text-gray-500">Aucun signalement.</p> : messages.map((m) => (
            <div key={m.id} className={`p-4 flex flex-wrap gap-3 justify-between items-start ${!m.is_resolved ? 'bg-red-50/40' : ''}`}>
              <div>
                <p className="text-xs font-bold">{m.profiles?.full_name}</p>
                <p className="text-sm mt-1">Motif : {m.reason}</p>
                <p className="text-xs text-gray-500 mt-1">Ref: {m.receipts?.transaction_ref} ({fmt(m.receipts?.amount ?? 0)} FCFA){m.receipts?.status === 'CANCELLED' ? ' — annulé' : ''}</p>
              </div>
              {!m.is_resolved && (
                <div className="flex flex-wrap gap-2">
                  {m.suggested_amount && <button onClick={() => handleResolve(m, 'apply')} className="bg-emerald-600 text-white px-3 py-1 rounded text-xs">Corriger ({fmt(m.suggested_amount)}F)</button>}
                  <button onClick={() => handleResolve(m, 'dismiss')} className="bg-gray-200 px-3 py-1 rounded text-xs">Valider tel quel</button>
                  <button onClick={() => handleResolve(m, 'cancel')} className="bg-red-100 text-red-700 px-3 py-1 rounded text-xs">Annuler le reçu</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {toastEl}
    </div>
  );
}
