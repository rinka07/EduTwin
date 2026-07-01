# -*- coding: utf-8 -*-
"""Authentification minimale de l'espace enseignant (usage LAN).

Principe simple et sans stockage : le jeton est dérivé du mot de passe
(sha256). Il reste donc valable tant que le mot de passe ne change pas, y
compris après un redémarrage du serveur — pratique pour un poste enseignant.
Les endpoints sensibles exigent l'en-tête HTTP `X-Edu-Token`.
"""
import hashlib

from fastapi import Header, HTTPException

from config import MOT_DE_PASSE_ENSEIGNANT


def _token_attendu() -> str:
    """Jeton attendu, dérivé du mot de passe enseignant courant."""
    graine = f"edutwin::{MOT_DE_PASSE_ENSEIGNANT}"
    return hashlib.sha256(graine.encode("utf-8")).hexdigest()


def creer_token(mot_de_passe: str) -> str | None:
    """Retourne un jeton si le mot de passe est correct, sinon None."""
    if mot_de_passe == MOT_DE_PASSE_ENSEIGNANT:
        return _token_attendu()
    return None


def exiger_enseignant(x_edu_token: str = Header(default=None)) -> None:
    """Dépendance FastAPI : refuse (401) si le jeton enseignant est absent/invalide."""
    if x_edu_token != _token_attendu():
        raise HTTPException(
            status_code=401,
            detail="authentification enseignant requise",
        )
