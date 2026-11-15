# Amana

Caisse Mobile Money (MTN / Orange) multi-boutiques : OCR des reçus, stocks, signalements temps réel, impression Bluetooth, exports Excel/PDF.

Stack : React + Vite + Tailwind, Supabase (Auth, Postgres + RLS, Realtime, Edge Functions).

## Développement local
```
cp .env.example .env
npm install
npm run dev
```

## Base de données
Le schéma complet est dans `supabase/schema.sql` (déjà appliqué sur le projet Supabase actuel).
L'Edge Function est dans `supabase/functions/create-collaborator/` (déjà déployée).

## Déploiement GitHub Pages
1. Repo > Settings > Pages > Source : **GitHub Actions**
2. Repo > Settings > Secrets and variables > Actions > onglet **Variables** : créer `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`
3. Push sur `main` : le workflow construit et publie le site
4. Supabase > Authentication > URL Configuration : mettre `https://<utilisateur>.github.io/<repo>/` en Site URL et Redirect URL

Le Bluetooth Web nécessite HTTPS et Chrome (Android ou ordinateur).
