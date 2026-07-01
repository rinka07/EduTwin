# -*- coding: utf-8 -*-
"""Accès à la base SQLite (module standard `sqlite3`, sans ORM).

Ce module contient :
- l'initialisation du schéma (CONTRAT §4),
- un helper de connexion `get_conn()`,
- les fonctions d'accès métier utilisées par les routes.

Toutes les fonctions ouvrent/ferment leur propre connexion pour rester simples
et sûres vis-à-vis du multi-thread d'uvicorn.
"""
import sqlite3
import uuid
import random
import string
from datetime import datetime, timezone
from typing import Optional

import models
from config import DB_PATH, INACTIF_APRES_SECONDES, CODE_ACCES_LONGUEUR


# ---------------------------------------------------------------------------
# Helpers généraux
# ---------------------------------------------------------------------------
def get_conn() -> sqlite3.Connection:
    """Retourne une connexion SQLite configurée (lignes accessibles par nom)."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row          # accès aux colonnes par nom
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _now_iso() -> str:
    """Horodatage ISO 8601 en UTC (secondes)."""
    return datetime.now(timezone.utc).isoformat()


def _uuid_court() -> str:
    """Identifiant court et lisible (8 caractères hexadécimaux)."""
    return uuid.uuid4().hex[:8]


# Alphabet du code d'accès : chiffres + lettres majuscules SANS ambiguïté
# (on retire O/0, I/1 pour la lisibilité au tableau).
_ALPHABET_CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _generer_code_acces() -> str:
    """Génère un code d'accès lisible de `CODE_ACCES_LONGUEUR` caractères."""
    return "".join(random.choice(_ALPHABET_CODE) for _ in range(CODE_ACCES_LONGUEUR))


# ---------------------------------------------------------------------------
# Initialisation du schéma (CONTRAT §4)
# ---------------------------------------------------------------------------
def init_db() -> None:
    """Crée les tables si elles n'existent pas encore (schéma dans models.py)."""
    conn = get_conn()
    try:
        conn.executescript(models.SCHEMA)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
def create_session(titre_tp: str, duree_minutes: int, nb_taches: int) -> dict:
    """Crée une session et renvoie {session_id, code_acces}."""
    session_id = _uuid_court()
    code_acces = _generer_code_acces()
    conn = get_conn()
    try:
        # On garantit l'unicité du code d'accès parmi les sessions existantes.
        while conn.execute(
            "SELECT 1 FROM sessions WHERE code_acces = ?", (code_acces,)
        ).fetchone():
            code_acces = _generer_code_acces()

        conn.execute(
            "INSERT INTO sessions "
            "(session_id, titre_tp, duree_minutes, nb_taches, code_acces, document_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (session_id, titre_tp, duree_minutes, nb_taches, code_acces, None, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return {"session_id": session_id, "code_acces": code_acces}


def get_session(session_id: str) -> Optional[dict]:
    """Retourne la session sous forme de dict, ou None si introuvable."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def set_document(session_id: str, document_id: str) -> None:
    """Associe l'identifiant de document à la session."""
    conn = get_conn()
    try:
        conn.execute(
            "UPDATE sessions SET document_id = ? WHERE session_id = ?",
            (document_id, session_id),
        )
        conn.commit()
    finally:
        conn.close()


def add_document(session_id: str, chemin_fichier: str, statut: str = "indexe") -> str:
    """Enregistre une fiche TP brute stockée sur disque et renvoie son document_id.

    Lot 1 : on stocke seulement le fichier + une entrée en base (table documents).
    L'extraction / l'indexation du contenu relève du Lot 2.
    Met aussi à jour `sessions.document_id` (dernier document importé).
    """
    document_id = _uuid_court()
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO documents "
            "(document_id, session_id, chemin_fichier, statut, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (document_id, session_id, chemin_fichier, statut, _now_iso()),
        )
        conn.execute(
            "UPDATE sessions SET document_id = ? WHERE session_id = ?",
            (document_id, session_id),
        )
        conn.commit()
    finally:
        conn.close()
    return document_id


