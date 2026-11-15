import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { LandingPage } from './components/LandingPage';
import { EmployeeWorkspace } from './components/EmployeeWorkspace';
import { ManagerDashboard } from './components/ManagerDashboard';
import { useToast } from './components/Toast';

export default function App() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const { notify, toastEl } = useToast();

  const loadProfile = useCallback(async (user) => {
    if (!user) { setProfile(null); setLoading(false); return; }
    const { data, error } = await supabase
      .from('profiles')
      .select('*, stores(name, logo_url, receipt_footer)')
      .eq('id', user.id)
      .maybeSingle();
    if (error) notify(error.message, 'error');
    if (data && !data.is_active) {
      await supabase.auth.signOut();
      setProfile(null);
      notify('Votre accès a été désactivé par le gérant.', 'error');
    } else {
      setProfile(data || null);
    }
    setLoading(false);
  }, [notify]);

  // Gère connexion, déconnexion, expiration de session (INITIAL_SESSION est émis au montage)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') return;
      // Ne pas appeler Supabase directement dans le callback (risque de blocage) : on diffère
      setTimeout(() => loadProfile(session?.user ?? null), 0);
    });
    return () => subscription.unsubscribe();
  }, [loadProfile]);

  if (loading) return <div className="p-10 text-center">Chargement d'Amana...</div>;
  if (!profile) return <><LandingPage />{toastEl}</>;

  const isManagerOrCollab = profile.role === 'manager' || profile.role === 'collaborator';

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="bg-[#071936] text-white px-6 py-3 flex justify-between items-center text-xs">
        <div>
          <strong>{profile.stores?.name}</strong> ({isManagerOrCollab ? 'Gérant / Collaborateur' : 'Employé'})
        </div>
        <button onClick={() => supabase.auth.signOut()} className="bg-red-500/20 text-red-200 border px-3 py-1 rounded">
          Déconnexion
        </button>
      </div>
      {isManagerOrCollab ? <ManagerDashboard profile={profile} /> : <EmployeeWorkspace profile={profile} />}
      {toastEl}
    </div>
  );
}
