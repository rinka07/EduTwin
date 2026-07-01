# CONTRAT TECHNIQUE EduTwin (FIGÉ — ne pas modifier)

Assistant intelligent de gestion de TP d'informatique — LAN, hors-ligne, Ollama local.
Ce fichier est la **source de vérité** partagée par les 3 lots. Tous les noms de champs
JSON sont **exacts** et ne doivent jamais changer (`session_id`, `eleve_id`, `titre_tp`, …).

Stack : **FastAPI (Python)** + **Ollama (LLM local)** + **SQLite** + **WebSocket** +
Frontend **HTML/CSS/JS vanilla** servi par FastAPI. Serveur lancé sur `--host 0.0.0.0`.

---

## 1. Contrat d'API HTTP (figé)

### `POST /api/session/create`
- Body : `{ "titre_tp": str, "duree_minutes": int, "nb_taches": int }`
- Resp : `{ "session_id": str, "code_acces": str }`

### `POST /api/session/{session_id}/document`
- Body : `multipart/form-data` — champ fichier nommé `fichier` (PDF ou Word .docx)
- Resp : `{ "document_id": str, "statut": "indexe" }`
- Effet : extrait le texte, découpe en `nb_taches` tâches + en chunks RAG, stocke le tout.

### `POST /api/session/{session_id}/eleve/join`
- Body : `{ "nom_eleve": str, "code_acces": str }`
- Resp : `{ "eleve_id": str, "taches": [ { "id": str, "titre": str, "consigne": str } ] }`
- Erreur code invalide : HTTP 403 `{ "detail": "code_acces invalide" }`

### `PATCH /api/eleve/{eleve_id}/tache/{tache_id}`
- Body : `{ "statut": "en_cours" | "bloque" | "complete" }`
- Resp : `{ "ok": true }`
- Effet : met à jour la progression + push WebSocket au dashboard.

### `GET /api/session/{session_id}/dashboard`
- Resp : `{ "eleves": [ { "eleve_id": str, "nom": str, "taches_completes": int,
  "taches_total": int, "statut": "actif" | "bloque" | "inactif" } ] }`

### `POST /api/chat`
- Body : `{ "eleve_id": str, "session_id": str, "question": str }`
- Resp : `{ "reponse": str, "timestamp": str }`  (timestamp ISO 8601)
- Effet : réponse IA guidée (pas la solution brute), ancrée dans la fiche TP + push WebSocket.

### `WebSocket /ws/session/{session_id}`
- Le serveur pousse un message à chaque évènement de la session (voir §2).

> Endpoints utilitaires autorisés (non figés, ajout libre par le Lot 1) :
> `GET /api/health`, `GET /api/session/{session_id}` (infos session), service des fichiers statiques.

---

## 2. Format des messages WebSocket (poussés par le serveur, JSON)

Enveloppe commune : `{ "type": <str>, "data": <objet> }`

- `{ "type": "eleve_join", "data": { "eleve_id", "nom" } }`
- `{ "type": "tache_update", "data": { "eleve_id", "nom", "tache_id", "statut" } }`
- `{ "type": "chat", "data": { "eleve_id", "nom", "question", "reponse", "timestamp" } }`
- `{ "type": "dashboard", "data": { "eleves": [ …même format que GET /dashboard… ] } }`

Règle : après **tout** changement d'état (join, tache_update, chat), le serveur envoie
l'évènement spécifique PUIS un message `dashboard` avec le snapshot complet.

---

## 3. Interface Python du module IA (Lot 2) — importée par le Lot 1

Package `backend/ia/` exposant via `backend/ia/__init__.py` :

