# EduTwin

**Assistant intelligent de gestion de TP d'informatique** — fonctionne en **réseau LAN**,
**100 % hors-ligne**, avec un **LLM local (Ollama)**. Conçu pour les lycées camerounais.
Hackathon EdTech Day Yaoundé 2026 — ENS Yaoundé I.

L'enseignant crée une session et importe sa fiche de TP (PDF/Word). Les élèves rejoignent
la session via un code d'accès depuis leur poste, consultent les tâches, valident leur
progression et posent des questions à un assistant IA qui **guide sans donner la solution**,
ancré strictement dans la fiche du TP. L'enseignant suit tout en **temps réel** sur son
tableau de bord (WebSocket).

> EduTwin n'est ni un IDE ni un traitement de texte : l'élève continue de travailler dans
> ses outils habituels (Dev-C++, Word…). EduTwin est une couche de **guidage et de suivi**.

---

## Architecture

```
Machine enseignant                     Postes élèves (×N)
┌─────────────────────────┐            ┌────────────────────┐
│ Serveur FastAPI (LAN)   │  WebSocket │ Navigateur         │
│ + Ollama (LLM local)    │◄──────────►│ frontend HTML/CSS/JS│
│ + SQLite                │   HTTP     │ (servi par FastAPI)│
│ + Dashboard temps réel  │            └────────────────────┘
└─────────────────────────┘
```

- **Backend** : FastAPI + SQLite + WebSocket (`backend/`)
- **IA** : extraction PDF/DOCX + RAG simple + client Ollama (`backend/ia/`)
- **Frontend** : HTML/CSS/JS vanilla, sans CDN (`frontend/`), servi par FastAPI
- Contrat technique figé : voir [`CONTRAT.md`](CONTRAT.md)

## Prérequis

- Python 3.10+
- (Optionnel mais recommandé) **Ollama** pour la vraie IA :
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ollama serve
  ollama pull mistral          # modèle par défaut (~4 Go)
  # autre modèle : export EDUTWIN_MODEL=llama3
  ```
  Sans Ollama, l'assistant renvoie un **repli** : les passages pertinents de la fiche TP.

## Lancement (poste enseignant)

```bash
cd backend
./run.sh                       # crée le venv, installe les deps, lance sur 0.0.0.0:8000
```
ou manuellement :
```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

Le script affiche l'**IP LAN**. Les élèves ouvrent alors `http://<IP-LAN>:8000` dans leur
navigateur (même réseau local, sans Internet).

## Utilisation

1. **Enseignant** → `http://<IP-LAN>:8000` → *Espace Enseignant* : créer la session,
   importer la fiche TP, communiquer le **code d'accès** (ou le lien élève).
2. **Élève** → *Espace Élève* : saisir nom + code d'accès, consulter les tâches, dialoguer
   avec l'assistant, marquer les tâches (en cours / bloqué / terminé).
3. **Enseignant** : le **dashboard** se met à jour en temps réel (progression, blocages,
   questions posées).

Documentation interactive de l'API : `http://<IP-LAN>:8000/docs`.

## Tests rapides

```bash
cd backend
.venv/bin/python ia/test_ia.py         # test isolé du module IA
```

## Structure

```
EduTwin/
├── CONTRAT.md              # contrat technique figé (API, WS, IA, DB, design)
├── backend/
│   ├── main.py             # app FastAPI, WebSocket, service statique
│   ├── database.py         # SQLite (schéma + accès)
│   ├── models.py           # modèles Pydantic
│   ├── websocket_manager.py
│   ├── routes/             # session, eleve, chat
│   ├── ia/                 # extraction + RAG + Ollama
│   └── requirements.txt
└── frontend/
    ├── index.html · teacher.html · student.html
    ├── css/                # tokens (design system) + composants + pages
    └── js/                 # api, ws, teacher, student
```

## Design

Interface conçue selon le design system **Data-Dense Dashboard** (skill ui-ux-pro-max) :
palette navy `#1E3A5F` / bleu `#2563EB` / vert `#059669`, typographie Fira Sans + Fira Code,
icônes SVG, accessibilité AA, responsive. Tokens dans `frontend/css/tokens.css`.

> Polices : déposez `Fira Sans`/`Fira Code` en `.woff2` dans `frontend/fonts/` pour le rendu
> exact hors-ligne ; sinon un fallback système propre est utilisé automatiquement.
