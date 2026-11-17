# Politique de confidentialité

> Modèle à adapter. Remplacez tous les champs entre crochets et faites relire ce
> document par un professionnel du droit avant la mise en production. Ce texte
> n'est pas un avis juridique.

Dernière mise à jour : 17 novembre 2026

## 1. Responsable du traitement

Le responsable du traitement des données personnelles collectées via le service
**alf** est :

- Nom ou raison sociale : [À compléter]
- Adresse : [À compléter]
- Email de contact : [À compléter]

## 2. Données collectées

### Organisateurs

- Adresse email et identifiant de compte.
- Mot de passe : il est géré et stocké sous forme de hash par Supabase Auth ;
  l'éditeur n'y a pas accès en clair.
- Contenus créés : titres, codes d'activité, questions, options, réglages,
  identifiants de vidéos YouTube et résultats.

### Participants

- Pseudo ou nom saisi pour rejoindre une activité.
- Code de l'activité et identifiant d'appareil généré localement.
- Mots envoyés, réponses aux questions et horodatages.
- Adresse IP et user-agent, lorsque collectés par le backend pour la sécurité,
  la modération et la prévention des abus.
- Statut d'exclusion temporaire d'une activité, le cas échéant.

### Données techniques

- Journaux serveur : adresse IP, date et heure, méthode et URL appelées, code de
  réponse, user-agent.
- Journaux des prestataires d'hébergement (Netlify, Render, Cloudflare,
  Supabase), selon leurs propres politiques.

### Stockage local dans le navigateur

Le frontend utilise `localStorage` pour :

- mémoriser le thème clair/sombre ;
- conserver un identifiant d'appareil participant ;
- conserver la session participant et les réponses en cache pour une activité ;
- conserver la session d'authentification Supabase de l'organisateur.

Le détail des clés et des finalités figure dans
[Cookies et stockage local](COOKIES.md).

## 3. Finalités et bases légales

Les données sont traitées pour :

- fournir le Service, créer les activités, permettre aux participants de
  rejoindre et afficher les résultats (exécution du contrat ou mesures
  précontractuelles) ;
- authentifier les organisateurs et sécuriser les comptes (exécution du contrat
  et intérêt légitime à la sécurité) ;
- modérer les participants, prévenir les abus et assurer le support (intérêt
  légitime) ;
- respecter les obligations légales, notamment comptables ou de réponse aux
  autorités (obligation légale) ;
- déposer des traceurs non essentiels, le cas échéant (consentement).

## 4. Destinataires et sous-traitants

Les données peuvent être transmises aux prestataires suivants, pour les besoins
du Service :

- **Supabase** : authentification et base de données PostgreSQL.
- **Render** : hébergement de l'API.
- **Netlify** : hébergement du frontend.
- **Cloudflare** : Worker et Durable Objects pour le temps réel.
- **YouTube / Google** : lecture des vidéos dans les activités de quiz vidéo,
  lorsque cette fonction est utilisée.
- **jsDelivr** : chargement de la bibliothèque Supabase côté navigateur.
- Autorités administratives ou judiciaires, sur réquisition légale.

Ces prestataires peuvent agir comme sous-traitants ou responsables de traitement
distincts selon les cas. Leurs politiques de confidentialité s'appliquent à
leurs propres traitements.

## 5. Transferts hors de l'Union européenne

Certains prestataires peuvent être établis hors de l'Union européenne,
notamment aux États-Unis. Les transferts doivent être encadrés par les
mécanismes prévus par le RGPD (clauses contractuelles types, décision
d'adéquation ou autres garanties appropriées). Les informations exactes doivent
être vérifiées et complétées avant la mise en production.

## 6. Durées de conservation

- Compte organisateur : jusqu'à la suppression du compte ou demande d'effacement.
- Activités, questions, mots et réponses : jusqu'à leur suppression par
  l'organisateur ou suppression du compte, puis selon la durée nécessaire à la
  gestion d'éventuels litiges.
- Journaux techniques : durée limitée nécessaire à la sécurité et au diagnostic
  (à préciser selon la configuration des hébergeurs).
- Stockage local : jusqu'à effacement par l'utilisateur ou expiration de la
  session.

Les durées exactes doivent être adaptées à l'usage réel et documentées.

## 7. Sécurité

Le Service utilise HTTPS, l'authentification Supabase, des secrets côté serveur
et un cloisonnement applicatif des activités. L'accès aux données est limité aux
personnes et composants qui en ont besoin.

Aucun système n'est infaillible. En cas de violation de données susceptible
d'engendrer un risque élevé pour les droits et libertés, le responsable du
traitement notifie les autorités et les personnes concernées dans les conditions
prévues par le RGPD.

## 8. Droits des personnes

Conformément au RGPD, les personnes concernées disposent notamment des droits
d'accès, de rectification, d'effacement, de limitation, d'opposition et de
portabilité, ainsi que du droit de retirer leur consentement lorsque le
traitement repose sur celui-ci.

Pour exercer ces droits : [email de contact à compléter].

Une réclamation peut être adressée à la CNIL : <https://www.cnil.fr>.

## 9. Mineurs

Le Service peut être utilisé en contexte scolaire. Les établissements et
formateurs doivent s'assurer que l'usage avec des mineurs respecte les
autorisations et obligations applicables. Les données strictement nécessaires
doivent être privilégiées ; les participants peuvent utiliser un pseudo plutôt
qu'un nom réel.

## 10. Cookies et stockage local

Voir [Cookies et stockage local](COOKIES.md).

## 11. Modifications

Cette politique peut être mise à jour pour refléter l'évolution du Service, des
prestataires ou de la réglementation. La date de dernière mise à jour figure en
haut du document.
