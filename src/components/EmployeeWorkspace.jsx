import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { parseMobileMoneyReceipt } from '../utils/ocrParser';
import { connectThermalPrinter, printViaBluetooth, printStandardTicket } from '../utils/printersAndExports';
import { useToast } from './Toast';

export function EmployeeWorkspace({ profile }) {
  const { notify, toastEl } = useToast();

  const [mode, setMode] = useState('OCR');
  const [operator, setOperator] = useState('MTN');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [phone, setPhone] = useState('');
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty] = useState(1);

  const [receipts, setReceipts] = useState([]);
  const [printer, setPrinter] = useState(null);
  const [lastCreated, setLastCreated] = useState(null);
  const [reportModal, setReportModal] = useState(null);
  const [reason, setReason] = useState('');
  const [suggAmount, setSuggAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);

  const loadReceipts = useCallback(async () => {
    const { data, error } = await supabase.from('receipts').select('*').eq('user_id', profile.id)
      .order('created_at', { ascending: false }).limit(25);
    if (error) notify(error.message, 'error'); else setReceipts(data || []);
  }, [profile.id, notify]);

  const loadProducts = useCallback(async () => {
    const { data, error } = await supabase.from('products').select('*').eq('store_id', profile.store_id)
      .gt('stock_quantity', 0).order('name');
    if (error) notify(error.message, 'error'); else setProducts(data || []);
  }, [profile.store_id, notify]);

  useEffect(() => { loadReceipts(); loadProducts(); }, [loadReceipts, loadProducts]);

  async function handleOCR(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setOcrBusy(true);
    try {
      const res = await parseMobileMoneyReceipt(file);
      setOperator(res.operator);
      if (res.amount) setAmount(res.amount);
      if (res.transactionRef) setRef(res.transactionRef);
      if (res.customerPhone) setPhone(res.customerPhone);
      notify('Lecture terminée : vérifiez les champs avant de valider.', 'info');
    } catch {
      notify('Erreur OCR. Remplissez manuellement.', 'error');
    } finally {
      setOcrBusy(false);
      input.value = ''; // permet de re-scanner la même image
    }
  }

  // Pré-remplissage automatique du montant si un article du stock est sélectionné
  function handleProductSelect(prodId) {
    setSelectedProduct(prodId);
    setQty(1);
    const prod = products.find((p) => p.id === prodId);
    if (prod) setAmount(String(prod.price));
  }

  function handleQty(value) {
    const prod = products.find((p) => p.id === selectedProduct);
    const max = prod ? prod.stock_quantity : 9999;
    const q = Math.min(Math.max(1, Math.floor(Number(value)) || 1), max);
    setQty(q);
    if (prod) setAmount(String(prod.price * q));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const amt = Number(amount);
    if (!(amt > 0)) return notify('Montant invalide.', 'error');
    if (!ref.trim()) return notify('Référence obligatoire.', 'error');

    setSubmitting(true);
    // RPC atomique : insère le reçu ET décrémente le stock (vérifie qty <= stock, refuse les doublons de référence)
    const { data, error } = await supabase.rpc('create_receipt', {
      p_store_id: profile.store_id,
      p_operator: operator,
      p_amount: amt,
      p_ref: ref,
      p_phone: phone.trim() || null,
      p_product_id: selectedProduct || null,
      p_qty: selectedProduct ? qty : null,
      p_input_method: mode,
    });
    setSubmitting(false);

    if (error) return notify(error.message, 'error');

    setLastCreated(data);
    setAmount(''); setRef(''); setPhone(''); setSelectedProduct(''); setQty(1);
    notify('Reçu enregistré.', 'success');
    loadReceipts();
    loadProducts();
  }

  async function sendReport(e) {
    e.preventDefault();
    const { error } = await supabase.from('incident_reports').insert([{
      store_id: profile.store_id,
      receipt_id: reportModal.id,
      reported_by: profile.id,
      reason: reason.trim(),
      suggested_amount: suggAmount ? parseFloat(suggAmount) : null,
    }]);
    if (error) return notify(error.message, 'error');
    setReportModal(null); setReason(''); setSuggAmount('');
    notify('Signalement envoyé au gérant en temps réel.', 'success');
    loadReceipts();
  }

  async function handleConnectPrinter() {
    try {
      const conn = await connectThermalPrinter(() => {
        setPrinter(null);
        notify('Imprimante Bluetooth déconnectée.', 'warn');
      });
      setPrinter(conn);
    } catch (err) {
      if (err?.name !== 'NotFoundError') notify(err.message || 'Connexion Bluetooth impossible.', 'error');
    }
  }

  async function handleBluetoothPrint() {
    try {
      await printViaBluetooth(printer, lastCreated, profile.stores);
    } catch (err) {
      notify(err.message || "Échec de l'impression.", 'error');
    }
  }

  function handleStandardPrint() {
    try { printStandardTicket(lastCreated, profile.stores); }
    catch (err) { notify(err.message, 'error'); }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <h1 className="text-xl font-bold">Caisse — {profile.full_name}</h1>
        <button onClick={handleConnectPrinter} className="bg-slate-900 text-white text-xs px-3 py-2 rounded">
          {printer ? '🟢 Imprimante Bluetooth Prête' : '🖨️ Connecter Bluetooth'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl border shadow-sm space-y-4">
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('OCR')} className={`px-4 py-2 rounded text-xs font-semibold ${mode === 'OCR' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Scan OCR</button>
          <button type="button" onClick={() => setMode('MANUAL')} className={`px-4 py-2 rounded text-xs font-semibold ${mode === 'MANUAL' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Saisie Manuelle</button>
        </div>

        {mode === 'OCR' && (
          <div>
            <input type="file" accept="image/*" onChange={handleOCR} disabled={ocrBusy} className="w-full border border-dashed border-blue-300 p-4 rounded bg-blue-50/50 text-sm" />
            {ocrBusy && <p className="text-xs text-blue-700 mt-2">Analyse de l'image en cours…</p>}
          </div>
        )}

        {products.length > 0 && (
          <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3 rounded-lg border">
            <select value={selectedProduct} onChange={(e) => handleProductSelect(e.target.value)} className="col-span-2 border p-2 rounded text-sm bg-white">
              <option value="">-- Article vendu (Optionnel / Stock) --</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({Number(p.price).toLocaleString('fr-FR')}F - Stock: {p.stock_quantity})</option>
              ))}
            </select>
            <input type="number" min="1" value={qty} disabled={!selectedProduct} onChange={(e) => handleQty(e.target.value)} className="border p-2 rounded text-sm disabled:bg-gray-100" placeholder="Qté" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <select value={operator} onChange={(e) => setOperator(e.target.value)} className="border p-2.5 rounded text-sm">
            <option value="MTN">MTN MoMo</option>
            <option value="ORANGE">Orange Money</option>
          </select>
          <input type="number" required min="1" placeholder="Montant (FCFA)" value={amount} onChange={(e) => setAmount(e.target.value)} className="border p-2.5 rounded text-sm" />
          <input type="text" required placeholder="Référence Transaction" value={ref} onChange={(e) => setRef(e.target.value)} className="border p-2.5 rounded text-sm uppercase" />
          <input type="tel" placeholder="Téléphone Client" value={phone} onChange={(e) => setPhone(e.target.value)} className="border p-2.5 rounded text-sm" />
        </div>

        <button type="submit" disabled={submitting} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold py-3 rounded text-sm">
          {submitting ? 'Enregistrement…' : 'Valider et Générer le Reçu'}
        </button>
      </form>

      {lastCreated && (
        <div className="bg-emerald-50 border p-4 rounded-xl flex justify-between items-center">
          <div>
            <p className="font-bold text-sm">{Number(lastCreated.amount).toLocaleString('fr-FR')} FCFA ({lastCreated.transaction_ref})</p>
            {lastCreated.items_summary && <p className="text-xs text-gray-600">{lastCreated.items_summary}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={handleBluetoothPrint} className="bg-emerald-600 text-white px-3 py-2 rounded text-xs font-bold">Bluetooth</button>
            <button onClick={handleStandardPrint} className="bg-slate-900 text-white px-3 py-2 rounded text-xs font-bold">Imprimer / PDF</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border divide-y text-sm">
        <div className="p-3 bg-gray-50 font-bold text-xs text-slate-700">Mes reçus (Lecture seule)</div>
        {receipts.map((r) => (
          <div key={r.id} className="p-4 flex justify-between items-center gap-3">
            <span className={r.status === 'CANCELLED' ? 'line-through text-gray-400' : ''}>
              <strong>{r.operator}</strong> — {Number(r.amount).toLocaleString('fr-FR')} FCFA ({r.transaction_ref}) {r.items_summary && `[${r.items_summary}]`}
              {r.status === 'FLAGGED' && <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Signalé</span>}
              {r.status === 'CANCELLED' && <span className="ml-2 text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Annulé</span>}
            </span>
            {r.status === 'VALID' && (
              <button onClick={() => setReportModal(r)} className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1 rounded shrink-0">⚠️ Signaler</button>
            )}
          </div>
        ))}
      </div>

      {reportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <form onSubmit={sendReport} className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-lg">Signaler une erreur au Gérant</h3>
            <textarea required rows="3" placeholder="Expliquez l'erreur..." value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border p-2 text-sm rounded" />
            <input type="number" min="1" placeholder="Montant correct suggéré (FCFA)" value={suggAmount} onChange={(e) => setSuggAmount(e.target.value)} className="w-full border p-2 text-sm rounded" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReportModal(null)} className="px-3 py-1 text-sm">Annuler</button>
              <button type="submit" className="bg-red-600 text-white px-4 py-1.5 rounded text-sm">Envoyer</button>
            </div>
          </form>
        </div>
      )}
      {toastEl}
    </div>
  );
}
