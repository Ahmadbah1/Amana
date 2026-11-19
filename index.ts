// Fonction Supabase "staff" : réservée au gérant. Crée / désactive / réactive un employé, change son mot de passe.
// Déploiement : supabase functions deploy staff   (la clé service_role reste côté serveur, jamais dans la page)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info','Content-Type':'application/json'};
const out = (o, s = 200) => new Response(JSON.stringify(o), {status: s, headers: cors});
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const {data: {user}} = await admin.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
  if (!user) return out({error: 'auth'}, 401);
  const {data: me} = await admin.from('members').select('org_id').eq('user_id', user.id).eq('role', 'owner').eq('active', true).maybeSingle();
  if (!me) return out({error: 'forbidden'}, 403);
  const b = await req.json().catch(() => ({}));
  if (b.action === 'create') {
    const username = String(b.username || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (username.length < 3 || String(b.password || '').length < 8) return out({error: 'invalid'}, 400);
    const login = username + '.' + me.org_id.slice(0, 8);               // identifiant remis à l'employé
    const {data, error} = await admin.auth.admin.createUser({email: login + '@staff.amana.app', password: b.password, email_confirm: true, user_metadata: {username}});
    if (error) return out({error: error.message}, 400);
    const {data: m, error: e2} = await admin.from('members').insert({org_id: me.org_id, user_id: data.user.id, role: 'employee', display_name: b.display_name || username}).select('id').single();
    if (e2) { await admin.auth.admin.deleteUser(data.user.id); return out({error: e2.message}, 400); }
    return out({member_id: m.id, login});
  }
  const {data: t} = await admin.from('members').select('user_id,org_id,role').eq('id', b.member_id).maybeSingle();
  if (!t || t.org_id !== me.org_id || t.role !== 'employee') return out({error: 'forbidden'}, 403);   // jamais hors de votre entreprise
  if (b.action === 'disable' || b.action === 'enable') {
    await admin.from('members').update({active: b.action === 'enable'}).eq('id', b.member_id);
    await admin.auth.admin.updateUserById(t.user_id, {ban_duration: b.action === 'disable' ? '876000h' : 'none'});
    return out({ok: true});
  }
  if (b.action === 'password' && String(b.password || '').length >= 8) {
    await admin.auth.admin.updateUserById(t.user_id, {password: b.password});
    return out({ok: true});
  }
  return out({error: 'unknown_action'}, 400);
});
