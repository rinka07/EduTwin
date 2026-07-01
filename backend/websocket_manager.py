# -*- coding: utf-8 -*-
"""Gestionnaire des connexions WebSocket, groupées par `session_id`.

Chaque session possède un ensemble de connexions (enseignant + élèves). Le
serveur diffuse (`broadcast`) les évènements à toutes les connexions ouvertes
de la session concernée.
"""
import asyncio
from typing import Dict, Set

from fastapi import WebSocket


class WebSocketManager:
    """Gère les connexions WebSocket par session et la diffusion des messages."""

    def __init__(self) -> None:
        # session_id -> ensemble de WebSocket actifs
        self._connexions: Dict[str, Set[WebSocket]] = {}
        # verrou pour protéger la structure contre les accès concurrents
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        """Accepte et enregistre une nouvelle connexion pour la session."""
        await websocket.accept()
        async with self._lock:
            self._connexions.setdefault(session_id, set()).add(websocket)

    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        """Retire proprement une connexion (déconnexion ou erreur)."""
        async with self._lock:
            connexions = self._connexions.get(session_id)
            if connexions:
                connexions.discard(websocket)
                if not connexions:
                    # plus personne sur cette session : on nettoie
                    self._connexions.pop(session_id, None)

    async def broadcast(self, session_id: str, message: dict) -> None:
        """Diffuse `message` (dict JSON) à toutes les connexions de la session.

        Les connexions mortes sont retirées silencieusement.
        """
        async with self._lock:
            connexions = list(self._connexions.get(session_id, set()))

        mortes = []
        for ws in connexions:
            try:
                await ws.send_json(message)
            except Exception:
                # connexion invalide/fermée : à nettoyer
                mortes.append(ws)

        if mortes:
            async with self._lock:
                connexions = self._connexions.get(session_id)
                if connexions:
                    for ws in mortes:
                        connexions.discard(ws)
                    if not connexions:
                        self._connexions.pop(session_id, None)


# Instance unique partagée par toute l'application.
manager = WebSocketManager()


async def broadcast(session_id: str, message: dict) -> None:
    """Raccourci module-level pour diffuser via l'instance partagée."""
    await manager.broadcast(session_id, message)