# ---------------------------------------------------------------------------
# Tâches & chunks (remplissage après indexation du document)
# ---------------------------------------------------------------------------
def add_taches(session_id: str, taches: list[dict]) -> list[dict]:
    """Insère les tâches d'une session (avec id uuid + ordre).

    `taches` : liste de {"titre", "consigne"}.
    Remplace toute tâche précédente de la session (ré-import possible).
    Retourne la liste des tâches insérées avec leur id.
    """
    conn = get_conn()
    inserees: list[dict] = []
    try:
        conn.execute("DELETE FROM taches WHERE session_id = ?", (session_id,))
        for ordre, t in enumerate(taches):
            tache_id = _uuid_court()
            titre = t.get("titre", f"Tâche {ordre + 1}")
            consigne = t.get("consigne", "")
            conn.execute(
                "INSERT INTO taches (id, session_id, ordre, titre, consigne) "
                "VALUES (?, ?, ?, ?, ?)",
                (tache_id, session_id, ordre, titre, consigne),
            )
            inserees.append({"id": tache_id, "titre": titre, "consigne": consigne})
        # nb_taches reflète le nombre réel de tâches indexées.
        conn.execute(
            "UPDATE sessions SET nb_taches = ? WHERE session_id = ?",
            (len(inserees), session_id),
        )
        conn.commit()
    finally:
        conn.close()
    return inserees


def get_taches_full(session_id: str) -> list[dict]:
    """Retourne les tâches d'une session avec leur ordre : [{id,titre,consigne,ordre}]."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT id, titre, consigne, ordre FROM taches "
            "WHERE session_id = ? ORDER BY ordre ASC",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _recompter_nb_taches(conn: sqlite3.Connection, session_id: str) -> None:
    """Recale sessions.nb_taches sur le nombre réel de tâches (helper interne)."""
    n = conn.execute(
        "SELECT COUNT(*) AS n FROM taches WHERE session_id = ?", (session_id,)
    ).fetchone()["n"]
    conn.execute("UPDATE sessions SET nb_taches = ? WHERE session_id = ?", (n, session_id))


def add_single_tache(session_id: str, titre: str, consigne: str = "") -> dict:
    """Ajoute une tâche en fin de liste et renvoie {id,titre,consigne,ordre}."""
    tache_id = _uuid_court()
    conn = get_conn()
    try:
        ordre_row = conn.execute(
            "SELECT COALESCE(MAX(ordre), -1) + 1 AS o FROM taches WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        ordre = ordre_row["o"]
        conn.execute(
            "INSERT INTO taches (id, session_id, ordre, titre, consigne) "
            "VALUES (?, ?, ?, ?, ?)",
            (tache_id, session_id, ordre, titre, consigne),
        )
        _recompter_nb_taches(conn, session_id)
        conn.commit()
    finally:
        conn.close()
    return {"id": tache_id, "titre": titre, "consigne": consigne, "ordre": ordre}


def update_tache(session_id: str, tache_id: str,
                 titre: Optional[str], consigne: Optional[str]) -> bool:
    """Modifie le titre et/ou la consigne d'une tâche. Retourne False si introuvable."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT titre, consigne FROM taches WHERE id = ? AND session_id = ?",
            (tache_id, session_id),
        ).fetchone()
        if not row:
            return False
        nouveau_titre = titre if titre is not None else row["titre"]
        nouvelle_consigne = consigne if consigne is not None else row["consigne"]
        conn.execute(
            "UPDATE taches SET titre = ?, consigne = ? WHERE id = ? AND session_id = ?",
            (nouveau_titre, nouvelle_consigne, tache_id, session_id),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def delete_tache(session_id: str, tache_id: str) -> bool:
    """Supprime une tâche + la progression associée. Retourne False si introuvable."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT 1 FROM taches WHERE id = ? AND session_id = ?",
            (tache_id, session_id),
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM taches WHERE id = ? AND session_id = ?",
                     (tache_id, session_id))
        conn.execute("DELETE FROM eleve_taches WHERE tache_id = ?", (tache_id,))
        _recompter_nb_taches(conn, session_id)
        conn.commit()
        return True
    finally:
        conn.close()


def list_sessions() -> list[dict]:
    """Retourne l'historique des séances (récentes d'abord) avec le nb d'élèves."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT s.session_id, s.titre_tp, s.code_acces, s.nb_taches, s.created_at, "
            "  (SELECT COUNT(*) FROM eleves e WHERE e.session_id = s.session_id) AS nb_eleves "
            "FROM sessions s ORDER BY s.created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_eleve_complet(eleve_id: str) -> Optional[dict]:
    """Retourne l'élève avec ses tâches et sa progression (pour la restauration).

    Format : {eleve_id, nom, session_id, taches:[{id,titre,consigne}],
              progression:[{tache_id,statut}]} ou None si introuvable.
    """
    eleve = get_eleve(eleve_id)
    if not eleve:
        return None
    taches = get_taches(eleve["session_id"])
    conn = get_conn()
    try:
        prog = conn.execute(
            "SELECT tache_id, statut FROM eleve_taches WHERE eleve_id = ?",
            (eleve_id,),
        ).fetchall()
    finally:
        conn.close()
    return {
        "eleve_id": eleve_id,
        "nom": eleve["nom"],
        "session_id": eleve["session_id"],
        "taches": taches,
        "progression": [dict(r) for r in prog],
    }


