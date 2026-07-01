# -*- coding: utf-8 -*-
"""Client HTTP minimal pour interroger un LLM local via Ollama.

Le serveur Ollama expose une API sur http://localhost:11434/api/generate.
Le modèle par défaut est "mistral", surchargeable via la variable
d'environnement EDUTWIN_MODEL.

Ce module N'A PAS de dépendance à FastAPI ni au reste du backend : il ne
dépend que de la lib `requests` (déjà dans requirements.txt).
"""
from __future__ import annotations

import os

import requests

# URL de l'API de génération d'Ollama (LAN / localhost, hors-ligne).
OLLAMA_URL = os.environ.get(
    "EDUTWIN_OLLAMA_URL", "http://localhost:11434/api/generate"
)
# Modèle par défaut, surchargeable via la variable d'environnement EDUTWIN_MODEL.
MODELE_DEFAUT = os.environ.get("EDUTWIN_MODEL", "mistral")

# Délai maximal d'attente d'une réponse du LLM (en secondes).
# Un LLM local peut être lent au premier appel (chargement du modèle en RAM).
TIMEOUT_SECONDES = 120


class OllamaIndisponible(Exception):
    """Levée quand le serveur Ollama est injoignable ou renvoie une erreur.

    Cette exception est destinée à être rattrapée par la couche supérieure
    (generer_reponse) afin de fournir un message de repli à l'utilisateur.
    """


def interroger_llm(prompt: str, systeme: str | None = None) -> str:
    """Envoie un prompt au LLM local et retourne le texte généré.

    Paramètres
    ----------
    prompt : str
        Le prompt utilisateur (question + contexte de la fiche TP).
    systeme : str | None
        Le prompt système (rôle / consignes de comportement du modèle).

    Retour
    ------
    str
        La réponse textuelle du modèle (nettoyée des espaces superflus).

    Exceptions
    ----------
    OllamaIndisponible
        Si le serveur est injoignable, en timeout, ou répond en erreur.
    """
    # Corps de la requête pour l'API /api/generate d'Ollama.
    # stream=False => on récupère la réponse complète en un seul objet JSON.
    charge_utile: dict = {
        "model": MODELE_DEFAUT,
        "prompt": prompt,
        "stream": False,
    }
    if systeme:
        charge_utile["system"] = systeme

    try:
        reponse = requests.post(
            OLLAMA_URL, json=charge_utile, timeout=TIMEOUT_SECONDES
        )
    except (requests.ConnectionError, requests.Timeout) as exc:
        # Serveur non lancé, port fermé, ou trop lent : repli côté appelant.
        raise OllamaIndisponible(
            f"Serveur Ollama injoignable sur {OLLAMA_URL} : {exc}"
        ) from exc
    except requests.RequestException as exc:
        # Toute autre erreur réseau imprévue.
        raise OllamaIndisponible(f"Erreur réseau Ollama : {exc}") from exc

    # Un code HTTP != 200 signifie généralement un modèle absent (à `pull`)
    # ou une requête invalide.
    if reponse.status_code != 200:
        raise OllamaIndisponible(
            f"Ollama a répondu HTTP {reponse.status_code} : {reponse.text[:200]}"
        )

    try:
        donnees = reponse.json()
    except ValueError as exc:
        raise OllamaIndisponible(
            f"Réponse Ollama illisible (JSON invalide) : {exc}"
        ) from exc

    # Le champ "response" contient le texte généré par le modèle.
    texte = (donnees.get("response") or "").strip()
    if not texte:
        raise OllamaIndisponible("Ollama a renvoyé une réponse vide.")
    return texte
