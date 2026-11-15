# alf

Animez vos cours et formations : nuages de mots, votes en direct, quiz et quiz
vidéo YouTube. Les participants rejoignent depuis leur téléphone avec un code ou
un QR code, sans installer d'application.

Le projet est volontairement léger : un backend Python (FastAPI), un frontend
HTML/CSS/JS sans build, et Supabase pour l'authentification et la base de
données.

## Fonctionnalités

- **Nuages de mots** : les participants envoient un mot, le nuage se construit en
  direct.
- **Votes** : sondez la salle et affichez les résultats.
- **Quiz** : questions à choix multiples, réponses en temps réel, bonne réponse
  révélée quand l'animateur le décide.
- **Quiz vidéo / audio** : utilisez une vidéo YouTube et affichez les questions
  à des moments précis.
- **Activités autonomes** : chaque activité a son propre code à six caractères,
  son écran de présentation et sa page participant.
- **Historique** : les réponses et les mots sont conservés en base, avec export
  CSV des résultats.

## Architecture

```text
alf-v2/
├── backend/          API FastAPI, modèles SQLAlchemy, tests
├── cloudflare/       Worker + Durable Object pour le temps réel
├── frontend/         Pages et assets statiques (aucun build)
├── scripts/          Outils de déploiement
└── .github/          Intégration continue
```

- Backend : FastAPI + SQLAlchemy 2 (async), SQLite en local, PostgreSQL
  (Supabase) en production.
- Temps réel : Worker Cloudflare avec un Durable Object par activité. Le DO
  garde les WebSockets, agrège les mots et diffuse des snapshots. Les mots sont
  ensuite envoyés au backend par lots pour la persistance Supabase.
- Fallback local : si `REALTIME_URL` est vide, le backend utilise son ancien
  gestionnaire WebSocket en mémoire.
- Authentification : Supabase Auth (email / mot de passe). Le frontend obtient
  un jeton et le backend le vérifie.

## Démarrage local

Prérequis : Python 3.12+.

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

L'API écoute sur <http://localhost:8000>. En local, `DEV_MODE=true` contourne
l'authentification et SQLite est utilisé par défaut.

Dans un second terminal, servez le frontend :

```bash
python -m http.server 5500 --directory frontend
```

Ouvrez <http://localhost:5500>. Créez une activité depuis le tableau de bord,
ouvrez l'écran de présentation, puis faites rejoindre les participants avec le
code ou le QR code affiché.

Pour utiliser le Worker Cloudflare en local, dans un troisième terminal :

```bash
cd cloudflare
npm install
cp .dev.vars.example .dev.vars
npx wrangler dev
```

Le backend doit alors avoir `REALTIME_URL=http://127.0.0.1:8787` et le même
`INTERNAL_TOKEN` que `cloudflare/.dev.vars`.

## Configuration

Copiez `.env.example` vers `backend/.env` et ajustez les valeurs.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite+aiosqlite:///./alf.db` | Connexion SQLAlchemy async |
| `DEV_MODE` | `true` | Contourne l'authentification (à passer à `false` en production) |
| `DEV_USER_ID` | `dev-user` | Identité utilisée quand `DEV_MODE=true` |
| `SUPABASE_URL` | — | URL du projet Supabase |
| `SUPABASE_ANON_KEY` | — | Clé publique, exposée au navigateur via `/api/config` |
| `SUPABASE_JWT_SECRET` | — | Secret de signature des jetons ; sinon JWKS est utilisé |
| `CORS_ORIGINS` | origines locales | Origines autorisées, séparées par des virgules |
| `FRONTEND_DIR` | — | Sert le frontend depuis le backend si défini |
| `REALTIME_URL` | — | Origine HTTP du Worker Cloudflare, vide pour le fallback local |
| `INTERNAL_TOKEN` | — | Secret partagé avec le Worker pour le batch des mots |
| `ACTIVITY_CODE_LENGTH` | `6` | Longueur des codes d'activité |

## Supabase

1. Créez un projet Supabase.
2. Activez la connexion email / mot de passe dans Authentication.
3. Renseignez `SUPABASE_URL`, `SUPABASE_ANON_KEY` et, si votre projet utilise
   encore des jetons HS256, `SUPABASE_JWT_SECRET`.
4. Utilisez la chaîne de connexion PostgreSQL de Supabase comme `DATABASE_URL`
   (driver `postgresql+asyncpg://`).
5. Passez `DEV_MODE=false`.

La migration du schéma est automatique au démarrage. Les tables sont créées si
elles n'existent pas, ce qui suffit pour ce projet ; pour des changements de
schéma en production, ajoutez une migration explicite.

Ne placez jamais la chaîne de connexion PostgreSQL ni le secret JWT dans le
frontend. Seuls `SUPABASE_URL` et `SUPABASE_ANON_KEY` sont exposés.

## Déploiement

### Backend sur Render

- Le blueprint `render.yaml` crée le service Docker à partir du `Dockerfile`.
- Renseignez les variables d'environnement ci-dessus, avec `DEV_MODE=false` et
  `FRONTEND_DIR` vide si le frontend est servi par Netlify.
- Ajoutez l'URL Netlify à `CORS_ORIGINS`.
- Renseignez `INTERNAL_TOKEN` avec le même secret que le Worker.

### Temps réel sur Cloudflare

- Le Worker `alf-realtime` et son Durable Object sont définis dans `cloudflare/`.
- `REALTIME_URL` vaut `https://alf-realtime.alf-realtime.workers.dev`.
- Le secret du Worker doit être identique à `INTERNAL_TOKEN` sur Render :

```bash
cd cloudflare
npx wrangler secret put ALF_INTERNAL_TOKEN
npx wrangler deploy
```

Le secret n'est jamais stocké dans le dépôt. Les origines navigateur autorisées
sont configurées dans `cloudflare/wrangler.jsonc` via `ALLOWED_ORIGINS`.

### Frontend sur Netlify

- Publiez le dossier `frontend`.
- Définissez `ALF_API_BASE` sur l'URL publique du backend.
- La commande de build `bash scripts/render-config.sh` écrit
  `frontend/static/js/config.js` avec cette URL.

### Tout-en-un avec Docker

```bash
docker compose up --build
```

Ouvrez <http://localhost:8000>. Le frontend est servi par le backend et les
données SQLite sont conservées dans un volume.

## Tests et qualité

```bash
cd backend
ruff check .
pytest -q

cd ../cloudflare
npm run typecheck
npx wrangler deploy --dry-run
```

## Licence

MIT. Voir [LICENSE](LICENSE).
