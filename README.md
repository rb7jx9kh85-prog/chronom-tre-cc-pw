# Prestige Wash — Chronomètre partagé

Chronomètre cold call / travail, consultation client, forfaits et facturation. Interface française responsive. Une page HTML, une fonction Vercel Node.js et Upstash Redis ; aucun framework ni dépendance npm.

## Mise en ligne — sans Terminal

1. Sur https://vercel.com/new, importe `rb7jx9kh85-prog/chronom-tre-cc-pw`.
2. Framework : **Other**. Racine : `/`. Output Directory : **public** (déjà dans vercel.json). Aucun Build Command nécessaire. Lance le déploiement ; l'application affichera un message de configuration tant que les variables manquent.
3. Dans ton projet Vercel, ouvre **Storage** (ou **Infrastructure → Storage**) → **Create Database**, puis sélectionne **Upstash Redis**. Choisis une région européenne et le plan adapté affiché à l'écran. Connecte la base au projet, environnement **Production**. Ne connecte pas les previews à la base de production.
4. Vérifie dans **Settings → Environment Variables** la présence de `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`. Si l'intégration a créé `KV_REST_API_URL` et `KV_REST_API_TOKEN`, c'est également pris en charge. Si elle fournit seulement `REDIS_URL`, récupère **REST URL** et **REST TOKEN** dans la console Upstash (https://console.upstash.com) et ajoute les deux variables `UPSTASH_...` toi-même. Ne mets jamais le jeton dans GitHub ou le HTML.
5. Ajoute en environnement **Production** :

| Variable | Valeur |
|---|---|
| `ADMIN_ID` | Ton identifiant, par exemple `noe` |
| `ADMIN_PASSWORD` | Ton mot de passe personnel, au moins 12 caractères |
| `CLIENT_ID` | Par exemple `prestigewash` |
| `CLIENT_PASSWORD` | Un autre mot de passe, au moins 12 caractères |

Les identifiants doivent être différents, ainsi que les mots de passe. Évite tout espace involontaire lors du copier-coller. Les secrets restent uniquement côté serveur.

6. **Deployments → dernier déploiement → ⋯ → Redeploy**. Les nouvelles variables sont appliquées au redéploiement.
7. Ouvre le site, connecte-toi avec l'accès admin. Choisis le forfait et entre le montant réellement déjà payé. Ne compte pas une somme non reçue.
8. Envoie à Prestige Wash la même URL et uniquement son identifiant / mot de passe client. Il voit les temps et le forfait, jamais les prix, paiements ou contrôles d'administration.
9. Teste l'accès client dans une fenêtre privée : démarre une session admin, attends au maximum 15 secondes sur l'écran client, vérifie le compteur, puis termine la session.

## Fonctionnement

- Un seul chronomètre partagé. Les changements sont enregistrés à chaque démarrage, pause, reprise ou arrêt. Le temps écoulé se calcule à partir de l'heure du serveur : aucun enregistrement toutes les secondes.
- Le compteur continue après fermeture de l'onglet ou du navigateur. Il faut le mettre en pause pendant les interruptions.
- Le client actualise l'état toutes les 15 secondes tant que la page est visible ; le chiffre avance localement entre deux actualisations.
- Temps total et progression incluent la session en cours. Facturation horaire sur les sessions **enregistrées** uniquement.
- Forfait 10 h : 225 CHF ; forfait 5 h : 125 CHF ; à l'heure : 30 CHF/h. Montant horaire calculé à la seconde puis arrondi au centime sur le total. Les pauses sont exclues.
- Un forfait est facturé à son prix complet, même s'il n'est pas encore consommé. Le paiement déjà reçu est déduit. Le dépassement est affiché et n'est pas facturé automatiquement.
- Le réglage du forfait s'applique à toutes les sessions de la mission. Il n'y a pas de renouvellement de forfait ni d'historique de contrats distincts dans cette version.
- Une saisie manuelle permet de corriger un oubli ; suppression puis nouvelle saisie pour modifier une durée.
- Les écritures utilisent une version et une comparaison atomique Redis. Deux appareils ne peuvent pas écraser silencieusement les données : un conflit demande de réessayer après actualisation.
- En cas de perte réseau, aucun succès n'est annoncé sans confirmation serveur. Une requête peut avoir été enregistrée avant une perte de réponse : consulte l'état synchronisé avant de réessayer.
- Données persistantes Redis, sans expiration pour la mission. Cookies de session signés HttpOnly et SameSite, durée 7 jours. Changer un des mots de passe invalide les sessions existantes.
- Les tentatives de connexion sont limitées à 20 par adresse IP sur 15 minutes, réussies ou non. Aucun mot de passe dans le navigateur ni dans Redis.
- Sauvegarde JSON et export CSV depuis l'administration. La sauvegarde JSON inclut les montants et n'est pas une copie client. Une éventuelle restauration s'effectue dans Redis avec assistance, aucun import libre exposé dans l'application.

## Contrôle des coûts

Le suivi fait une lecture Redis toutes les 15 secondes par onglet visible connecté, plus les lectures/écritures lors des actions. Ferme les onglets inutilisés. Consulte les quotas et le tarif actuel dans Upstash/Vercel ; le code ne garantit pas un hébergement gratuit. Évite une politique d'éviction des clés sur la base de production ; conserve des exports réguliers.

## Développement et tests

Node.js 22 ou plus récent. `npm test` exécute les tests métier et API avec Redis simulé ; `npm run check` vérifie la syntaxe. Pour le développement interactif : `npx vercel dev` avec les variables configurées côté serveur. Utilise une autre base ou un autre `DATA_KEY` pour les tests et les previews. Aucun secret réel dans `.env.example`.

Le code est prêt pour Vercel, pas pour GitHub Pages (qui n'exécute pas la fonction serveur). Les tests locaux ne remplacent pas le test final avec ta base Redis et ton déploiement.
