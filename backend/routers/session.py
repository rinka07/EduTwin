# -*- coding: utf-8 -*-
"""Routes de gestion des sessions et d'import de la fiche TP (Lot 1).

Endpoints :
- POST  /api/session/create
- POST  /api/session/{session_id}/document   (stockage brut — pas d'extraction)
- GET   /api/session/{session_id}/dashboard
- GET   /api/session/{session_id}            (infos session — utilitaire)

Périmètre Lot 1 : l'endpoint /document se contente de STOCKER le fichier sur
disque et de créer une entrée en base. L'extraction et l'indexation du contenu
(découpage en tâches/chunks) sont réalisées par le Lot 2.
"""
import shutil

from fastapi import APIRouter, HTTPException, UploadFile, File

import database as db
from config import UPLOADS_DIR
from schemas import (
    SessionCreateBody, SessionCreateResponse,
    DocumentResponse, DashboardResponse, SessionInfoResponse,
)

router = APIRouter(prefix="/api/session", tags=["session"])


@router.post("/create", response_model=SessionCreateResponse)
def creer_session(body: SessionCreateBody) -> dict:
    """Crée une nouvelle session de TP et renvoie session_id + code_acces."""
    return db.create_session(body.titre_tp, body.duree_minutes, body.nb_taches)


@router.post("/{session_id}/document", response_model=DocumentResponse)
async def importer_document(session_id: str, fichier: UploadFile = File(...)) -> dict:
    """Stocke la fiche TP brute (PDF/Word) sur disque et crée l'entrée en base.

    NB (Lot 1) : aucune extraction ici. Le Lot 2 lira le fichier stocké pour
    l'indexer. La valeur de `statut` renvoyée est "indexe" (figée par le contrat).
    """
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")

    # Nom de fichier sûr : on ne conserve que l'extension d'origine.
    nom_origine = fichier.filename or "fiche_tp"
    suffixe = nom_origine.rsplit(".", 1)[-1].lower() if "." in nom_origine else "bin"
    if suffixe not in {"pdf", "doc", "docx"}:
        raise HTTPException(
            status_code=400,
            detail="format non pris en charge (PDF ou Word .doc/.docx attendu)",
        )

    # Écriture du fichier brut dans uploads/ sous un nom unique.
    chemin = UPLOADS_DIR / f"{session_id}_{nom_origine}"
    try:
        with chemin.open("wb") as sortie:
            shutil.copyfileobj(fichier.file, sortie)
    finally:
        fichier.file.close()

    document_id = db.add_document(session_id, str(chemin))
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
