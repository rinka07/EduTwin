# -*- coding: utf-8 -*-
"""Routes côté élève : inscription à une session et mise à jour de progression.

Endpoints :
- POST  /api/session/{session_id}/eleve/join
- PATCH /api/eleve/{eleve_id}/tache/{tache_id}
"""
from fastapi import APIRouter, HTTPException

import database as db
from models import EleveJoinBody, EleveJoinResponse, TachePatchBody, OkResponse
from websocket_manager import broadcast

# Deux routers : les préfixes des deux endpoints diffèrent (session vs eleve).
router_session = APIRouter(prefix="/api/session", tags=["eleve"])
router_eleve = APIRouter(prefix="/api/eleve", tags=["eleve"])


@router_session.post("/{session_id}/eleve/join", response_model=EleveJoinResponse)
async def join(session_id: str, body: EleveJoinBody) -> dict:
    """Inscrit un élève après vérification du code d'accès de la session."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")

    # Vérification du code d'accès (403 si invalide, comme le contrat l'exige).
    if body.code_acces.strip().upper() != session["code_acces"]:
        raise HTTPException(status_code=403, detail="code_acces invalide")

    resultat = db.join_eleve(session_id, body.nom_eleve)

    # Diffusion WebSocket : évènement spécifique PUIS snapshot dashboard.
    await broadcast(session_id, {
        "type": "eleve_join",
        "data": {"eleve_id": resultat["eleve_id"], "nom": body.nom_eleve},
    })
    await broadcast(session_id, {
        "type": "dashboard",
        "data": db.build_dashboard(session_id),
    })

    return resultat


@router_eleve.patch("/{eleve_id}/tache/{tache_id}", response_model=OkResponse)
async def maj_tache(eleve_id: str, tache_id: str, body: TachePatchBody) -> dict:
    """Met à jour le statut d'une tâche pour un élève et notifie le dashboard."""
    eleve = db.get_eleve(eleve_id)
    if not eleve:
        raise HTTPException(status_code=404, detail="eleve introuvable")

    session_id = eleve["session_id"]
    db.patch_tache(eleve_id, tache_id, body.statut)

    # Diffusion WebSocket : évènement spécifique PUIS snapshot dashboard.
    await broadcast(session_id, {
        "type": "tache_update",
        "data": {
            "eleve_id": eleve_id,
            "nom": eleve["nom"],
            "tache_id": tache_id,
            "statut": body.statut,
        },
    })
    await broadcast(session_id, {
        "type": "dashboard",
        "data": db.build_dashboard(session_id),
    })

    return {"ok": True}
