# Vérifications de préparation — v3

## Build / dépendances
- Build Vercel statique : réussi.
- Analyse de syntaxe JavaScript : réussie.
- npm audit --omit=dev : aucune vulnérabilité signalée lors du contrôle. Ce n'est pas une garantie de sécurité.

## PostgreSQL embarqué (PGlite)
Les schémas Auth et Storage sont des simulacres locaux ; les migrations applicatives et la RLS s'exécutent réellement sur le moteur PostgreSQL embarqué.
- Les cinq migrations s'appliquent sur une base neuve.
- Le total transmis par un client est ignoré et recalculé.
- Même clé/même contenu : même reçu retourné.
- Valeurs nulles, quantités négatives et statut invalide refusés.
- Employé : aucune lecture directe des archives, aucune modification/suppression d'un reçu, aucune auto-promotion gérant.
- TxID réutilisé refusé.
- Isolation entre deux entreprises vérifiée.
- Annulation/remplacement liés et uniques ; un remplacement invalide ne laisse pas l'original annulé.
- Vérification publique : statut et numéro de remplacement disponibles, pas de client/article/TxID.
- Audit lisible par gérant mais pas supprimable par le rôle applicatif.
- Invitation réservée puis profil employé créé dans l'entreprise attendue.
- Révocation : sessions/refresh tokens locaux supprimés et nouvelles écritures refusées.

## Navigateur Chromium mobile 390 × 844
Les services Auth, réponses d'émission et health sont simulés ; aucun message réel n'est envoyé.
- Formulaire utilisable avec CDN bloqués.
- Français, anglais et Pidgin.
- Inscription téléphone → écran OTP.
- Écrans gérant, Sécurité et Audit sans débordement horizontal.
- Réponse réseau incertaine → nouvelle tentative avec clé et contenu strictement identiques.
- PDF A4 et ticket 80 mm générés par la bibliothèque, avec police embarquée.
- Mode hors ligne : interface masquée et rendue inerte ; reprise après vérification serveur.
- Navigation employé vers Équipe refusée.
- Page de vérification publique accessible sans compte, sans détails du client.
- Aucune erreur JavaScript de page observée.

## Non validé sur infrastructure réelle
- Paramètres et permissions exacts de votre Supabase distant après installation.
- Livraison SMTP/SMS et liens Auth d'invitation ou de récupération.
- CAPTCHA réel et quotas du fournisseur.
- Cérémonie passkey avec appareil biométrique.
- Partage natif WhatsApp et impression thermique physique.

Suivre RECETTE.md pour ces contrôles. Le dossier ne déploie ni ne modifie automatiquement votre production.
