# EduTwin — Lot 1 : Backend Core

API backend (FastAPI + SQLite + WebSocket) qui sert de socle aux autres lots
(Lot 2 = LLM, Lot 3 = frontend enseignant, Lot 4 = frontend élève).
Fonctionne en **réseau LAN local, hors-ligne**.

## Prérequis
- Python 3.11+

## Installation
```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Lancer le serveur (accessible sur le LAN)
```bash
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```
ou simplement :
```bash
./run.sh
```
- `--host 0.0.0.0` rend le serveur accessible depuis les autres postes du réseau.
- Les élèves ouvrent alors `http://<IP-LAN-enseignant>:8000`.
- **Documentation interactive (Swagger)** : `http://<IP-LAN>:8000/docs`
- Santé : `http://<IP-LAN>:8000/api/health`

> Lancer TOUJOURS depuis le dossier `backend/` (les imports `routers.*` et
> `ia.*` en dépendent).

## Données de démonstration
Pour tester sans attendre les autres lots (1 session, 4 tâches, 5 élèves) :
```bash
.venv/bin/python seed.py
```
Session de démo créée avec des identifiants **fixes** :
- `session_id` : `demo0001`
- `code_acces` : `DEMO24`

## Contrat d'API (implémenté)
| Méthode | Route | Rôle |
|--------|-------|------|
| POST | `/api/session/create` | Crée une session → `{session_id, code_acces}` |
| POST | `/api/session/{session_id}/document` | Stocke la fiche TP brute → `{document_id, statut}` |
| POST | `/api/session/{session_id}/eleve/join` | Inscrit un élève → `{eleve_id, taches[]}` |
| PATCH | `/api/eleve/{eleve_id}/tache/{tache_id}` | Met à jour une tâche → `{ok:true}` (+ push WS) |
| GET | `/api/session/{session_id}/dashboard` | Snapshot du dashboard |
| WS | `/ws/session/{session_id}` | Poussée temps réel vers le dashboard |

Endpoints utilitaires : `GET /api/health`, `GET /api/session/{session_id}`.

### Notes de périmètre
- **`/document`** : le Lot 1 **stocke seulement** le fichier + une entrée en base
  (table `documents`). L'extraction / l'indexation du contenu (tâches, chunks
  RAG) est réalisée par le **Lot 2**.
- **`/api/chat`** relève du **Lot 2**. Le Lot 1 expose la fonction
  `websocket_manager.notify_session(session_id, message)` pour que le Lot 2
  pousse ses évènements (nouvelle question/réponse) au dashboard.

## Gestion des erreurs
- `404` : session ou élève introuvable.
- `400` : code d'accès invalide ; format de fichier non pris en charge.

## Structure
```
backend/
├── main.py              # app FastAPI : routers, WebSocket, statique, /docs
├── config.py            # constantes (host/port, chemins, règles métier)
├── database.py          # connexion SQLite + fonctions d'accès
├── models.py            # schéma des tables (DDL)
├── schemas.py           # schémas Pydantic (validation I/O)
├── websocket_manager.py # connexions WS par session + notify_session()
├── seed.py              # données de démonstration
├── requirements.txt
└── routers/
    ├── session.py       # create · document · dashboard · infos
    └── eleve.py         # join · patch tâche
```

## Messages WebSocket (JSON)
Enveloppe : `{ "type": <str>, "data": <objet> }`
- `eleve_join` : `{ eleve_id, nom }`
- `tache_update` : `{ eleve_id, nom, tache_id, statut }`
- `dashboard` : snapshot complet `{ eleves: [...] }` (envoyé après chaque évènement
  et à la connexion d'un client)
