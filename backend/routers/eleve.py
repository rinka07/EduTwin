# -*- coding: utf-8 -*-
"""Routes côté élève : inscription à une session et mise à jour de progression.

Endpoints :
- POST  /api/session/{session_id}/eleve/join
- PATCH /api/eleve/{eleve_id}/tache/{tache_id}

Chaque mise à jour de progression (et chaque inscription) déclenche un push
WebSocket vers les clients connectés au dashboard de la session.
"""
from fastapi import APIRouter, HTTPException

import database as db
from schemas import (
    EleveJoinBody, EleveJoinResponse, TachePatchBody, OkResponse,
    EleveCompletResponse,
)
from websocket_manager import broadcast

# Deux préfixes distincts : /api/session/... pour join, /api/eleve/... pour patch.
router_session = APIRouter(prefix="/api/session", tags=["eleve"])
router_eleve = APIRouter(prefix="/api/eleve", tags=["eleve"])


@router_session.post("/{session_id}/eleve/join", response_model=EleveJoinResponse)
async def join(session_id: str, body: EleveJoinBody) -> dict:
    """Inscrit un élève après vérification du code d'accès de la session."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")

    # Code d'accès invalide -> 400 (tolérant à la casse et aux espaces).
    if body.code_acces.strip().upper() != session["code_acces"]:
        raise HTTPException(status_code=400, detail="code d'accès invalide")

    resultat = db.join_eleve(session_id, body.nom_eleve)

    # Push WebSocket : évènement spécifique PUIS snapshot dashboard.
    await broadcast(session_id, {
        "type": "eleve_join",
        "data": {"eleve_id": resultat["eleve_id"], "nom": body.nom_eleve},
    })
    await broadcast(session_id, {
        "type": "dashboard",
        "data": db.build_dashboard(session_id),
    })

    return resultat


@router_eleve.get("/{eleve_id}", response_model=EleveCompletResponse)
def infos_eleve(eleve_id: str) -> dict:
    """Restaure la session d'un élève (tâches + progression) après actualisation."""
    complet = db.get_eleve_complet(eleve_id)
    if not complet:
        raise HTTPException(status_code=404, detail="eleve introuvable")
    return complet


@router_eleve.patch("/{eleve_id}/tache/{tache_id}", response_model=OkResponse)
async def maj_tache(eleve_id: str, tache_id: str, body: TachePatchBody) -> dict:
    """Met à jour le statut d'une tâche pour un élève et notifie le dashboard."""
    eleve = db.get_eleve(eleve_id)
    if not eleve:
        raise HTTPException(status_code=404, detail="eleve introuvable")

    session_id = eleve["session_id"]
    # Verrouillage "Terminé" : une tâche complétée ne peut plus être rouverte.
    try:
        db.patch_tache(eleve_id, tache_id, body.statut)
    except db.TacheVerrouillee:
        raise HTTPException(
            status_code=409,
            detail="tâche déjà terminée : statut verrouillé",
        )

    # Contexte additif (EXTENSIONS) pour des notifications précises côté enseignant.
    poste = db.get_poste(eleve.get("poste_id"))
    tache = next((t for t in db.get_taches(session_id) if t["id"] == tache_id), None)

    # Push WebSocket : évènement spécifique PUIS snapshot dashboard.
    await broadcast(session_id, {
        "type": "tache_update",
        "data": {
            "eleve_id": eleve_id,
            "nom": eleve["nom"],
            "classe": eleve.get("classe"),
            "numero_poste": poste["numero"] if poste else None,
            "tache_id": tache_id,
            "titre_tache": tache["titre"] if tache else None,
            "statut": body.statut,
        },
    })
    await broadcast(session_id, {
        "type": "dashboard",
        "data": db.build_dashboard(session_id),
    })

    return {"ok": True}
