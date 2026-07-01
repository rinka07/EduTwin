# -*- coding: utf-8 -*-
"""Route du chat IA guidé.

Endpoint : POST /api/chat

PÉRIMÈTRE : cet endpoint relève du Lot 2 (LLM). Il est conservé ici pour que
l'application intégrée fonctionne de bout en bout. Le Lot 1 lui fournit
uniquement l'accès aux données et la fonction de diffusion `broadcast`
(exposée aussi sous le nom `notify_session`).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

import database as db
from schemas import ChatBody, ChatResponse
from websocket_manager import broadcast

# --- Import du module IA (Lot 2) avec repli mock si absent ---
try:
    from ia import generer_reponse  # type: ignore
except ImportError:  # pragma: no cover - repli de développement
    def generer_reponse(question, taches, chunks, historique=None) -> str:
        """Mock : message de repli clair tant que le module IA n'est pas prêt."""
        return (
            "Assistant IA indisponible pour le moment (mode dégradé). "
            "Relis la consigne de ta tâche et décompose le problème en petites étapes."
        )


router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatBody) -> dict:
    """Répond à la question d'un élève en s'ancrant dans la fiche TP."""
    session = db.get_session(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")

    eleve = db.get_eleve(body.eleve_id)
    if not eleve:
        raise HTTPException(status_code=404, detail="eleve introuvable")

    # Contexte pour l'IA : tâches + chunks de la fiche + historique de l'élève.
    contexte = db.get_chunks_and_taches(body.session_id)
    historique = db.get_historique(body.session_id, body.eleve_id)

    reponse = generer_reponse(
        body.question,
        contexte["taches"],
        contexte["chunks"],
        historique,
    )

    timestamp = datetime.now(timezone.utc).isoformat()

    # Persistance de l'échange + rafraîchissement de l'activité de l'élève.
    db.save_chat(body.session_id, body.eleve_id, body.question, reponse, timestamp)
    db.touch_eleve(body.eleve_id)

    # Contexte additif (EXTENSIONS) : poste/classe pour des notifications précises.
    poste = db.get_poste(eleve.get("poste_id"))

    # Diffusion WebSocket : évènement chat PUIS snapshot dashboard.
    await broadcast(body.session_id, {
        "type": "chat",
        "data": {
            "eleve_id": body.eleve_id,
            "nom": eleve["nom"],
            "classe": eleve.get("classe"),
            "numero_poste": poste["numero"] if poste else None,
            "question": body.question,
            "reponse": reponse,
            "timestamp": timestamp,
        },
    })
    await broadcast(body.session_id, {
        "type": "dashboard",
        "data": db.build_dashboard(body.session_id),
    })

    return {"reponse": reponse, "timestamp": timestamp}
