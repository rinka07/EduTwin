# -*- coding: utf-8 -*-
"""Construction des prompts (système + utilisateur) pour l'assistant de TP.

Le prompt système fixe le rôle pédagogique : guider sans jamais donner la
solution. Le prompt utilisateur assemble le contexte (passages RAG + titres
de tâches + historique) autour de la question de l'élève.
"""
from __future__ import annotations

# --- Prompt système : comportement immuable de l'assistant ---------------
PROMPT_SYSTEME = (
    "Tu es EduTwin, un assistant pédagogique pour des travaux pratiques (TP) "
    "d'informatique. Ton rôle est d'AIDER l'élève à trouver la solution PAR "
    "LUI-MÊME, jamais de la lui donner.\n"
    "\n"
    "Règles impératives :\n"
    "1. Réponds TOUJOURS en français, de façon claire et bienveillante.\n"
    "2. NE DONNE JAMAIS la solution complète ni le code complet demandé. "
    "Interdiction d'écrire la fonction ou le programme final attendu par le TP.\n"
    "3. Guide par INDICES PROGRESSIFS : pose des questions socratiques, "
    "reformule le problème, suggère une piste, une notion à réviser, une "
    "prochaine petite étape. Au maximum, montre un mini-exemple GÉNÉRIQUE "
    "(sans rapport direct avec l'exercice) pour illustrer un concept.\n"
    "4. Appuie-toi STRICTEMENT sur le contexte fourni (extraits de la fiche "
    "TP). N'invente pas de consignes absentes du contexte.\n"
    "5. Si la question est hors sujet par rapport au TP, recentre poliment "
    "l'élève sur son travail pratique.\n"
    "6. Sois concis : quelques phrases suffisent. Termine si possible par une "
    "question qui fait réfléchir l'élève."
)


def _formater_taches(taches: list[dict]) -> str:
    """Met en forme la liste des titres de tâches pour le contexte."""
    if not taches:
        return "(aucune tâche fournie)"
    lignes = []
    for i, tache in enumerate(taches, start=1):
        titre = (tache.get("titre") or f"Tâche {i}").strip()
        lignes.append(f"- {titre}")
    return "\n".join(lignes)


def _formater_passages(passages: list[str]) -> str:
    """Met en forme les passages RAG pertinents."""
    if not passages:
        return "(aucun passage pertinent trouvé)"
    lignes = []
    for i, passage in enumerate(passages, start=1):
        extrait = passage.strip()
        lignes.append(f"[Extrait {i}]\n{extrait}")
    return "\n\n".join(lignes)


def _formater_historique(historique: list[dict] | None) -> str:
    """Met en forme les derniers échanges pour donner du contexte au modèle."""
    if not historique:
        return ""
    lignes = ["\nHistorique récent de la conversation :"]
    # On ne garde que les derniers échanges pour ne pas gonfler le prompt.
    for echange in historique[-4:]:
        q = (echange.get("question") or "").strip()
        r = (echange.get("reponse") or "").strip()
        if q:
            lignes.append(f"Élève : {q}")
        if r:
            lignes.append(f"Assistant : {r}")
    return "\n".join(lignes)


def construire_prompt_utilisateur(
    question: str,
    passages: list[str],
    taches: list[dict],
    historique: list[dict] | None = None,
) -> str:
    """Assemble le prompt utilisateur complet envoyé au LLM.

    Structure : contexte (tâches + extraits fiche) -> historique -> question.
    """
    bloc_taches = _formater_taches(taches)
    bloc_passages = _formater_passages(passages)
    bloc_historique = _formater_historique(historique)

    prompt = (
        "Voici le contexte du TP sur lequel travaille l'élève.\n"
        "\n"
        "=== Tâches du TP ===\n"
        f"{bloc_taches}\n"
        "\n"
        "=== Extraits pertinents de la fiche TP ===\n"
        f"{bloc_passages}\n"
    )
    if bloc_historique:
        prompt += f"\n=== {bloc_historique}\n"

    prompt += (
        "\n=== Question de l'élève ===\n"
        f"{question.strip()}\n"
        "\n"
        "Réponds en respectant strictement tes règles : GUIDE l'élève avec des "
        "indices progressifs, NE DONNE PAS la solution ni le code final."
    )
    return prompt
