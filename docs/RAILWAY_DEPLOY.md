# Déploiement Railway — dépannage

Le backend public est `https://assurance-emprunteur.up.railway.app`.  
La source de vérité au runtime est **`npx tsx server.ts`** (pas `node dist/server.cjs`).

## Vérifier que Railway exécute le bon code

```bash
curl -s https://assurance-emprunteur.up.railway.app/api/health | jq .
```

Réponse **à jour** (extrait) :

| Champ | Attendu |
|-------|---------|
| `build` | `railway-firestore-2026-05-27c` (ou plus récent dans `server/buildInfo.ts`) |
| `deploySource` | `tsx-server.ts` |
| `dataStore` | `firestore` |
| `firebase` | objet avec `ready`, `projectId`, etc. |
| `gitCommit` | SHA du commit Railway (ou `null` en local) |

Réponse **obsolète** (à corriger) : seulement `status`, `driveConfigVersion`, `hasServiceAccount`, `serviceAccountEmail` — **sans** `build`, `dataStore`, `firebase`.

Dans les **logs de déploiement** au démarrage, cherchez :

```text
[boot] build=railway-firestore-2026-05-27c deploySource=tsx-server.ts git=...
```

## Checklist Railway (UI)

1. **Projet** → service backend → **Settings** → **Source**
   - Repo : `leclubassurance/suivi-assurance-emprunteur`
   - Branche : `main`
   - **Root Directory** : vide ou `/` (pas un sous-dossier)
   - Si la connexion GitHub est cassée : **Disconnect** puis **Connect** le dépôt, puis redéployer.

2. **Settings** → **Deploy**
   - **Start Command** : **vide** (laisser `railway.toml` / `package.json` décider) **ou** exactement :
     `NODE_ENV=production npx tsx server.ts`
   - **Ne pas** utiliser `node dist/server.cjs` ni `npm run build:server` comme commande de démarrage.

3. **Settings** → **Build**
   - Build command : vide (Nixpacks lit `railway.toml` / `nixpacks.toml`) **ou** `npm install && npm run build`
   - Le build produit `dist/index.html` (Vite), pas le bundle serveur.

4. **Deployments**
   - Dernier déploiement **Successful**
   - Commit affiché = dernier commit GitHub `main` (ex. message contenant `railway-firestore` ou `RAILWAY_BUILD_ID`)
   - Si variables modifiées : **Apply changes** puis **Deploy**

5. **Redéployer manuellement**
   - Deployments → ⋮ sur le dernier build → **Redeploy**
   - Ou pousser un commit vide sur `main` pour déclencher le webhook GitHub.

## Causes fréquentes de code « figé »

| Cause | Symptôme | Action |
|-------|----------|--------|
| GitHub non relié / mauvaise branche | Health ancien, commit Railway ancien | Reconnecter repo, branche `main`, redeploy |
| Start Command custom `node dist/server.cjs` | Health sans Firestore / sans `build` | Effacer Start Command ou mettre `npx tsx server.ts` |
| Mauvais Root Directory | Build OK mais vieux binaire ailleurs | Root Directory = racine du repo |
| Variables sans redeploy | Changements env non appliqués | Apply + Deploy |
| `build:server` lancé en prod par erreur | Comportement bundle ancien | Ne lancer que `npm run build` (Vite) |

## Fichiers du dépôt

| Fichier | Rôle |
|---------|------|
| `railway.toml` | `buildCommand`, `startCommand` pour Nixpacks |
| `nixpacks.toml` | Phases install/build + `start` |
| `Dockerfile` | `CMD npx tsx server.ts` si builder Docker |
| `package.json` → `start` | `NODE_ENV=production npx tsx server.ts` |
| `server/buildInfo.ts` | Identifiant `RAILWAY_BUILD_ID` (health + logs) |

`dist/server.cjs` n’est **pas** versionné sur GitHub ; `build:server` est réservé au debug local. Ne pas s’en servir sur Railway.

## Variables Railway essentielles

Voir [FIREBASE_CONFIGURATION_ASSURANCE.md](./FIREBASE_CONFIGURATION_ASSURANCE.md) pour `FIREBASE_*`, `DATA_STORE=firestore`, compte de service Google, etc.

## Après un push GitHub

1. Attendre la fin du déploiement Railway (1–3 min).
2. `curl` health : vérifier `build` et `gitCommit`.
3. Si inchangé : suivre la checklist UI ci-dessus (Start Command, source GitHub, redeploy).
