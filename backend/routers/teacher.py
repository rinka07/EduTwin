# -*- coding: utf-8 -*-
"""Routes de l'espace enseignant (authentification, historique, édition tâches).

Endpoints :
- POST   /api/teacher/login                         (public)
- GET    /api/teacher/sessions                       (protégé) historique des séances
- GET    /api/session/{session_id}/taches            (protégé) tâches éditables
- POST   /api/session/{session_id}/taches            (protégé) ajouter une tâche
- PATCH  /api/session/{session_id}/taches/{tache_id} (protégé) modifier une tâche
- DELETE /api/session/{session_id}/taches/{tache_id} (protégé) supprimer une tâche

Les endpoints protégés exigent l'en-tête `X-Edu-Token` (voir auth.py). Cela
empêche les élèves d'accéder aux fonctions enseignant.
"""
from fastapi import APIRouter, HTTPException, Depends

import database as db
from auth import creer_token, exiger_enseignant
from websocket_manager import broadcast
from schemas import (
    LoginBody, TokenResponse, SessionsListResponse,
    TachesListResponse, TacheComplete, TacheCreateBody, TacheUpdateBody, OkResponse,
)

# Router d'authentification / historique (préfixe /api/teacher).
router = APIRouter(prefix="/api/teacher", tags=["enseignant"])

# Router d'édition des tâches (préfixe /api/session, protégé globalement).
router_taches = APIRouter(
    prefix="/api/session", tags=["enseignant"],
    dependencies=[Depends(exiger_enseignant)],
)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginBody) -> dict:
    """Authentifie l'enseignant et renvoie un jeton (401 si mot de passe faux)."""
    token = creer_token(body.mot_de_passe)
    if not token:
        raise HTTPException(status_code=401, detail="mot de passe incorrect")
    return {"token": token}


@router.get("/sessions", response_model=SessionsListResponse,
            dependencies=[Depends(exiger_enseignant)])
def historique_sessions() -> dict:
    """Retourne l'historique des séances créées (récentes d'abord)."""
    return {"sessions": db.list_sessions()}


# Nombre minimum d'étapes imposé pour un TP (aligné sur session.NB_TACHES_MIN).
NB_TACHES_MIN = 3


def _verifier_session(session_id: str) -> dict:
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")
    return session


@router_taches.get("/{session_id}/taches", response_model=TachesListResponse)
def lister_taches(session_id: str) -> dict:
    """Liste les tâches d'une session (avec ordre) pour édition."""
    _verifier_session(session_id)
    return {"taches": db.get_taches_full(session_id)}


@router_taches.post("/{session_id}/taches", response_model=TacheComplete)
async def ajouter_tache(session_id: str, body: TacheCreateBody) -> dict:
    """Ajoute une tâche à la session et notifie le dashboard (total modifié).

    Contrainte : on ne dépasse pas le nombre de tâches défini pour le TP
    (`sessions.nb_taches`) — « pas plus » d'étapes que prévu.
    """
    session = _verifier_session(session_id)
    actuel = len(db.get_taches_full(session_id))
    cible = session.get("nb_taches") or 0
    if cible and actuel >= cible:
        raise HTTPException(
            status_code=400,
            detail=f"nombre d'étapes défini atteint ({cible}) : suppression requise avant ajout",
        )
    tache = db.add_single_tache(session_id, body.titre.strip(), body.consigne)
    await broadcast(session_id, {"type": "dashboard", "data": db.build_dashboard(session_id)})
    return tache


@router_taches.patch("/{session_id}/taches/{tache_id}", response_model=OkResponse)
def modifier_tache(session_id: str, tache_id: str, body: TacheUpdateBody) -> dict:
    """Modifie le titre et/ou la consigne d'une tâche."""
    _verifier_session(session_id)
    titre = body.titre.strip() if body.titre is not None else None
    ok = db.update_tache(session_id, tache_id, titre, body.consigne)
    if not ok:
        raise HTTPException(status_code=404, detail="tâche introuvable")
    return {"ok": True}


@router_taches.delete("/{session_id}/taches/{tache_id}", response_model=OkResponse)
async def supprimer_tache(session_id: str, tache_id: str) -> dict:
    """Supprime une tâche et notifie le dashboard.

    Contrainte : un TP conserve au moins NB_TACHES_MIN étapes — « pas moins ».
    """
    _verifier_session(session_id)
    if len(db.get_taches_full(session_id)) <= NB_TACHES_MIN:
        raise HTTPException(
            status_code=400,
            detail=f"un TP doit conserver au moins {NB_TACHES_MIN} étapes",
        )
    if not db.delete_tache(session_id, tache_id):
        raise HTTPException(status_code=404, detail="tâche introuvable")
    await broadcast(session_id, {"type": "dashboard", "data": db.build_dashboard(session_id)})
    return {"ok": True}
