# -*- coding: utf-8 -*-
"""RAG léger en PUR Python : recherche des passages pertinents par mots-clés.

Aucune dépendance externe (pas d'embeddings lourds). On tokenise simplement,
on met en minuscules, on retire les accents et la ponctuation, puis on score
chaque chunk par recouvrement de mots avec pondération TF-IDF « maison ».
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter

# Mots vides français/anglais courants, ignorés lors du scoring car peu
# discriminants (ils apparaissent partout).
MOTS_VIDES: frozenset[str] = frozenset(
    """
    a au aux avec ce ces dans de des du elle en et eux il je la le les leur
    lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu
    que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous c d
    j l m n s t y est sont etre ete cette cet aux si plus tres comme donc or
    ni car the a an and or of to in is are be on for with as at by it this
    that
    """.split()
)


def _sans_accents(texte: str) -> str:
    """Retire les accents d'une chaîne (é -> e, ç -> c, ...)."""
    normalise = unicodedata.normalize("NFD", texte)
    return "".join(c for c in normalise if unicodedata.category(c) != "Mn")


def tokeniser(texte: str) -> list[str]:
    """Découpe un texte en tokens normalisés (minuscules, sans accents).

    On garde les mots alphanumériques de 2 caractères ou plus et on retire
    les mots vides.
    """
    texte = _sans_accents(texte.lower())
    # \w inclut lettres, chiffres et underscore ; on isole les blocs.
    bruts = re.findall(r"[a-z0-9]+", texte)
    return [m for m in bruts if len(m) >= 2 and m not in MOTS_VIDES]


def _idf(chunks_tokens: list[list[str]]) -> dict[str, float]:
    """Calcule l'IDF (inverse document frequency) de chaque terme du corpus.

    Un terme rare (présent dans peu de chunks) obtient un poids plus élevé.
    """
    nb_docs = len(chunks_tokens)
    freq_doc: Counter[str] = Counter()
    for tokens in chunks_tokens:
        for terme in set(tokens):
            freq_doc[terme] += 1
    # Formule IDF lissée : log((N + 1) / (df + 1)) + 1 (toujours > 0).
    return {
        terme: math.log((nb_docs + 1) / (df + 1)) + 1.0
        for terme, df in freq_doc.items()
    }


def rechercher_passages(question: str, chunks: list[str], k: int = 3) -> list[str]:
    """Retourne les `k` passages les plus pertinents pour la `question`.

    Paramètres
    ----------
    question : str
        La question de l'élève.
    chunks : list[str]
        Les passages texte de la fiche TP.
    k : int
        Nombre maximum de passages à retourner (défaut 3).

    Retour
    ------
    list[str]
        Les passages triés du plus au moins pertinent. Si aucun mot commun,
        on renvoie tout de même les `k` premiers chunks (repli) pour ne jamais
        laisser le LLM sans contexte.
    """
    if not chunks:
        return []
    if k <= 0:
        return []

    tokens_question = tokeniser(question)
    chunks_tokens = [tokeniser(c) for c in chunks]

    # Sans mot exploitable dans la question : repli sur les premiers chunks.
    if not tokens_question:
        return chunks[:k]

    idf = _idf(chunks_tokens)
    termes_q = set(tokens_question)

    scores: list[tuple[float, int]] = []
    for idx, tokens in enumerate(chunks_tokens):
        if not tokens:
            scores.append((0.0, idx))
            continue
        tf = Counter(tokens)
        # Score = somme des poids TF-IDF des termes de la question présents
        # dans le chunk, normalisée par la longueur (racine) du chunk pour ne
        # pas favoriser mécaniquement les longs passages.
        score = 0.0
        for terme in termes_q:
            if terme in tf:
                score += tf[terme] * idf.get(terme, 1.0)
        score /= math.sqrt(len(tokens))
        scores.append((score, idx))

    # Tri décroissant par score ; l'ordre d'origine départage (idx croissant).
    scores.sort(key=lambda t: (-t[0], t[1]))

    # Si tous les scores sont nuls (aucun recouvrement), repli sur les premiers.
    if all(s <= 0.0 for s, _ in scores):
        return chunks[:k]

    resultats = [chunks[idx] for score, idx in scores[:k] if score > 0.0]
    # Complète avec les premiers chunks si moins de k passages pertinents.
    if len(resultats) < k:
        for c in chunks:
            if c not in resultats:
                resultats.append(c)
            if len(resultats) >= k:
                break
    return resultats[:k]
