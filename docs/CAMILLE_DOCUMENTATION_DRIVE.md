# Documentation Camille sur Google Drive

Camille combine une **FAQ métier intégrée** (dans le code) et les **fichiers PDF** que vous déposez sur Drive (fiches produits, argumentaires).

## 1. Créer le dossier Drive

### Option A — Admin connecté à Google

1. Ouvrez l’admin assurance.
2. Section **Documentation Camille** → **Créer le dossier Drive**.
3. Copiez la ligne `CAMILLE_KNOWLEDGE_DRIVE_FOLDER_ID="…"` affichée.
4. Collez-la dans **Railway → Variables**, redéployez.

### Option B — Compte de service (sans admin connecté)

Appelez une fois (navigateur ou curl) :

```text
GET https://assurance-emprunteur.up.railway.app/api/admin/camille-knowledge/setup-auto
```

Réponse : `folderId`, `webViewLink`, `envLine`.

## 2. Emplacement du dossier

Le dossier **`Documentation Camille`** est créé **à côté** des dossiers clients, dans :

**Dossiers Clients Assurance** (`GOOGLE_DRIVE_PARENT_FOLDER_ID`)

```
Dossiers Clients Assurance/
├── Documentation Camille/     ← vos fiches produits
├── Dossier_Assurance_Dupont/
└── …
```

## 3. Déposer vos documents

- Formats : **PDF** (recommandé), `.txt`, `.md`, Google Docs / Sheets.
- Vous pouvez créer des **sous-dossiers** (ex. `Fiches produits/`).
- Ne pas mélanger avec les dossiers clients `LCIF-XXXXXX`.

Après ajout ou modification :

- Sync automatique toutes les **6 h** et **15 s après** chaque redémarrage Railway.
- Ou bouton admin **Synchroniser la documentation**.

## 4. Variables Railway

```env
CAMILLE_KNOWLEDGE_DRIVE_FOLDER_ID="xxxxxxxx"
CAMILLE_KNOWLEDGE_SYNC_ON_START="true"
CAMILLE_KNOWLEDGE_SYNC_ENABLED="true"
CAMILLE_KNOWLEDGE_SYNC_INTERVAL_MS="21600000"
```

## 5. Partage Drive

Le compte de service (`client_email` du JSON) doit avoir accès **Éditeur** au dossier parent **Dossiers Clients Assurance** (comme pour les exports clients).

## 6. Ce que Camille en fait

| Source | Usage |
|--------|--------|
| FAQ intégrée | Questions générales assurance emprunteur, Club, process |
| PDF Drive | Fiches produits que vous commercialisez (sans citer la marque au client) |
| Dossier client | État des pièces, OCR offre/tableau (pas lecture libre de tous les PDF) |

**Présentation du Club** : utilisée **uniquement si le client pose la question** — pas dans chaque email.

**Chiffres / devis** : toujours **Charles** (escalade).
