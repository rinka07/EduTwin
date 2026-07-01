# -*- coding: utf-8 -*-
"""Module IA d'EduTwin (Lot 2) — façade publique importée par le Lot 1.

Expose exactement l'interface figée du CONTRAT.md §3 :

    extraire_et_decouper(chemin_fichier: str, nb_taches: int) -> dict
    generer_reponse(question, taches, chunks, historique=None) -> str

Fonctionne hors-ligne, avec un LLM local via Ollama. En cas d'indisponibilité
d'Ollama, `generer_reponse` renvoie un message de repli clair (jamais
d'exception qui remonte).
"""
from __future__ import annotations

from . import prompts, rag
from .ollama_client import OllamaIndisponible, interroger_llm
from .tp_processor import extraire_et_decouper

__all__ = ["extraire_et_decouper", "generer_reponse"]


def _repli_sans_ollama(passages: list[str]) -> str:
    """Message de repli fourni quand le LLM local n'est pas joignable.

    On reste utile en présentant à l'élève les passages pertinents de sa fiche.
    """
    entete = (
        "Assistant IA indisponible (serveur Ollama non détecté sur le réseau). "
        "En attendant, voici les passages de ta fiche TP les plus liés à ta "
        "question. Relis-les attentivement pour avancer :"
    )
    if not passages:
        return (
            entete
            + "\n\n(Aucun passage pertinent trouvé dans la fiche TP.) "
            "Reformule ta question ou relis l'énoncé de la tâche concernée."
        )
    corps = "\n\n".join(f"- {p.strip()}" for p in passages)
    return f"{entete}\n\n{corps}"


def generer_reponse(
    question: str,
    taches: list[dict],
    chunks: list[str],
    historique: list[dict] | None = None,
) -> str:
    """Produit une réponse IA guidée, ancrée dans la fiche TP.

    Étapes : sélection des passages pertinents (RAG) -> construction du prompt
    -> appel au LLM local. Si Ollama est indisponible, renvoie un repli clair.

    Cette fonction NE LÈVE JAMAIS d'exception liée à Ollama : le Lot 1 peut
    l'appeler en toute sécurité.
    """
    question = (question or "").strip()
    if not question:
        return "Pose-moi une question précise sur ton TP et je te guiderai."

    # 1. Sélection des passages pertinents via le RAG maison.
    passages = rag.rechercher_passages(question, chunks, k=3)

    # 2. Construction des prompts (système + utilisateur).
    prompt_utilisateur = prompts.construire_prompt_utilisateur(
        question=question,
        passages=passages,
        taches=taches or [],
        historique=historique,
    )

    # 3. Appel au LLM local, avec repli en cas d'indisponibilité.
    try:
        return interroger_llm(prompt_utilisateur, systeme=prompts.PROMPT_SYSTEME)
    except OllamaIndisponible:
        return _repli_sans_ollama(passages)
    except Exception:
        # Filet de sécurité : aucune exception ne doit remonter au Lot 1.
        return _repli_sans_ollama(passages)
