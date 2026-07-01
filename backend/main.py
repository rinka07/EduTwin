# -*- coding: utf-8 -*-
"""Point d'entrée de l'application FastAPI EduTwin (Lot 1).

Assemble :
- l'initialisation de la base SQLite au démarrage ;
- les routers du Lot 1 (session, élève) + l'endpoint chat du Lot 2 si présent ;
- la route WebSocket temps réel /ws/session/{session_id} ;
- le service des fichiers statiques du frontend (Lot 3) ;
- CORS permissif (usage LAN) et l'endpoint /api/health.

Lancer DEPUIS le dossier backend/ afin que `from routers.xxx import ...`
(et `from ia import ...` pour le Lot 2) fonctionnent (sys.path inclut backend/).
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

import database as db
from config import HOST, PORT, FRONTEND_DIR
from websocket_manager import manager

# --- Routers du Lot 1 (Backend Core) ---
from routers.session import (
    router as session_router,
    router_ressource as ressource_router,
)
from routers.eleve import router_session as eleve_session_router, router_eleve
from routers.teacher import router as teacher_router, router_taches as taches_router
# --- Routers EXTENSIONS (postes, assignations, reprise, retard) ---
from routers.poste import (
    router_session as poste_session_router,
    router_poste,
    router_eleve as poste_eleve_router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Cycle de vie : crée la base SQLite au démarrage."""
    db.init_db()
    yield
    # Rien de particulier à libérer à l'arrêt.


# Création de la base dès l'import (idempotent) : garantit que les tables
# existent quel que soit le mode de lancement (uvicorn, TestClient, import).
db.init_db()

app = FastAPI(title="EduTwin — Backend Core (Lot 1)", lifespan=lifespan)

# --- CORS permissif (réseau local, hors-ligne) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Endpoint de santé ---
@app.get("/api/health", tags=["health"])
def health() -> dict:
    """Vérifie que le serveur répond."""
    return {"status": "ok"}


# --- Inclusion des routers du Lot 1 ---
app.include_router(session_router)
app.include_router(ressource_router)
app.include_router(eleve_session_router)
app.include_router(router_eleve)

# --- Espace enseignant : authentification, historique, édition des tâches ---
app.include_router(teacher_router)
app.include_router(taches_router)

# --- EXTENSIONS : gestion des postes (multi-élèves), assignations, retard ---
app.include_router(poste_session_router)
app.include_router(router_poste)
app.include_router(poste_eleve_router)

# --- Endpoint chat (périmètre Lot 2) : monté s'il est disponible ---
# Le Lot 1 n'implémente pas le chat ; on branche l'endpoint fourni par le Lot 2
# (routes/chat.py) pour que l'application intégrée réponde sur /api/chat.
try:
    from routes.chat import router as chat_router
    app.include_router(chat_router)
except Exception as exc:  # pragma: no cover - le chat est optionnel côté Lot 1
    import logging
    logging.getLogger("edutwin").warning(
        "Endpoint chat (Lot 2) non chargé : %s", exc
    )


# --- WebSocket temps réel par session ---
@app.websocket("/ws/session/{session_id}")
async def ws_session(websocket: WebSocket, session_id: str) -> None:
    """Connexion temps réel : envoie un snapshot dashboard puis reste ouverte."""
    await manager.connect(session_id, websocket)
    try:
        # Snapshot initial du tableau de bord dès la connexion.
        await websocket.send_json({
            "type": "dashboard",
            "data": db.build_dashboard(session_id),
        })
        # Boucle de maintien : on lit les messages entrants (ignorés) pour
        # détecter proprement la fermeture côté client.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(session_id, websocket)
    except Exception:
        # Toute autre erreur : on déconnecte proprement.
        await manager.disconnect(session_id, websocket)


# --- Service du frontend statique (Lot 3) ---
# Route explicite pour «/» : sert index.html s'il existe, sinon un message clair.
@app.get("/", include_in_schema=False)
def racine():
    index = FRONTEND_DIR / "index.html"
    if index.is_file():
        return FileResponse(str(index))
    return JSONResponse(
        {"message": "EduTwin backend actif. Le frontend (Lot 3) n'est pas encore présent."}
    )


# Montage du dossier frontend/ en statique (css, js, autres pages HTML).
# `html=True` permet de servir directement les fichiers .html par leur chemin.
# Placé en DERNIER pour ne pas masquer les routes API et WebSocket.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    # Lancement direct : python main.py
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
