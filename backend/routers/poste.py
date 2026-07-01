# -*- coding: utf-8 -*-
"""Routes de gestion des POSTES (EXTENSIONS — hors contrat figé).

Un poste est une machine partagée par 1 à 3 élèves. Endpoints :
- POST /api/session/{session_id}/poste/join   inscription groupée d'un poste
- PUT  /api/poste/{poste_id}/assignation       répartition d'une étape à un élève
- GET  /api/poste/{poste_id}                    reprise complète (après déconnexion)
- POST /api/eleve/{eleve_id}/tache/{tache_id}/retard   alerte dépassement de temps

Chaque évènement pertinent déclenche un push WebSocket vers le dashboard de la
session (types additifs : "poste_join", "retard"), suivi d'un snapshot dashboard.
"""
from fastapi import APIRouter, HTTPException

import database as db
from schemas import (
    PosteJoinBody, PosteJoinResponse, AssignationBody, OkResponse,
    PosteCompletResponse,
)
from websocket_manager import broadcast

router_session = APIRouter(prefix="/api/session", tags=["poste"])
router_poste = APIRouter(prefix="/api/poste", tags=["poste"])
router_eleve = APIRouter(prefix="/api/eleve", tags=["poste"])


def _temps_par_tache(session: dict) -> int:
    """Temps imparti par tâche = durée totale / nombre de tâches (minutes)."""
    nb = max(session.get("nb_taches") or 1, 1)
    return max((session.get("duree_minutes") or 0) // nb, 0)


@router_session.post("/{session_id}/poste/join", response_model=PosteJoinResponse)
async def join_poste(session_id: str, body: PosteJoinBody) -> dict:
    """Inscrit un poste (1 à 3 élèves) après vérification du code d'accès."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")

    if body.code_acces.strip().upper() != session["code_acces"]:
        raise HTTPException(status_code=400, detail="code d'accès invalide")

    noms = [n.strip() for n in (body.eleves or []) if n and n.strip()]
    if not noms:
        raise HTTPException(status_code=400, detail="indiquez au moins un élève")
    if len(noms) > 3:
        raise HTTPException(status_code=400, detail="3 élèves maximum par poste")

    poste = db.create_poste(session_id, body.numero, body.classe)
    eleves = db.join_eleves_poste(session_id, poste["poste_id"], noms, body.classe)

    # Push WebSocket : évènement poste_join PUIS snapshot dashboard.
    await broadcast(session_id, {
        "type": "poste_join",
        "data": {
            "poste_id": poste["poste_id"],
            "numero": poste["numero"],
            "classe": poste["classe"],
            "eleves": eleves,
        },
    })
    await broadcast(session_id, {
        "type": "dashboard",
        "data": db.build_dashboard(session_id),
    })

    return {
        "poste_id": poste["poste_id"],
        "numero": poste["numero"],
        "classe": poste["classe"],
        "eleves": eleves,
        "taches": db.get_taches(session_id),
        "duree_minutes": session["duree_minutes"] or 0,
        "temps_par_tache": _temps_par_tache(session),
    }


@router_poste.put("/{poste_id}/assignation", response_model=OkResponse)
async def assigner_etape(poste_id: str, body: AssignationBody) -> dict:
    """Assigne une étape à un élève du poste et notifie le dashboard."""
    poste = db.get_poste_complet(poste_id)
    if not poste:
        raise HTTPException(status_code=404, detail="poste introuvable")

    ids_eleves = {e["eleve_id"] for e in poste["eleves"]}
    if body.eleve_id not in ids_eleves:
        raise HTTPException(status_code=400, detail="élève absent de ce poste")

    db.set_assignation(poste_id, body.tache_id, body.eleve_id)
    db.touch_poste(poste_id)
    await broadcast(poste["session_id"], {
        "type": "dashboard",
        "data": db.build_dashboard(poste["session_id"]),
    })
    return {"ok": True}


@router_poste.get("/{poste_id}", response_model=PosteCompletResponse)
def restaurer_poste(poste_id: str) -> dict:
    """Restaure l'intégralité d'un poste (élèves + progression + assignations)."""
    complet = db.get_poste_complet(poste_id)
    if not complet:
        raise HTTPException(status_code=404, detail="poste introuvable")
    session = db.get_session(complet["session_id"]) or {}
    complet["duree_minutes"] = session.get("duree_minutes") or 0
    complet["temps_par_tache"] = _temps_par_tache(session)
    db.touch_poste(poste_id)
    return complet


@router_eleve.post("/{eleve_id}/tache/{tache_id}/retard", response_model=OkResponse)
async def signaler_retard(eleve_id: str, tache_id: str) -> dict:
    """Signale un dépassement du temps imparti pour une étape (alerte enseignant).

    N'altère PAS la progression : le minuteur alerte sans bloquer l'élève.
    """
    eleve = db.get_eleve(eleve_id)
    if not eleve:
        raise HTTPException(status_code=404, detail="eleve introuvable")

    session_id = eleve["session_id"]
    tache = next((t for t in db.get_taches(session_id) if t["id"] == tache_id), None)
    poste = db.get_poste(eleve.get("poste_id"))

    await broadcast(session_id, {
        "type": "retard",
        "data": {
            "eleve_id": eleve_id,
            "nom": eleve["nom"],
            "classe": eleve.get("classe"),
            "numero_poste": poste["numero"] if poste else None,
            "tache_id": tache_id,
            "titre_tache": tache["titre"] if tache else None,
        },
    })
    return {"ok": True}
