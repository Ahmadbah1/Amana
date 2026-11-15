// Déploiement : supabase functions deploy create-collaborator
// Les variables SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournies automatiquement.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Non authentifié' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Session invalide' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Corps invalide' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const fullName = String(body.full_name ?? '').trim().slice(0, 120);
  const storeId = String(body.store_id ?? '');
  const role = String(body.role ?? 'employee');

  if (!email || !fullName || !storeId) return json({ error: 'Champs obligatoires manquants' }, 400);
  if (password.length < 8) return json({ error: 'Mot de passe : 8 caractères minimum' }, 400);
  if (!['collaborator', 'employee'].includes(role)) return json({ error: 'Rôle invalide' }, 400);

  // Vérifie que l'appelant gère bien cette boutique (RLS-safe : exécuté avec son JWT)
  const { data: allowed, error: rpcErr } = await userClient.rpc('is_store_manager', { sid: storeId });
  if (rpcErr || !allowed) return json({ error: 'Accès refusé à cette boutique' }, 403);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (createErr || !created.user) return json({ error: createErr?.message ?? 'Création impossible' }, 400);

  const { error: profErr } = await admin.from('profiles').insert({
    id: created.user.id, store_id: storeId, full_name: fullName, role, is_active: true,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id); // pas d'utilisateur orphelin
    return json({ error: profErr.message }, 400);
  }
  return json({ ok: true, user_id: created.user.id });
});
