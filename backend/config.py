# -*- coding: utf-8 -*-
"""Configuration centrale du backend EduTwin (Lot 1).

Toutes les constantes de chemins et de réseau sont définies ici afin d'être
partagées par les autres modules. Le serveur tourne en LAN, hors-ligne.
"""
from pathlib import Path

# --- Réseau (LAN) ---
HOST = "0.0.0.0"          # écoute sur toutes les interfaces (accès LAN)
PORT = 8000

# --- Chemins ---
# Racine du backend (dossier contenant ce fichier)
BACKEND_DIR = Path(__file__).resolve().parent
# Racine du projet (dossier parent de backend/)
PROJECT_DIR = BACKEND_DIR.parent

# Base de données SQLite
DATA_DIR = PROJECT_DIR / "data"
DB_PATH = DATA_DIR / "edutwin.db"

# Dossier de dépôt des fiches TP importées
UPLOADS_DIR = PROJECT_DIR / "uploads"

# Dossier du frontend (servi en statique)
FRONTEND_DIR = PROJECT_DIR / "frontend"

# --- Règles métier ---
# Au-delà de ce délai sans activité, un élève est considéré "inactif".
INACTIF_APRES_SECONDES = 3 * 60  # 3 minutes

# Longueur du code d'accès élève (chiffres + lettres majuscules lisibles).
CODE_ACCES_LONGUEUR = 6

# Création des dossiers nécessaires au démarrage (idempotent).
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
