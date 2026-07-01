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
    nb_taches: int


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


class DashboardResponse(BaseModel):
    eleves: List[EleveDashboard]


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
