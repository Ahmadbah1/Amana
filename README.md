# Amana Business — première version connectée

## Démarrer
Ouvrir l’aperçu en direct fourni dans la conversation. Choisir « Créer mon entreprise », saisir son e-mail réel, son nom, le nom de l’entreprise et un mot de passe de 12 caractères minimum. Confirmer l’e-mail Supabase, puis se connecter.

Le gérant crée les employés dans **Équipe** et leur communique leurs accès de façon privée. Aucun compte de démonstration n’a été créé. Les employés ne peuvent ni consulter les archives ni modifier un reçu émis. Après enregistrement, ils peuvent signaler une erreur sur ce reçu. Un signalement général est également disponible.

## Fonctionnalités
- Mise en page inspirée de Reddit : navigation latérale, fil central et informations à droite ; mobile responsive.
- Interface français, anglais et Pidgin.
- Comptes entreprise indépendants, Supabase Auth, profils gérant/employé.
- Saisie multi-articles, aperçu, OCR d’une capture et extraction indicative d’un SMS ; les données extraites doivent être vérifiées.
- Tableau de bord du gérant : montants confirmés, nombre de reçus, panier moyen, histogramme sur 7 jours, classement de l’équipe ; périodes globales 7/30 jours.
- Archives des reçus, recherche et impression/enregistrement PDF via le navigateur.
- Excel .xlsx avec filtres et formule de synthèse recalculable ; chaque export est enregistré dans un bucket privé puis téléchargeable dans Archives → Rapports Excel. Il s’agit d’un instantané exporté, pas d’un classeur connecté en temps réel.
- Signalements et résolution par le gérant.
- Gestion du logo et des coordonnées par le gérant.
- Révocation/réactivation : les politiques de base bloquent immédiatement les nouvelles requêtes ; l’interface vérifie le statut toutes les 20 secondes. Les données déjà affichées ne peuvent pas être effacées rétroactivement.

## Infrastructure déjà créée
Projet Supabase : `amana-recu`, référence `etomyyijwouxbagnnjun`, région Paris, offre gratuite.
Migrations appliquées : `amana_schema_v1`, `amana_receipt_security`.
Edge Function déployée : `amana-employees`. Elle vérifie elle-même le jeton utilisateur et le rôle gérant avant d’utiliser les droits serveur. Aucune clé secrète n’est présente dans le frontend.

Les reçus sont centralisés dans PostgreSQL. Les exports Excel sont dans Storage privé. Le logo est dans un bucket public, car il est destiné à figurer sur les reçus ; seul le gérant peut le téléverser ou le configurer. Les photos SMS ne sont pas archivées : l’OCR s’exécute dans le navigateur, ses bibliothèques et modèles étant téléchargés depuis des services tiers.

## Installation / hébergement
Site statique : `index.html`, `style.css`, `js/app.js`. Servir ces fichiers avec HTTPS. Pour une exécution locale : `python3 -m http.server 3000 --bind 0.0.0.0`.
Les dépendances JavaScript sont chargées par CDN : connexion Internet requise. L’aperçu statique de fichiers Arena ne peut pas charger ces dépendances ; utiliser le serveur d’aperçu en direct.

Pour un autre projet Supabase : appliquer `sql/001_schema.sql` puis `sql/002_security.sql`, déployer la fonction avec la vérification JWT de passerelle désactivée (elle vérifie le JWT dans son code), et remplacer URL/clé publique dans `js/app.js`. Les migrations s’appliquent une seule fois sur une base neuve.

## Avant une mise en production publique
- Remplacer l’URL temporaire d’aperçu par le vrai domaine dans Supabase Auth → URL Configuration (Site URL et Redirect URLs).
- Configurer un SMTP : les envois par défaut de Supabase ont des restrictions et des quotas, qui peuvent empêcher une inscription externe.
- Renouveler le mot de passe de base de données initial dans Supabase Settings → Database ; ne pas le publier.
- Ajouter récupération/changement de mot de passe, invitations avec définition privée du mot de passe, politique de confidentialité et sauvegardes.
- Ajouter journal d’audit, limitation de débit et CAPTCHA pour un service ouvert au public.
- Faire une recette réelle gérant/employé avec deux entreprises pour valider tout le parcours et l’isolation. L’interface a été testée avec des données simulées ; la création d’employé sans authentification renvoie bien 401 et la lecture anonyme des reçus ne renvoie aucune donnée. Aucun e-mail d’inscription réel n’a été envoyé pendant ces tests.

Les anciens fichiers fournis sont conservés sans modification dans `/home/user/uploads/`. Leurs historiques locaux ne sont pas migrés automatiquement vers la base.
