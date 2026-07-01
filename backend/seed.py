# -*- coding: utf-8 -*-
"""Génère des données de démonstration réalistes pour EduTwin.

Crée UNE session de TP avec un code d'accès FIXE (pratique pour la démo et pour
les autres lots), QUATRE tâches et CINQ élèves avec une progression variée
(actif / bloqué / inactif). Idempotent : relancer le script réinitialise la
session de démo.

Utilisation :  (depuis le dossier backend/)
    python seed.py
"""
import sqlite3
from datetime import datetime, timezone, timedelta

import database as db

# Session de démo à identifiants fixes (faciles à retenir / partager).
SESSION_ID = "demo0001"
CODE_ACCES = "DEMO24"
TITRE_TP = "TP1 - Introduction au langage C"
DUREE_MINUTES = 90

# Quatre tâches de démonstration.
TACHES = [
    {"titre": "Tâche 1 : Premier programme",
     "consigne": "Écrire un programme C qui affiche « Bonjour le monde » avec printf, "
                 "puis le compiler avec gcc et l'exécuter."},
    {"titre": "Tâche 2 : Variables et saisie",
     "consigne": "Déclarer deux entiers, lire leurs valeurs avec scanf et afficher leur somme."},
    {"titre": "Tâche 3 : Conditions",
     "consigne": "Demander un entier et indiquer avec if/else s'il est pair ou impair."},
    {"titre": "Tâche 4 : Boucles",
     "consigne": "Afficher la table de multiplication d'un nombre saisi, à l'aide d'une boucle for."},
]

# Cinq élèves + un scénario de progression pour illustrer le dashboard.
# statuts possibles par tâche : "en_cours" | "bloque" | "complete"
ELEVES = [
    ("Amina Nkolo",   ["complete", "complete", "en_cours"]),   # bien avancée, active
    ("Boris Mballa",  ["complete", "bloque"]),                 # bloquée -> statut "bloque"
    ("Chloé Fotso",   ["complete", "complete", "complete", "complete"]),  # a tout fini
    ("David Onana",   ["en_cours"]),                           # démarre
    ("Estelle Kamga", []),                                     # inscrite, rien fait
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _reset_session() -> None:
    """Supprime toute trace de la session de démo pour repartir propre."""
    conn = db.get_conn()
    try:
        for table, col in [
            ("sessions", "session_id"), ("taches", "session_id"),
            ("eleves", "session_id"), ("documents", "session_id"),
            ("chunks", "session_id"), ("chat_historique", "session_id"),
        ]:
            conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (SESSION_ID,))
        # Progression : supprimer les lignes des élèves de cette session.
        conn.execute(
            "DELETE FROM eleve_taches WHERE eleve_id IN "
            "(SELECT eleve_id FROM eleves WHERE session_id = ?)",
            (SESSION_ID,),
        )
        conn.commit()
    finally:
        conn.close()


def seed() -> None:
    db.init_db()
    _reset_session()

    # 1) Session (insertion directe pour fixer session_id + code_acces).
    conn = db.get_conn()
    try:
        conn.execute(
            "INSERT INTO sessions "
            "(session_id, titre_tp, duree_minutes, nb_taches, code_acces, document_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (SESSION_ID, TITRE_TP, DUREE_MINUTES, len(TACHES), CODE_ACCES, None, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()

    # 2) Tâches.
    taches = db.add_taches(SESSION_ID, TACHES)  # renvoie [{id, titre, consigne}, ...]

    # 3) Élèves + progression.
    for nom, statuts in ELEVES:
        res = db.join_eleve(SESSION_ID, nom)
        eleve_id = res["eleve_id"]
        for i, statut in enumerate(statuts):
            if i < len(taches):
                db.patch_tache(eleve_id, taches[i]["id"], statut)

    # 4) Simuler l'inactivité d'Estelle (dernier passage il y a 10 min).
    conn = db.get_conn()
    try:
        vieux = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        conn.execute(
            "UPDATE eleves SET last_seen = ? WHERE nom = ? AND session_id = ?",
            (vieux, "Estelle Kamga", SESSION_ID),
        )
        conn.commit()
    finally:
        conn.close()

    # Récapitulatif.
    print("Données de démo générées :")
    print(f"  session_id : {SESSION_ID}")
    print(f"  code_acces : {CODE_ACCES}")
    print(f"  titre_tp   : {TITRE_TP}")
    print(f"  tâches     : {len(taches)}")
    print(f"  élèves     : {len(ELEVES)}")
    print()
    print("Dashboard résultant :")
    for e in db.build_dashboard(SESSION_ID)["eleves"]:
        print(f"  - {e['nom']:<16} {e['taches_completes']}/{e['taches_total']}  [{e['statut']}]")


if __name__ == "__main__":
    seed()
