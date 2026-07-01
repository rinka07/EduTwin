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
from fastapi.responses import FileResponse

import database as db
from config import UPLOADS_DIR
from schemas import (
    SessionCreateBody, SessionCreateResponse,
    DocumentResponse, DashboardResponse, SessionInfoResponse,
    RessourceResponse, RessourcesListResponse,
)

# Nombre minimum d'étapes imposé pour un TP (contrainte pédagogique EXTENSIONS).
NB_TACHES_MIN = 3

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
# Router dédié au téléchargement d'une ressource par son identifiant.
router_ressource = APIRouter(prefix="/api/ressource", tags=["session"])


@router.post("/create", response_model=SessionCreateResponse)
def creer_session(body: SessionCreateBody) -> dict:
    """Crée une nouvelle session de TP et renvoie session_id + code_acces.

    Contrainte métier : un TP doit comporter au moins NB_TACHES_MIN étapes.
    """
    if body.nb_taches < NB_TACHES_MIN:
        raise HTTPException(
            status_code=400,
            detail=f"un TP doit comporter au moins {NB_TACHES_MIN} étapes",
        )
    if body.duree_minutes < 1:
        raise HTTPException(status_code=400, detail="durée invalide")
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
    nb = max(session.get("nb_taches") or 1, 1)
    session["temps_par_tache"] = max((session.get("duree_minutes") or 0) // nb, 0)
    return session


# ---------------------------------------------------------------------------
# Ressources complémentaires (EXTENSIONS) : contexte supplémentaire pour l'IA.
# ---------------------------------------------------------------------------
# Extraction réutilisée de l'IA (Lot 2) avec repli si le module est absent.
try:
    from ia.tp_processor import extraire_texte, decouper_en_chunks  # type: ignore
except Exception:  # pragma: no cover - repli de développement
    extraire_texte = None
    decouper_en_chunks = None


@router.post("/{session_id}/ressource", response_model=RessourceResponse)
async def importer_ressource(session_id: str, fichier: UploadFile = File(...)) -> dict:
    """Dépose une ressource complémentaire et enrichit le contexte IA.

    Le fichier est stocké sur disque ; son texte (si extractible) est ajouté
    aux chunks RAG de la session pour que l'assistant cadre mieux le TP.
    """
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session introuvable")

    nom_origine = fichier.filename or "ressource"
    chemin = UPLOADS_DIR / f"ressource_{session_id}_{nom_origine}"
    try:
        with chemin.open("wb") as sortie:
            shutil.copyfileobj(fichier.file, sortie)
    finally:
        fichier.file.close()

    ressource_id = db.add_ressource(session_id, nom_origine, str(chemin))

    # Injection dans le contexte IA (best-effort : ne bloque jamais le dépôt).
    statut = "stocke"
    if extraire_texte and decouper_en_chunks:
        try:
            texte = extraire_texte(str(chemin))
            db.append_chunks(session_id, decouper_en_chunks(texte))
            statut = "indexe"
        except Exception:
            statut = "stocke"

    return {"ressource_id": ressource_id, "nom": nom_origine, "statut": statut}


@router.get("/{session_id}/ressources", response_model=RessourcesListResponse)
def lister_ressources(session_id: str) -> dict:
    """Liste les ressources complémentaires déposées pour une session."""
    if not db.get_session(session_id):
        raise HTTPException(status_code=404, detail="session introuvable")
    return {"ressources": db.list_ressources(session_id)}


@router_ressource.get("/{ressource_id}")
def telecharger_ressource(ressource_id: str):
    """Renvoie le fichier d'une ressource complémentaire pour téléchargement."""
    ressource = db.get_ressource(ressource_id)
    if not ressource:
        raise HTTPException(status_code=404, detail="ressource introuvable")
    return FileResponse(ressource["chemin_fichier"], filename=ressource["nom"])
