// Fonction Supabase "staff" : réservée au gérant. Crée / désactive / réactive un employé, change son mot de passe.
// Déploiement : supabase functions deploy staff   (la clé service_role reste côté serveur, jamais dans la page)
// Les actions qui modifient un compte écrivent aussi dans audit_log (journal d'activité du gérant).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';   // version épinglée — ne pas laisser flotter la version majeure

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info','Content-Type':'application/json'};
// En production, restreindre Access-Control-Allow-Origin au domaine réel de l'app (ex. https://amana-site-five.vercel.app).
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), {status: s, headers: cors});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors});
  try {
    const SUPA_URL = Deno.env.get('SUPABASE_URL');
    const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPA_URL || !SUPA_KEY) { console.error('Variable SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante'); return out({error: 'server_misconfigured'}, 500); }
    const admin = createClient(SUPA_URL, SUPA_KEY);

    const {data: {user}, error: authErr} = await admin.auth.getUser((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (authErr || !user) return out({error: 'auth'}, 401);

    const {data: me, error: meErr} = await admin.from('members').select('org_id').eq('user_id', user.id).eq('role', 'owner').eq('active', true).maybeSingle();
    if (meErr) { console.error(meErr); return out({error: 'server'}, 500); }
    if (!me) return out({error: 'forbidden'}, 403);

    // Écriture d'audit ; un échec d'audit n'annule pas l'action mais est tracé dans les logs serveur.
    const audit = async (action: string, entity_id: string | null, details: Record<string, unknown>) => {
      try {
        const {error} = await admin.from('audit_log').insert({org_id: me.org_id, user_id: user.id, action, entity_id, details});
        if (error) console.error('audit_log insert failed', action, error);
      } catch (e) { console.error('audit_log insert threw', action, e); }   // ne jamais faire échouer l'action principale pour un échec d'audit
    };

    const b = await req.json().catch(() => ({}));

    if (b.action === 'create') {
      const username = String(b.username || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const displayName = String(b.display_name || username).trim().slice(0, 120) || username;
      if (username.length < 3 || String(b.password || '').length < 8) return out({error: 'invalid'}, 400);
      const login = username + '.' + me.org_id.slice(0, 8);               // identifiant remis à l'employé
      const {data, error} = await admin.auth.admin.createUser({email: login + '@staff.amana.app', password: String(b.password), email_confirm: true, user_metadata: {username}});
      if (error) return out({error: error.message}, 400);
      const {data: m, error: e2} = await admin.from('members').insert({org_id: me.org_id, user_id: data.user.id, role: 'employee', display_name: displayName}).select('id').single();
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); return out({error: e2.message}, 400); }
      await audit('staff.create', m.id, {username});
      return out({member_id: m.id, login});
    }

    // À partir d'ici, il faut un member_id valide (uuid) d'un EMPLOYÉ de l'org du gérant appelant
    if (typeof b.member_id !== 'string' || !UUID_RE.test(b.member_id)) return out({error: 'invalid'}, 400);
    const {data: t, error: tErr} = await admin.from('members').select('user_id,org_id,role').eq('id', b.member_id).maybeSingle();
    if (tErr) { console.error(tErr); return out({error: 'server'}, 500); }
    if (!t || t.org_id !== me.org_id || t.role !== 'employee') return out({error: 'forbidden'}, 403);   // jamais hors de votre entreprise

    if (b.action === 'disable' || b.action === 'enable') {
      const enable = b.action === 'enable';
      const {error: e1} = await admin.from('members').update({active: enable}).eq('id', b.member_id);
      if (e1) { console.error(e1); return out({error: e1.message}, 400); }
      const {error: e2} = await admin.auth.admin.updateUserById(t.user_id, {ban_duration: enable ? 'none' : '876000h'});
      if (e2) {   // on revient en arrière pour ne pas laisser un compte « désactivé » mais ban ni actif ni banni de façon cohérente
        await admin.from('members').update({active: !enable}).eq('id', b.member_id);
        console.error(e2); return out({error: e2.message}, 400);
      }
      await audit(enable ? 'staff.enable' : 'staff.disable', b.member_id, {});
      return out({ok: true});
    }

    if (b.action === 'password') {
      if (String(b.password || '').length < 8) return out({error: 'invalid'}, 400);
      const {error: e1} = await admin.auth.admin.updateUserById(t.user_id, {password: String(b.password)});
      if (e1) { console.error(e1); return out({error: e1.message}, 400); }
      await audit('staff.password', b.member_id, {});
      return out({ok: true});
    }

    return out({error: 'unknown_action'}, 400);
  } catch (e) {
    console.error('staff function crashed', e);
    return out({error: 'server'}, 500);
  }
});
