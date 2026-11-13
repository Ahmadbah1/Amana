# Amana – dépôt prêt pour Cloudflare Pages

```
wrangler.toml        liaisons Cloudflare (base D1 « amana » + espace KV « amana-LIC »), déjà remplies
public/              le site : index, app, espace, tableau, admin, manifest, sw, icônes
functions/api/       l'API (paiement Pro) et functions/api/v1/ (comptes, reçus, Google, admin)
lib/                 code partagé (prix des offres : lib/license.js)
migrations/          schéma de la base (DÉJÀ appliqué sur ta base D1)
```

## Déjà fait sur ton compte Cloudflare
- Base **D1 `amana`** : 15 tables, 4 index, 8 garde-fous (reçus et journaux non modifiables). Migrations 0001, 0002 et 0003 appliquées.
- Espace **KV `amana-LIC`** pour les licences Pro.

## Où mettre chaque chose
| Quoi | Où |
|---|---|
| Ce dossier (contenu, pas le dossier parent) | Dépôt GitHub privé `amana` |
| Le dépôt | Cloudflare → Workers & Pages → Créer → Pages → Se connecter à Git. Commande de build : aucune. Dossier de sortie : `public` |
| `SIGN_SECRET`, `TOKEN_KEY`, `ADMIN_KEY` (3 longues phrases aléatoires **différentes**, 40 caractères ou plus) | Projet Pages → Paramètres → Variables et secrets → type **Secret** |
| `NOTCH_KEY` (clé du compte marchand Notch Pay) | Idem |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Idem, après la configuration Google Cloud ci-dessous |
| Forfait Workers payant (5 $/mois) | Cloudflare → Workers & Pages → Plans (nécessaire pour le chiffrement des mots de passe) |
| Projet OAuth Google | console.cloud.google.com : API Drive + Sheets, écran de consentement (`drive.file`, `openid`, `email`), identifiant « Application Web », URI de redirection `https://TON-DOMAINE/api/v1/google/callback`, puis « En production » |
| Prix des offres | `lib/license.js` |
| Limites gratuites | `public/app.html` : `PAYWALL=true` quand tout est prêt |
| Nom de domaine (facultatif) | Projet Pages → Domaines personnalisés |

## Premier lancement
1. Ouvre `/espace.html`, crée ton compte (ton entreprise « Amana »).
2. Ouvre `/admin.html`, saisis `ADMIN_KEY` : tu es super administrateur.
3. Crée une entreprise de test, un employé, un reçu ; vérifie le tableau de bord.
4. Connecte Google, vérifie le classeur et le dossier créés dans ton Drive.

## Avant un lancement public
Vérification des numéros de téléphone à l'inscription, nom de l'éditeur et contact dans les CGU, politique de remboursement, information des employés sur le suivi de leur activité, relecture juridique, vérification du nom « Amana ».