def add_chunks(session_id: str, chunks: list[str]) -> None:
    """Insère les chunks RAG d'une session (remplace les précédents)."""
    conn = get_conn()
    try:
        conn.execute("DELETE FROM chunks WHERE session_id = ?", (session_id,))
        for ordre, contenu in enumerate(chunks):
            conn.execute(
                "INSERT INTO chunks (session_id, ordre, contenu) VALUES (?, ?, ?)",
                (session_id, ordre, contenu),
            )
        conn.commit()
    finally:
        conn.close()


def get_taches(session_id: str) -> list[dict]:
    """Retourne les tâches d'une session, triées par ordre.

    Chaque élément : {"id", "titre", "consigne"}.
    """
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT id, titre, consigne FROM taches "
            "WHERE session_id = ? ORDER BY ordre ASC",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_chunks_and_taches(session_id: str) -> dict:
    """Retourne {"taches": [{"titre","consigne"},...], "chunks": [str,...]}.

    Format directement consommable par `generer_reponse` du module IA.
    """
    conn = get_conn()
    try:
        t_rows = conn.execute(
            "SELECT titre, consigne FROM taches WHERE session_id = ? ORDER BY ordre ASC",
            (session_id,),
        ).fetchall()
        c_rows = conn.execute(
            "SELECT contenu FROM chunks WHERE session_id = ? ORDER BY ordre ASC",
            (session_id,),
        ).fetchall()
        return {
            "taches": [dict(r) for r in t_rows],
            "chunks": [r["contenu"] for r in c_rows],
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Élèves & progression
# ---------------------------------------------------------------------------
def join_eleve(session_id: str, nom_eleve: str) -> dict:
    """Inscrit un élève à la session et initialise sa progression.

    Les tâches n'ont PAS de statut par défaut (absence = non complétée).
    Retourne {"eleve_id", "taches": [{"id","titre","consigne"}, ...]}.
    """
    eleve_id = _uuid_court()
    now = _now_iso()
    taches = get_taches(session_id)
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO eleves (eleve_id, session_id, nom, statut, joined_at, last_seen) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (eleve_id, session_id, nom_eleve, "actif", now, now),
        )
        conn.commit()
    finally:
        conn.close()
    return {"eleve_id": eleve_id, "taches": taches}


def get_eleve(eleve_id: str) -> Optional[dict]:
    """Retourne l'élève (dict) ou None."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM eleves WHERE eleve_id = ?", (eleve_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def touch_eleve(eleve_id: str) -> None:
    """Met à jour le `last_seen` de l'élève (activité récente)."""
    conn = get_conn()
    try:
        conn.execute(
            "UPDATE eleves SET last_seen = ? WHERE eleve_id = ?",
            (_now_iso(), eleve_id),
        )
        conn.commit()
    finally:
        conn.close()


