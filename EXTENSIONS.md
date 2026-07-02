# EduTwin — Extensions (hors contrat figé)

Ce document décrit les **ajouts** apportés au-delà de `CONTRAT.md` (qui reste
**figé et inchangé**). Toutes les évolutions sont **additives** : les endpoints,
champs et messages WebSocket d'origine conservent exactement leur forme ; on
n'ajoute que de nouvelles tables, colonnes, routes et types d'évènements.

## 1. Fonctionnalités

- **Multi-élèves par poste** : une machine (poste) héberge 1 à 3 élèves, chacun
  suivi individuellement. **Répartition automatique** des étapes entre eux à la
  connexion (round-robin), ajustable ensuite manuellement.
- **Temps par tâche & enchaînement automatique** : `temps_par_tache =
  duree_minutes // nb_taches`. Pour chaque élève, le décompte de sa **première
  tâche démarre dès la connexion** ; dès qu'une tâche est **terminée** ou que son
  **temps est écoulé**, la tâche suivante de l'élève est **lancée
  automatiquement**. Le dépassement **alerte l'enseignant sans bloquer** l'élève
  (notification « retard »). Les minuteurs de tous les élèves du poste tournent en
  parallèle, même hors de l'écran actif.
- **Nombre d'étapes** : contraint à **≥ 3**, et jamais au-delà du nombre défini
  pour le TP (« pas plus, pas moins »).
- **Notifications enseignant typées** : connecté / en cours / bloqué / terminé /
  retard / question — différenciées par icône + couleur + libellé, précisant
  poste, élève (désambiguïsé) et étape. Filtrables par statut et par élève.
- **Blocage conditionné au chatbot** : « Bloqué » n'est activable qu'après avoir
  interrogé l'assistant.
- **Verrouillage « Terminé »** : une étape complétée ne peut plus être rouverte
  (front + back, HTTP 409).
- **Ressources complémentaires** : dépôt de documents sources par l'enseignant,
  dont le texte enrichit le contexte RAG de l'IA.
- **Bilingue FR/EN** : sélecteur mémorisé, interface complète traduite.
- **Reprise après déconnexion** : restauration intégrale du poste (élèves,
  progression, assignations, minuteurs, statut de consultation du chatbot).
- **Désambiguïsation des homonymes** : libellé `Nom · classe · P{n}` (+ identifiant
  court si collision).

## 2. Nouveaux endpoints HTTP

| Méthode | Chemin | Rôle |
|---|---|---|
| POST | `/api/session/{sid}/poste/join` | Inscrit un poste (1–3 élèves). Renvoie `poste_id, numero, classe, eleves[], taches[], duree_minutes, temps_par_tache`. |
| PUT | `/api/poste/{pid}/assignation` | Assigne une étape à un élève du poste (`{tache_id, eleve_id}`). |
| GET | `/api/poste/{pid}` | Restauration complète du poste (reprise). |
| POST | `/api/eleve/{eid}/tache/{tid}/retard` | Signale un dépassement de temps (alerte, sans changer la progression). |
| POST | `/api/session/{sid}/ressource` | Dépose une ressource (`multipart`, champ `fichier`) et enrichit le RAG. |
| GET | `/api/session/{sid}/ressources` | Liste des ressources déposées. |
| GET | `/api/ressource/{rid}` | Téléchargement d'une ressource. |

Modifications additives d'endpoints existants :
- `POST /api/session/create` valide `nb_taches ≥ 3` (400 sinon).
- `PATCH /api/eleve/{id}/tache/{id}` renvoie **409** si l'étape est déjà `complete`.
- `POST/DELETE /api/session/{sid}/taches` font respecter le nombre cible (≥ 3, ≤ défini).
- `GET /api/session/{sid}` expose `temps_par_tache`.
- `GET /dashboard` : champs additifs par élève (`numero_poste, classe, label, etape_en_cours`).

## 3. Nouveaux types de messages WebSocket

Enveloppe inchangée `{ "type", "data" }`. Types ajoutés :
- `poste_join` : `{ poste_id, numero, classe, eleves:[{eleve_id,nom}] }`
- `retard` : `{ eleve_id, nom, classe, numero_poste, tache_id, titre_tache }`

Les évènements existants (`tache_update`, `chat`) transportent des champs
additifs (`numero_poste`, `classe`, `titre_tache`) pour des notifications précises.

## 4. Schéma SQLite — ajouts

- Table `postes(poste_id, session_id, numero, classe, joined_at, last_seen)`.
- Table `assignations(poste_id, tache_id, eleve_id)` — PK `(poste_id, tache_id)`.
- Table `ressources(ressource_id, session_id, nom, chemin_fichier, created_at)`.
- Colonnes ajoutées à `eleves` : `poste_id`, `classe` (migration `ALTER TABLE`
  idempotente dans `database.init_db`).

`sessions.nb_taches` devient le **nombre cible** défini à la création (n'est plus
recalculé lors des ajouts/suppressions manuels de tâches).
