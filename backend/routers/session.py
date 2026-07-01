# -*- coding: utf-8 -*-
"""Routes de gestion des sessions et d'import de la fiche TP.

Endpoints :
- POST  /api/session/create
- POST  /api/session/{session_id}/document   (stockage + indexation IA)
- GET   /api/session/{session_id}/dashboard
- GET   /api/session/{session_id}            (infos session — utilitaire)

L'endpoint /document stocke le fichier brut (table documents) PUIS le fait
indexer par le module IA (Lot 2) : extraction du texte, découpage en tâches et
en chunks RAG. L'enseignant peut ensuite ajuster les tâches via l'éditeur.
"""
import shutil

from fastapi import APIRouter, HTTPException, UploadFile, File

import database as db
from config import UPLOADS_DIR
from schemas import (
    SessionCreateBody, SessionCreateResponse,
    DocumentResponse, DashboardResponse, SessionInfoResponse,
)

# --- Module IA (Lot 2) avec repli si absent ---
# Permet au backend de fonctionner même sans le module ia/ (tâches génériques).
try:
    from ia import extraire_et_decouper  # type: ignore
except ImportError:  # pragma: no cover - repli de développement
    def extraire_et_decouper(chemin_fichier: str, nb_taches: int) -> dict:
        return {
            "taches": [
                {"titre": f"Tâche {i + 1}",
                 "consigne": "Consigne à compléter (module IA indisponible)."}
                for i in range(max(nb_taches, 1))
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
    """Stocke la fiche TP (PDF/Word) puis l'indexe (tâches + chunks RAG) via l'IA."""
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

    # Indexation IA : extraction du texte + découpage en tâches et chunks.
    # Un fichier illisible/corrompu → 400 explicite (plutôt qu'une 500 opaque).
    try:
        resultat = extraire_et_decouper(str(chemin), session["nb_taches"])
    except Exception as exc:  # noqa: BLE001 - message utilisateur clair
        raise HTTPException(
            status_code=400,
            detail=f"Fiche TP illisible ou format non pris en charge : {exc}",
        )
    db.add_taches(session_id, resultat.get("taches", []))
    db.add_chunks(session_id, resultat.get("chunks", []))

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
