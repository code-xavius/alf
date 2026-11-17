# Cookies et stockage local

> Modèle à adapter. Remplacez les champs entre crochets et faites relire ce
> document avant la mise en production. Ce texte n'est pas un avis juridique.

Dernière mise à jour : 17 novembre 2026

## Résumé

alf n'utilise pas de cookies publicitaires ni d'outil de mesure d'audience. Le
fonctionnement du Service repose sur du **stockage local** (`localStorage`)
strictement nécessaire à l'authentification et à la session des participants.

Un bandeau de consentement n'est donc pas nécessaire pour ces usages
strictement nécessaires. En revanche, l'intégration YouTube peut déposer des
cookies ou traceurs : ce point est détaillé ci-dessous et doit être traité avant
une utilisation en production.

## Stockage local utilisé par alf

| Clé | Finalité | Durée | Catégorie |
| --- | --- | --- | --- |
| `alf_theme` | Mémoriser le thème clair ou sombre choisi par l'utilisateur | Jusqu'à effacement | Fonctionnel |
| `alf_device_id` | Identifier l'appareil d'un participant pour retrouver sa session et permettre la correction de ses réponses | Jusqu'à effacement | Nécessaire |
| `alf_participant_<CODE>` | Conserver la session du participant pour une activité donnée | Jusqu'à effacement | Nécessaire |
| `alf_answers_<CODE>` | Conserver localement les réponses du participant pour une activité | Jusqu'à effacement | Nécessaire |
| `alf_dev` | Marquer une session de développement local lorsque `DEV_MODE=true` | Jusqu'à effacement | Développement uniquement |
| `sb-<project-ref>-auth-token` | Conserver la session Supabase de l'organisateur connecté (nom géré par Supabase) | Selon la session Supabase | Nécessaire |

Ces valeurs sont stockées dans le navigateur et ne sont pas transmises
automatiquement à des tiers, sauf lorsqu'elles sont nécessaires à un appel API
ou à une connexion temps réel.

## Cookies et traceurs tiers

### YouTube

Le quiz vidéo charge l'API YouTube et un lecteur intégré. Dans la version
actuelle, le chargement se fait via `www.youtube.com`, qui peut déposer des
cookies et collecter des données de navigation (par exemple `VISITOR_INFO1_LIVE`,
`YSC` ou `PREF`).

Ce traitement n'est pas nécessaire au fonctionnement de base d'alf. Deux options
sont recommandées :

1. configurer le lecteur avec `host: "https://www.youtube-nocookie.com"` pour
   limiter les cookies avant lecture ;
2. ou charger le lecteur uniquement après consentement explicite de
   l'utilisateur.

La politique de confidentialité de Google est disponible ici :
<https://policies.google.com/privacy>.

### jsDelivr

La bibliothèque Supabase est chargée depuis `cdn.jsdelivr.net`. Ce CDN ne dépose
pas de cookie applicatif connu, mais reçoit l'adresse IP et les informations
techniques de la requête.

### Hébergement et infrastructure

Netlify, Render, Cloudflare et Supabase peuvent journaliser les requêtes et,
selon la configuration réseau, déposer des cookies techniques. Par exemple,
Cloudflare peut utiliser `__cf_bm` pour la protection anti-bot lorsqu'un site
est proxifié. Ces traceurs techniques ne sont pas utilisés à des fins
publicitaires.

## Consentement

- **Stockage strictement nécessaire** (session, authentification, identifiant
  d'appareil, réponses en cache) : pas de consentement préalable requis, mais
  information de l'utilisateur.
- **Préférence de thème** : choix explicite de l'utilisateur, sans suivi
  publicitaire.
- **YouTube en mode standard** : traceur tiers non essentiel ; consentement
  recommandé avant chargement, ou bascule vers `youtube-nocookie.com`.
- **Mesure d'audience ou publicité** : si un outil de ce type est ajouté, un
  bandeau de consentement conforme sera nécessaire avant tout dépôt.

## Gérer les cookies et le stockage local

L'utilisateur peut :

- supprimer le stockage local depuis les paramètres de son navigateur ;
- bloquer les cookies tiers ;
- utiliser une fenêtre de navigation privée pour les activités ponctuelles.

La suppression du stockage local peut entraîner la perte de la session
participant, des réponses en cache ou de la session organisateur.

## Contact

Pour toute question relative aux cookies et au stockage local :
[email de contact à compléter].
