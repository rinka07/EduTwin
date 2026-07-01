# -*- coding: utf-8 -*-
"""Schémas Pydantic des corps de requête et de réponse (contrat d'API).

Les noms de champs respectent EXACTEMENT le contrat d'API du hackathon et ne
doivent pas changer (session_id, code_acces, nom_eleve, statut, …).
"""
from typing import List, Literal, Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
class SessionCreateBody(BaseModel):
    """Body de POST /api/session/create."""
    titre_tp: str
    duree_minutes: int
    nb_taches: int  # contrainte métier : >= 3 (validée dans la route)


class SessionCreateResponse(BaseModel):
    session_id: str
    code_acces: str


class DocumentResponse(BaseModel):
    """Réponse de POST /api/session/{session_id}/document."""
    document_id: str
    statut: str  # "indexe" (valeur figée par le contrat)


class SessionInfoResponse(BaseModel):
    """Réponse de l'endpoint utilitaire GET /api/session/{session_id}."""
    session_id: str
    titre_tp: str
    duree_minutes: int
    nb_taches: int
    code_acces: str
    document_id: Optional[str] = None
    created_at: str
    # Champ additif (EXTENSIONS) : temps imparti par tâche (minutes).
    temps_par_tache: Optional[int] = None


# ---------------------------------------------------------------------------
# Élèves & progression
# ---------------------------------------------------------------------------
class EleveJoinBody(BaseModel):
    """Body de POST /api/session/{session_id}/eleve/join."""
    nom_eleve: str
    code_acces: str


class TacheEleve(BaseModel):
    """Tâche telle que présentée à l'élève."""
    id: str
    titre: str
    consigne: str


class EleveJoinResponse(BaseModel):
    eleve_id: str
    taches: List[TacheEleve]


class TachePatchBody(BaseModel):
    """Body de PATCH /api/eleve/{eleve_id}/tache/{tache_id}."""
    statut: Literal["en_cours", "bloque", "complete"]


class OkResponse(BaseModel):
    ok: bool


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
class EleveDashboard(BaseModel):
    eleve_id: str
    nom: str
    taches_completes: int
    taches_total: int
    statut: Literal["actif", "bloque", "inactif"]
    # Champs additifs (EXTENSIONS) : désambiguïsation & suivi fin. Optionnels
    # pour rester rétro-compatibles avec le contrat figé.
    numero_poste: Optional[int] = None
    classe: Optional[str] = None
    label: Optional[str] = None
    etape_en_cours: Optional[str] = None


class DashboardResponse(BaseModel):
    eleves: List[EleveDashboard]


# ---------------------------------------------------------------------------
# Postes (EXTENSIONS) : plusieurs élèves par machine
# ---------------------------------------------------------------------------
class PosteJoinBody(BaseModel):
    """Body de POST /api/session/{session_id}/poste/join."""
    code_acces: str
    eleves: List[str]                 # 1 à 3 noms d'élèves
    numero: Optional[int] = None      # n° de poste (auto si absent)
    classe: Optional[str] = None


class EleveInscrit(BaseModel):
    eleve_id: str
    nom: str


class PosteJoinResponse(BaseModel):
    poste_id: str
    numero: int
    classe: Optional[str] = None
    eleves: List[EleveInscrit]
    taches: List[TacheEleve]
    duree_minutes: int
    temps_par_tache: int


class AssignationBody(BaseModel):
    """Body de PUT /api/poste/{poste_id}/assignation."""
    tache_id: str
    eleve_id: str


class AssignationItem(BaseModel):
    tache_id: str
    eleve_id: str


class EleveProgression(BaseModel):
    eleve_id: str
    nom: str
    progression: List["ProgressionItem"]


class PosteCompletResponse(BaseModel):
    poste_id: str
    session_id: str
    numero: int
    classe: Optional[str] = None
    taches: List[TacheEleve]
    eleves: List[EleveProgression]
    assignations: List[AssignationItem]
    duree_minutes: int
    temps_par_tache: int


# ---------------------------------------------------------------------------
# Ressources complémentaires (EXTENSIONS)
# ---------------------------------------------------------------------------
class RessourceResponse(BaseModel):
    ressource_id: str
    nom: str
    statut: str  # "indexe" si le texte a enrichi le contexte IA, "stocke" sinon


class RessourceItem(BaseModel):
    ressource_id: str
    nom: str
    created_at: str


class RessourcesListResponse(BaseModel):
    ressources: List[RessourceItem]


# ---------------------------------------------------------------------------
# Chat (périmètre Lot 2 — schémas conservés pour l'endpoint intégré /api/chat)
# ---------------------------------------------------------------------------
class ChatBody(BaseModel):
    """Body de POST /api/chat."""
    eleve_id: str
    session_id: str
    question: str


class ChatResponse(BaseModel):
    reponse: str
    timestamp: str  # ISO 8601


# ---------------------------------------------------------------------------
# Authentification enseignant
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    """Body de POST /api/teacher/login."""
    mot_de_passe: str


class TokenResponse(BaseModel):
    token: str


# ---------------------------------------------------------------------------
# Historique des séances (côté enseignant)
# ---------------------------------------------------------------------------
class SessionResume(BaseModel):
    session_id: str
    titre_tp: str
    code_acces: str
    nb_taches: int
    nb_eleves: int
    created_at: str


class SessionsListResponse(BaseModel):
    sessions: List[SessionResume]


# ---------------------------------------------------------------------------
# Édition des tâches (côté enseignant)
# ---------------------------------------------------------------------------
class TacheComplete(BaseModel):
    id: str
    titre: str
    consigne: str
    ordre: int


class TachesListResponse(BaseModel):
    taches: List[TacheComplete]


class TacheCreateBody(BaseModel):
    titre: str
    consigne: str = ""


class TacheUpdateBody(BaseModel):
    titre: Optional[str] = None
    consigne: Optional[str] = None


# ---------------------------------------------------------------------------
# Restauration de la session élève (après actualisation de la page)
# ---------------------------------------------------------------------------
class ProgressionItem(BaseModel):
    tache_id: str
    statut: str


class EleveCompletResponse(BaseModel):
    eleve_id: str
    nom: str
    session_id: str
    taches: List[TacheEleve]
    progression: List[ProgressionItem]
