# -*- coding: utf-8 -*-
"""Couche DONNÉES : définition du schéma SQLite (tables du Lot 1).

Ce module ne contient QUE la structure des tables (DDL). La connexion et les
fonctions d'accès sont dans `database.py` ; les schémas de validation HTTP
(Pydantic) sont dans `schemas.py`.

Correspondance avec les modèles attendus par le brief Lot 1 :

    Session          -> table `sessions`
    Eleve            -> table `eleves`
    Tache            -> table `taches`
    ProgressionTache -> table `eleve_taches`   (eleve_id, tache_id, statut, date_maj)
    Document         -> table `documents`      (document_id, session_id, chemin_fichier, statut)

Les tables `chunks` et `chat_historique` relèvent du périmètre Lot 2
(indexation RAG + historique du chat IA). Elles sont déclarées ici pour que la
base soit complète lors de l'assemblage, mais le Lot 1 ne les remplit pas.
"""

# DDL idempotent : exécuté au démarrage par database.init_db().
SCHEMA: str = """
-- Session : une séance de TP créée par l'enseignant.
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  titre_tp      TEXT,
  duree_minutes INTEGER,
  nb_taches     INTEGER,
  code_acces    TEXT,
  document_id   TEXT,
  created_at    TEXT
);

-- Tache : une étape du TP (titre + consigne), rattachée à une session.
CREATE TABLE IF NOT EXISTS taches (
  id         TEXT PRIMARY KEY,
  session_id TEXT,
  ordre      INTEGER,
  titre      TEXT,
  consigne   TEXT
);

-- Poste : une machine partagée par 1 à 3 élèves (unité de connexion).
-- Ajout EXTENSIONS (voir EXTENSIONS.md) : le contrat figé reste inchangé.
CREATE TABLE IF NOT EXISTS postes (
  poste_id   TEXT PRIMARY KEY,
  session_id TEXT,
  numero     INTEGER,
  classe     TEXT,
  joined_at  TEXT,
  last_seen  TEXT
);

-- Eleve : un élève ayant rejoint une session.
-- Colonnes `poste_id` / `classe` ajoutées par ALTER TABLE défensif (init_db) pour
-- rester compatible avec les bases existantes ; nul en mode solo historique.
CREATE TABLE IF NOT EXISTS eleves (
  eleve_id   TEXT PRIMARY KEY,
  session_id TEXT,
  nom        TEXT,
  statut     TEXT,
  joined_at  TEXT,
  last_seen  TEXT,
  poste_id   TEXT,
  classe     TEXT
);

-- Assignation : quel élève est responsable de quelle étape SUR un poste donné.
CREATE TABLE IF NOT EXISTS assignations (
  poste_id  TEXT,
  tache_id  TEXT,
  eleve_id  TEXT,
  PRIMARY KEY (poste_id, tache_id)
);

-- Ressource : fichier source complémentaire déposé par l'enseignant pour
-- enrichir le contexte de l'IA (injecté dans les chunks RAG).
CREATE TABLE IF NOT EXISTS ressources (
  ressource_id   TEXT PRIMARY KEY,
  session_id     TEXT,
  nom            TEXT,
  chemin_fichier TEXT,
  created_at     TEXT
);

-- ProgressionTache : statut d'une tâche pour un élève donné.
CREATE TABLE IF NOT EXISTS eleve_taches (
  eleve_id  TEXT,
  tache_id  TEXT,
  statut    TEXT,
  date_maj  TEXT,
  PRIMARY KEY (eleve_id, tache_id)
);

-- Document : fiche TP brute importée par l'enseignant (stockée sur disque).
-- Le Lot 1 stocke seulement le fichier ; l'extraction/indexation est au Lot 2.
CREATE TABLE IF NOT EXISTS documents (
  document_id    TEXT PRIMARY KEY,
  session_id     TEXT,
  chemin_fichier TEXT,
  statut         TEXT,
  created_at     TEXT
);

-- (Périmètre Lot 2) Passages indexés de la fiche pour le RAG.
CREATE TABLE IF NOT EXISTS chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  ordre      INTEGER,
  contenu    TEXT
);

-- (Périmètre Lot 2) Historique des échanges avec l'assistant IA.
CREATE TABLE IF NOT EXISTS chat_historique (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  eleve_id   TEXT,
  question   TEXT,
  reponse    TEXT,
  timestamp  TEXT
);
"""