```python
def extraire_et_decouper(chemin_fichier: str, nb_taches: int) -> dict:
    """Extrait le texte d'un PDF/DOCX, le découpe en tâches et en chunks RAG.
    Retourne :
    {
      "taches": [ {"titre": str, "consigne": str}, ... ],   # longueur == nb_taches
      "chunks": [ str, ... ]                                  # passages pour le RAG
    }
    """

def generer_reponse(question: str, taches: list[dict], chunks: list[str],
                    historique: list[dict] | None = None) -> str:
    """Réponse IA GUIDÉE (indices progressifs, jamais la solution brute),
    ancrée STRICTEMENT dans les `chunks`/`taches` de la fiche TP.
    `taches`   : [{"titre","consigne"}, ...]
    `chunks`   : passages texte de la fiche
    `historique`: [{"question","reponse"}, ...] optionnel
    Si Ollama est indisponible, retourne un message de repli clair (pas d'exception).
    """
```

Détails d'implémentation (libres, internes au Lot 2) : `tp_processor.py` (extraction PDF via
`pypdf`, DOCX via `python-docx`, découpage), `rag.py` (similarité simple TF-IDF/mots-clés,
pas d'embeddings lourds), `ollama_client.py` (HTTP `http://localhost:11434/api/generate`,
modèle par défaut `mistral` — configurable via variable d'env `EDUTWIN_MODEL`).
Le Lot 2 fournit aussi un mode dégradé/mocké utilisable sans Ollama pour tests isolés.

---

## 4. Schéma SQLite (Lot 1, fichier `data/edutwin.db`)

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY, titre_tp TEXT, duree_minutes INTEGER,
  nb_taches INTEGER, code_acces TEXT, document_id TEXT, created_at TEXT
);
CREATE TABLE taches (
  id TEXT PRIMARY KEY, session_id TEXT, ordre INTEGER, titre TEXT, consigne TEXT
);
CREATE TABLE eleves (
  eleve_id TEXT PRIMARY KEY, session_id TEXT, nom TEXT,
  statut TEXT, joined_at TEXT, last_seen TEXT
);
CREATE TABLE eleve_taches (
  eleve_id TEXT, tache_id TEXT, statut TEXT, PRIMARY KEY (eleve_id, tache_id)
);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, ordre INTEGER, contenu TEXT
);
CREATE TABLE chat_historique (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, eleve_id TEXT,
  question TEXT, reponse TEXT, timestamp TEXT
);
```

`statut` élève (dashboard) dérivé : `bloque` si une tâche est `bloque` ; `inactif` si
`last_seen` > 3 min ; sinon `actif`.

---

## 5. Frontend (Lot 3) — servi par FastAPI en statique

Pages dans `frontend/` :
- `index.html` — accueil : choix du profil (Enseignant / Élève).
- `teacher.html` — création de session, import de fiche TP, **dashboard temps réel** (WebSocket).
- `student.html` — saisie code d'accès + nom, liste des tâches (valider/bloquer), **chat IA**.

Le JS appelle l'API en **URLs relatives** (même origine) et le WebSocket via
`ws://${location.host}/ws/session/${session_id}`. Aucune dépendance CDN externe (hors-ligne) :
polices et icônes embarquées localement. Fetch helpers dans `js/api.js`, WS dans `js/ws.js`.

---

## 6. Design system (skill ui-ux-pro-max) — voir `frontend/css/tokens.css`

- Style : **Data-Dense Dashboard** (dense, lisible, pro).
- Palette : Primary `#1E3A5F` (navy) · Secondary `#2563EB` · Accent/CTA `#059669` (vert) ·
  Fond `#F8FAFC` · Texte `#0F172A` · Muted `#F1F3F5` · Bordure `#E4E7EB` · Danger `#DC2626`.
- Statuts : actif/complete = vert `#059669` · en_cours = bleu `#2563EB` · bloque = danger `#DC2626` · inactif = gris.
- Typo : **Fira Sans** (texte/UI) + **Fira Code** (données, code d'accès, consignes techniques).
- Icônes : SVG inline (style Lucide), jamais d'emoji. Transitions 150–300ms. Focus visibles.
  Contraste ≥ 4.5:1. Responsive 375/768/1024/1440. Respecter `prefers-reduced-motion`.
