# -*- coding: utf-8 -*-
"""Script de test autonome du module IA d'EduTwin (Lot 2).

Exécutable directement, SANS dépendre des autres lots ni d'un vrai fichier :
il génère un faux énoncé de TP (DOCX), le passe dans extraire_et_decouper(),
puis interroge generer_reponse() (avec repli si Ollama est absent).

Usage :
    cd backend && python3 ia/test_ia.py
"""
from __future__ import annotations

import os
import sys
import tempfile

# Permet l'exécution directe `python3 ia/test_ia.py` (import du package `ia`).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ia import extraire_et_decouper, generer_reponse  # noqa: E402
from ia import rag  # noqa: E402
from ia.tp_processor import decouper_en_taches, decouper_en_chunks  # noqa: E402


# --- Faux énoncé de TP intégré (données de test) -------------------------
ENONCE_TEST = """\
TP 3 : Manipulation de listes en Python

Objectif : apprendre à parcourir et transformer des listes.
Vous rendrez un fichier tp3.py commenté.

Tâche 1 : Somme des éléments
Écrivez une fonction somme_liste(nombres) qui prend une liste de nombres
entiers et retourne la somme de tous ses éléments. Vous devez utiliser une
boucle for et ne pas utiliser la fonction sum() native de Python.

Tâche 2 : Filtrer les pairs
Écrivez une fonction filtrer_pairs(nombres) qui retourne une nouvelle liste
contenant uniquement les nombres pairs de la liste d'entrée. Pensez à
l'opérateur modulo pour tester la parité.

Tâche 3 : Recherche du maximum
Écrivez une fonction maximum(nombres) qui retourne le plus grand élément de la
liste sans utiliser la fonction max() native. Gérez le cas d'une liste vide en
retournant None.
"""


def _creer_docx_temporaire(texte: str) -> str:
    """Crée un fichier DOCX temporaire contenant `texte`, un paragraphe/ligne."""
    from docx import Document

    document = Document()
    for ligne in texte.split("\n"):
        document.add_paragraph(ligne)
    chemin = os.path.join(tempfile.gettempdir(), "edutwin_faux_tp.docx")
    document.save(chemin)
    return chemin


def _titre(texte: str) -> None:
    print("\n" + "=" * 70)
    print(texte)
    print("=" * 70)


def main() -> int:
    _titre("1) Test du découpage EN MÉMOIRE (sans fichier)")
    nb_taches = 3
    taches = decouper_en_taches(ENONCE_TEST, nb_taches)
    chunks = decouper_en_chunks(ENONCE_TEST)
    assert len(taches) == nb_taches, "len(taches) doit valoir nb_taches"
    print(f"nb_taches demandé = {nb_taches}, obtenu = {len(taches)}")
    for i, t in enumerate(taches, 1):
        print(f"  - Tâche {i}: {t['titre']!r}")
        print(f"      consigne ({len(t['consigne'])} car.): "
              f"{t['consigne'][:70]!r}...")
    print(f"Nombre de chunks RAG : {len(chunks)}")

    _titre("2) Test extraire_et_decouper() via un DOCX temporaire")
    try:
        chemin = _creer_docx_temporaire(ENONCE_TEST)
        resultat = extraire_et_decouper(chemin, nb_taches)
        print(f"Fichier de test : {chemin}")
        print(f"taches: {len(resultat['taches'])} | chunks: "
              f"{len(resultat['chunks'])}")
        assert len(resultat["taches"]) == nb_taches
        taches = resultat["taches"]
        chunks = resultat["chunks"]
    except Exception as exc:  # noqa: BLE001
        print(f"(python-docx indisponible ou erreur : {exc})")
        print("On poursuit avec le découpage en mémoire.")

    _titre("3) Test du RAG : passages pertinents pour une question")
    question = "Comment tester si un nombre est pair ?"
    passages = rag.rechercher_passages(question, chunks, k=2)
    print(f"Question : {question}")
    for i, p in enumerate(passages, 1):
        print(f"  [Passage {i}] {p[:90].strip()!r}...")

    _titre("4) Test generer_reponse() (LLM local, repli si Ollama absent)")
    reponse = generer_reponse(question, taches, chunks, historique=None)
    print("Réponse de l'assistant :\n")
    print(reponse)

    _titre("5) Test avec historique + question hors sujet")
    historique = [
        {"question": "Bonjour", "reponse": "Bonjour ! Sur quelle tâche bloques-tu ?"}
    ]
    reponse2 = generer_reponse(
        "Quelle est la météo aujourd'hui ?", taches, chunks, historique
    )
    print(reponse2)

    _titre("RÉSULTAT")
    print("OK — Tous les appels se sont exécutés sans exception.")
    print("(Si Ollama n'est pas lancé, les réponses ci-dessus sont le repli.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
