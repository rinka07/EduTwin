#!/usr/bin/env bash
# Script de lancement du backend EduTwin (Lot 1).
# - crée le venv si absent, installe les dépendances,
# - lance uvicorn sur 0.0.0.0:8000,
# - affiche l'IP LAN pour connecter enseignant et élèves.
set -euo pipefail

# Se placer dans le dossier du script (backend/) : indispensable pour que
# `from ia import ...` et `from routes.xxx import ...` fonctionnent.
cd "$(dirname "$0")"

VENV=".venv"
PYTHON="${PYTHON:-python3}"

# 1) Création du venv si nécessaire.
if [ ! -d "$VENV" ]; then
  echo ">> Création de l'environnement virtuel ($VENV)..."
  "$PYTHON" -m venv "$VENV"
fi

# 2) Installation / mise à jour des dépendances.
echo ">> Installation des dépendances..."
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r requirements.txt

# 3) Affichage de l'IP LAN (première adresse non-loopback).
IP_LAN="$(hostname -I 2>/dev/null | awk '{print $1}')"
IP_LAN="${IP_LAN:-<votre-IP-LAN>}"
echo ""
echo "========================================================"
echo " EduTwin démarre !"
echo " Enseignant / Élèves sur le même réseau, ouvrez :"
echo "   http://${IP_LAN}:8000"
echo " (santé : http://${IP_LAN}:8000/api/health)"
echo "========================================================"
echo ""

# 4) Lancement du serveur (host 0.0.0.0 pour l'accès LAN).
exec "$VENV/bin/uvicorn" main:app --host 0.0.0.0 --port 8000
