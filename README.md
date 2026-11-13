# Amana Business — première version

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
Les reçus sont centralisés dans PostgreSQL. Les exports Excel sont dans Storage privé. Le logo est dans un bucket public, car il est destiné à figurer sur les reçus ; seul le gérant peut le téléverser ou le configurer. Les photos SMS ne sont pas archivées : l’OCR s’exécute dans le navigateur, ses bibliothèques et modèles étant téléchargés depuis des services tiers.
