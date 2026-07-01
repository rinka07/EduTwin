# -*- coding: utf-8 -*-
"""Routes de gestion des sessions et de l'import de fiche TP.

Endpoints :
- POST   /api/session/create
- POST   /api/session/{session_id}/document
- GET    /api/session/{session_id}/dashboard
- GET    /api/session/{session_id}            (infos session — utilitaire)
"""
import uuid
import shutil

from fastapi import APIRouter, HTTPException, UploadFile, File

import database as db
from config import UPLOADS_DIR
from models import (
    SessionCreateBody, SessionCreateResponse,
    DocumentResponse, DashboardResponse, SessionInfoResponse,
)
from websocket_manager import broadcast

# --- Import du module IA (Lot 2) avec repli mock si absent ---
# Permet au backend de tourner même si `backend/ia/` n'est pas encore livré.
try:
    from ia import extraire_et_decouper  # type: ignore
except ImportError:  # pragma: no cover - repli de développement
    def extraire_et_decouper(chemin_fichier: str, nb_taches: int) -> dict:
        """Mock : renvoie des tâches génériques et aucun chunk."""
        return {
            "taches": [
                {
                    "titre": f"Tâche {i + 1}",
                    "consigne": "Consigne à générer par le module IA (mode dégradé).",
                }
                for i in range(nb_taches)
            ],
            "chunks": [],
        }


router = APIRouter(prefix="/api/session", tags=["session"])


@router.post("/create", response_model=SessionCreateResponse)
def creer_session(body: SessionCreateBody) -> dict:
    """Crée une nouvelle session de TP et renvoie session_id + code_acces."""
    return db.create_session(body.titre_tp, body.duree_minutes, body.nb_taches)


@router.post("/{session_id}/document", response_model=DocumentResponse)
async def importer_document(session_id: str, fichier: UploadFile = File(...)) -> dict:
    """Reçoit une fiche TP (PDF/DOCX), l'indexe (tâches + chunks) et la stocke."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")

    # Sauvegarde du fichier importé dans uploads/ (nom unique).
    document_id = uuid.uuid4().hex[:8]
    nom_origine = fichier.filename or "fiche_tp"
    suffixe = nom_origine.rsplit(".", 1)[-1] if "." in nom_origine else "bin"
    chemin = UPLOADS_DIR / f"{document_id}.{suffixe}"
    with chemin.open("wb") as sortie:
        shutil.copyfileobj(fichier.file, sortie)

    # Extraction + découpage via le module IA (ou son mock).
    # Un fichier corrompu/non pris en charge lève une exception : on renvoie
    # alors une 400 explicite plutôt qu'une 500 opaque.
    try:
        resultat = extraire_et_decouper(str(chemin), session["nb_taches"])
    except Exception as exc:  # noqa: BLE001 - message utilisateur clair pour la démo
        raise HTTPException(
            status_code=400,
            detail=f"Fiche TP illisible ou format non pris en charge : {exc}",
        )
    taches = resultat.get("taches", [])
    chunks = resultat.get("chunks", [])

    # Persistance : tâches (avec id + ordre) et chunks RAG.
    db.add_taches(session_id, taches)
    db.add_chunks(session_id, chunks)
    db.set_document(session_id, document_id)

    return {"document_id": document_id, "statut": "indexe"}


@router.get("/{session_id}/dashboard", response_model=DashboardResponse)
def dashboard(session_id: str) -> dict:
    """Retourne le snapshot du tableau de bord de la session."""
    if not db.get_session(session_id):
        raise HTTPException(status_code=404, detail="session introuvable")
    return db.build_dashboard(session_id)


@router.get("/{session_id}", response_model=SessionInfoResponse)
def infos_session(session_id: str) -> dict:
    """Retourne les informations générales d'une session (utilitaire)."""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")
    return session