def patch_tache(eleve_id: str, tache_id: str, statut: str) -> None:
    """Met à jour (ou insère) le statut d'une tâche pour un élève.

    Rafraîchit aussi le `last_seen` de l'élève (c'est une activité).
    """
    now = _now_iso()
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO eleve_taches (eleve_id, tache_id, statut, date_maj) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(eleve_id, tache_id) DO UPDATE SET "
            "statut = excluded.statut, date_maj = excluded.date_maj",
            (eleve_id, tache_id, statut, now),
        )
        conn.execute(
            "UPDATE eleves SET last_seen = ? WHERE eleve_id = ?",
            (now, eleve_id),
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------
def save_chat(session_id: str, eleve_id: str, question: str,
              reponse: str, timestamp: str) -> None:
    """Enregistre un échange de chat dans l'historique."""
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO chat_historique "
            "(session_id, eleve_id, question, reponse, timestamp) "
            "VALUES (?, ?, ?, ?, ?)",
            (session_id, eleve_id, question, reponse, timestamp),
        )
        conn.commit()
    finally:
        conn.close()


def get_historique(session_id: str, eleve_id: str, limite: int = 10) -> list[dict]:
    """Retourne l'historique récent d'un élève : [{"question","reponse"}, ...]."""
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT question, reponse FROM chat_historique "
            "WHERE session_id = ? AND eleve_id = ? ORDER BY id ASC",
            (session_id, eleve_id),
        ).fetchall()
        historique = [dict(r) for r in rows]
        return historique[-limite:] if limite else historique
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Dashboard (CONTRAT §1 & §4)
# ---------------------------------------------------------------------------
def _statut_eleve(statut_row: dict, taches_bloquees: int, last_seen: str) -> str:
    """Dérive le statut d'affichage d'un élève.

    Règles (CONTRAT §4) :
    - "bloque"  : au moins une tâche en statut "bloque" ;
    - "inactif" : sinon, si `last_seen` remonte à > 3 min ;
    - "actif"   : sinon.
    """
    if taches_bloquees > 0:
        return "bloque"
    try:
        vu = datetime.fromisoformat(last_seen)
        if vu.tzinfo is None:
            vu = vu.replace(tzinfo=timezone.utc)
        ecart = (datetime.now(timezone.utc) - vu).total_seconds()
        if ecart > INACTIF_APRES_SECONDES:
            return "inactif"
    except (ValueError, TypeError):
        # last_seen absent/illisible : on considère l'élève inactif par prudence.
        return "inactif"
    return "actif"


def build_dashboard(session_id: str) -> dict:
    """Construit le snapshot du dashboard pour une session.

    Retour : {"eleves": [ {eleve_id, nom, taches_completes, taches_total, statut}, ... ]}.
    """
    session = get_session(session_id)
    taches_total = session["nb_taches"] if session else 0

    conn = get_conn()
    try:
        eleves = conn.execute(
            "SELECT eleve_id, nom, last_seen FROM eleves "
            "WHERE session_id = ? ORDER BY joined_at ASC",
            (session_id,),
        ).fetchall()

        resultat = []
        for e in eleves:
            eleve_id = e["eleve_id"]
            completes = conn.execute(
                "SELECT COUNT(*) AS n FROM eleve_taches "
                "WHERE eleve_id = ? AND statut = 'complete'",
                (eleve_id,),
            ).fetchone()["n"]
            bloquees = conn.execute(
                "SELECT COUNT(*) AS n FROM eleve_taches "
                "WHERE eleve_id = ? AND statut = 'bloque'",
                (eleve_id,),
            ).fetchone()["n"]

            resultat.append({
                "eleve_id": eleve_id,
                "nom": e["nom"],
                "taches_completes": completes,
                "taches_total": taches_total,
                "statut": _statut_eleve(dict(e), bloquees, e["last_seen"]),
            })
        return {"eleves": resultat}
    finally:
        conn.close()
