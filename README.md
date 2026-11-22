# Amana

Application SaaS de caisse / reçus de paiement pour commerçants
(MTN MoMo, Orange Money). PWA mono-page, interface française.

## Chaîne de liens (architecture)

```
index.html  ──►  Vercel amana-site (production)
    │
    │  SUPABASE_URL + SUPABASE_ANON
    ▼
Supabase projet « amana-prod »  rggqvjrzjswxrtgsnzfo (eu-central-1, free)
    ├── schema.sql                     (migrations initial_schema + harden_schema)
    │     └── tables, RLS, fonctions (create_organization, create_receipt,
    │         cancel_receipt, set_permissions, audit_log), publication temps réel
    ├── supabase/functions/staff/index.ts   (déployée comme fonction « staff »)
    │     └── comptes employés (création, réactivation, mot de passe) — réservée au gérant
    └── net/realtime : publication sur `receipts`

app.html  →  redirection vers index.html (compatibilité des anciens liens)
icon-192.png  →  logo / favicon / splash
```

## Clés et configuration (publique par design)

La clé **publishable** (anon) est écrite en dur dans `index.html` — c'est
volontaire : elle est publique par design, protégée par les règles RLS
de Postgres. Le moindre accès aux données exige une session authentifiée.

**Ne jamais** mettre la clé `service_role` dans ce dossier (serveur uniquement,
jamais exposé au navigateur). Elle ne figure nulle part ici.

## Déploiement

### 1) Supabase — une seule fois par projet

```bash
# Variables d'environnement (jamais commitées) :
#   SUPABASE_URL  et  SUPABASE_ANON  déjà dans index.html
#   (la clé publishable est publique par design — voir ci-dessus)

# Schéma
supabase link --project-ref rggqvjrzjswxrtgsnzfo
supabase db push            # ou : SQL Editor > colle schema.sql + migration durcissement

# Fonction staff
supabase functions deploy staff

# Temps réel (une seule fois)
# alter publication supabase_realtime add table public.receipts;
```

### 2) Vercel — déploiement de l'app

Le projet **amana-site** (team `team_pwx913088X55ZJ0jGuEOmg2V`) est lié au repo.

```bash
vercel link                # lien local (une fois)
vercel --prod              # ou : créer un déploiement git via le connector Vercel
```

Le projet sert la racine (`outputDirectory: "."`, framework null).
Ne pas committer `.vercel/` (déjà dans `.gitignore`).

### 3) GitHub

```bash
git push origin arena/bf81ea2b-amana   # branche → déclenche le déploiement si auto-deploy ON
git push origin main                    # seulement après relecture/pull request
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Application complète (frontend). Config Supabase en dur, protégée par RLS. |
| `app.html` | Redirection → `index.html`. |
| `icon-192.png` | Logo / favicon / splash. |
| `schema.sql` | Schéma Postgres (tables, RLS, fonctions RPC, publication realtime). |
| `supabase/config.toml` | `project_id` = `rggqvjrzjswxrtgsnzfo` + `[functions.staff] verify_jwt`. |
| `supabase/functions/staff/index.ts` | Fonction edge gérants → employés. |
| `.gitignore` | Jamais de secrets dans le repo. |

## Points de vigilance

- La **clé `service_role`** reste dans Supabase (dashboard/Functions secrets), jamais ici, jamais dans la page.
- Le **temps réel** (`alter publication ... add table public.receipts;`) est à vérifier
  avant usage — sans lui, l'app recharge toutes les 30 s (filet de sécurité intégré).
- Le fichier `schema.sql` mentionne l'index de dédoublonnage transaction dans ses
  étapes finales (`receipts_tx_unique`) — appliquer si le dédoublonnage est souhaité.
- La fonction `staff` en production n'autorise que le **gérant** (`role='owner'`).
- Le CORS de `staff` est `*` par défaut — restreindre au domaine réel en production.
