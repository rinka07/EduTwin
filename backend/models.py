# -*- coding: utf-8 -*-
"""Modèles Pydantic des corps de requête et de réponse (contrat §1).

Les noms de champs respectent EXACTEMENT le CONTRAT.md et ne doivent pas changer.
"""
from typing import List, Literal
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
class SessionCreateBody(BaseModel):
    """Body de POST /api/session/create."""
    titre_tp: str
    duree_minutes: int
    nb_taches: int


class SessionCreateResponse(BaseModel):
    session_id: str
    code_acces: str


class DocumentResponse(BaseModel):
    document_id: str
    statut: str  # toujours "indexe"


# ---------------------------------------------------------------------------
# Élèves
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


class DashboardResponse(BaseModel):
    eleves: List[EleveDashboard]


# ---------------------------------------------------------------------------
# Chat
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
# Infos session (endpoint utilitaire)
# ---------------------------------------------------------------------------
class SessionInfoResponse(BaseModel):
    session_id: str
    titre_tp: str
    duree_minutes: int
    nb_taches: int
    code_acces: str
    document_id: str | None = None
    created_at: str
