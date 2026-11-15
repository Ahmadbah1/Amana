import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

// La session est détectée par App.jsx via onAuthStateChange : plus besoin de callback.
export function LandingPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState('LOGIN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function open(nextMode) {
    setMode(nextMode); setError(''); setInfo(''); setIsOpen(true);
  }

  async function handleAuth(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setInfo('');

    try {
      if (mode === 'LOGIN') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        setIsOpen(false);
      } else {
        if (password.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
        // La boutique et le profil gérant sont créés par un trigger SQL à partir de ces métadonnées
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim(), store_name: storeName.trim() } },
        });
        if (err) throw err;
        if (data.session) {
          setIsOpen(false); // connecté directement
        } else {
          setMode('LOGIN');
          setInfo('Compte créé. Confirmez votre adresse email via le lien reçu, puis connectez-vous.');
        }
      }
    } catch (err) {
      setError(err.message || 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="sticky top-0 z-40 bg-[#071936] text-white px-6 h-16 flex justify-between items-center">
        <span className="font-bold text-xl tracking-tight">amana</span>
        <div className="flex gap-3">
          <button onClick={() => open('LOGIN')} className="text-xs font-bold uppercase px-4 py-2 hover:bg-white/10 rounded">Connexion</button>
          <button onClick={() => open('REGISTER')} className="text-xs font-bold uppercase px-4 py-2.5 bg-[#1E88E5] rounded">Espace Gérant</button>
        </div>
      </header>

      <section className="bg-gradient-to-b from-[#06152D] to-[#0E3F91] text-white py-20 px-6 text-center space-y-6">
        <h1 className="text-4xl md:text-6xl font-serif font-bold">
          Encaissez vos Mobile Money. <br /><span className="text-cyan-300">Pilotez 100%</span> de vos boutiques.
        </h1>
        <p className="max-w-xl mx-auto text-blue-100 text-sm">
          Reçus instantanés par OCR, gestion des stocks en temps réel, multi-boutiques et exports comptables.
        </p>
        <button onClick={() => open('LOGIN')} className="px-8 py-3.5 bg-[#2196F3] rounded-lg font-semibold text-sm shadow-xl">
          Accéder à mon espace
        </button>
      </section>

      {isOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 relative">
            <button onClick={() => setIsOpen(false)} className="absolute top-4 right-4 font-bold" aria-label="Fermer">✕</button>
            <h3 className="text-2xl font-serif font-bold mb-4">{mode === 'LOGIN' ? 'Connexion' : 'Créer un compte Gérant'}</h3>
            {error && <div className="mb-4 p-3 bg-red-50 text-xs text-red-700 rounded">{error}</div>}
            {info && <div className="mb-4 p-3 bg-emerald-50 text-xs text-emerald-700 rounded">{info}</div>}
            <form onSubmit={handleAuth} className="space-y-4">
              {mode === 'REGISTER' && (
                <>
                  <input type="text" placeholder="Nom complet" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full border p-2.5 rounded text-sm" />
                  <input type="text" placeholder="Nom de la première boutique" required value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full border p-2.5 rounded text-sm" />
                </>
              )}
              <input type="email" placeholder="Email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border p-2.5 rounded text-sm" />
              <input type="password" placeholder="Mot de passe (8 caractères min.)" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border p-2.5 rounded text-sm" />
              <button type="submit" disabled={loading} className="w-full py-3 bg-[#1E88E5] text-white font-semibold rounded text-sm disabled:opacity-60">
                {loading ? 'Chargement...' : 'Valider'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
