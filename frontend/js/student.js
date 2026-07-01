/* ==========================================================================
   EduTwin — student.js
   Logique de l'espace élève :
   1. Connexion       → POST /api/session/{session_id}/eleve/join
   2. Vue TP          → liste des tâches + PATCH /api/eleve/{id}/tache/{id}
   3. Chat IA         → POST /api/chat

   CHOIX DE CONCEPTION — transmission du session_id :
   Le contrat impose que « join » cible /api/session/{session_id}/eleve/join.
   L'élève a donc besoin du session_id EN PLUS du code d'accès. On le récupère
   de deux façons complémentaires :
     • via le paramètre d'URL ?session=... (lien préparé par l'enseignant,
       bouton « Copier le lien élève » côté teacher.js) → champ pré-rempli ;
     • sinon l'élève colle manuellement l'identifiant communiqué par l'enseignant.
   Ainsi l'écran reste simple et 100 % conforme au contrat.
   ========================================================================== */

import { postJSON, patchJSON } from "./api.js";

/* --- Helpers UI locaux -------------------------------------------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function toast(message, type = "info") {
  const region = document.getElementById("toast-region");
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "danger" ? "alert" : "status");
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
function setLoading(btn, loading, texte) {
  const label = btn.querySelector(".btn__label");
  btn.disabled = loading;
  if (label) {
    if (loading) label.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(texte || "")}`;
    else label.textContent = texte ?? "";
  }
}

/* --- État --------------------------------------------------------------- */
const state = {
  sessionId: null,
  eleveId: null,
  nom: null,
  taches: [],                 // [{ id, titre, consigne }]
  statuts: new Map(),         // tache_id → statut courant
};

/* --------------------------------------------------------------------------
   Pré-remplissage du session_id depuis l'URL (?session=...)
   -------------------------------------------------------------------------- */
(function prefillSession() {
  const params = new URLSearchParams(location.search);
  const s = params.get("session");
  if (s) document.getElementById("session_id").value = s.trim();
})();

/* --------------------------------------------------------------------------
   1. Connexion à la session
   -------------------------------------------------------------------------- */
const formJoin = document.getElementById("form-join");
const btnJoin = document.getElementById("btn-join");

formJoin.addEventListener("submit", async (e) => {
  e.preventDefault();
  ["err-nom", "err-code", "err-session", "err-join"].forEach((id) => (document.getElementById(id).textContent = ""));

  const nom_eleve = document.getElementById("nom_eleve").value.trim();
  const code_acces = document.getElementById("code_acces").value.trim().toUpperCase();
  const session_id = document.getElementById("session_id").value.trim();

  // Validations près des champs
  if (!nom_eleve) { erreurChamp("err-nom", "Indiquez votre nom.", "nom_eleve"); return; }
  if (!code_acces) { erreurChamp("err-code", "Saisissez le code d'accès.", "code_acces"); return; }
  if (!session_id) { erreurChamp("err-session", "L'identifiant de session est requis.", "session_id"); return; }

  setLoading(btnJoin, true, "Connexion…");
  try {
    // Contrat : POST /api/session/{session_id}/eleve/join { nom_eleve, code_acces }
    //           → { eleve_id, taches: [{ id, titre, consigne }] }
    const data = await postJSON(
      `/api/session/${encodeURIComponent(session_id)}/eleve/join`,
      { nom_eleve, code_acces }
    );
    state.sessionId = session_id;
    state.eleveId = data.eleve_id;
    state.nom = nom_eleve;
    state.taches = data.taches || [];
    state.taches.forEach((t) => state.statuts.set(t.id, null));

    entrerVueTP();
    toast(`Bienvenue, ${nom_eleve} !`, "success");
  } catch (err) {
    // 400 (brief Lot 1) ou 403 = code d'accès invalide
    const msg = (err.status === 400 || err.status === 403)
      ? "Code d'accès invalide."
      : (err.message || "Connexion impossible.");
    document.getElementById("err-join").textContent = msg;
    toast(msg, "danger");
  } finally {
    setLoading(btnJoin, false, "Rejoindre");
  }
});

function erreurChamp(idErreur, message, idChamp) {
  document.getElementById(idErreur).textContent = message;
  document.getElementById(idChamp)?.focus();
}

/* --------------------------------------------------------------------------
   2. Vue TP : bascule d'écran + rendu des tâches
   -------------------------------------------------------------------------- */
function entrerVueTP() {
  document.getElementById("ecran-join").classList.add("hidden");
  document.getElementById("ecran-tp").classList.remove("hidden");
  document.getElementById("header-eleve").textContent = state.nom;
  document.getElementById("tp-sous-titre").textContent =
    "Mettez à jour votre avancement et posez vos questions à l'assistant.";
  renderTaches();
  majProgression();
  document.getElementById("question").focus();
}

function renderTaches() {
  const liste = document.getElementById("task-list");
  if (!state.taches.length) {
    liste.innerHTML = `
      <div class="empty">
        <svg class="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
        <span class="empty__title">Aucune tâche pour l'instant</span>
        <span class="text-sm">L'enseignant n'a pas encore importé la fiche TP.</span>
      </div>`;
    return;
  }
  liste.innerHTML = state.taches.map((t, i) => renderTache(t, i + 1)).join("");
}

/** Rendu d'une tâche avec ses 3 boutons de statut. */
function renderTache(t, num) {
  const statut = state.statuts.get(t.id) || "";
  const btn = (val, label) =>
    `<button class="btn btn--sm btn--ghost status-btn${statut === val ? " is-active" : ""}"
             type="button" data-tache="${esc(t.id)}" data-value="${val}"
             aria-pressed="${statut === val}">${label}</button>`;
  return `
    <article class="task" data-statut="${esc(statut)}" data-id="${esc(t.id)}">
      <div class="task__head">
        <div class="task__title-wrap">
          <span class="task__num" aria-hidden="true">${num}</span>
          <h3 class="task__title">${esc(t.titre)}</h3>
        </div>
      </div>
      <pre class="task__consigne">${esc(t.consigne)}</pre>
      <div class="task__actions" role="group" aria-label="Statut de la tâche ${esc(t.titre)}">
        ${btn("en_cours", "En cours")}
        ${btn("bloque", "Bloqué")}
        ${btn("complete", "Terminé")}
      </div>
    </article>`;
}

// Délégation d'évènements pour les boutons de statut
document.getElementById("task-list").addEventListener("click", async (e) => {
  const btn = e.target.closest(".status-btn");
  if (!btn) return;
  const tacheId = btn.dataset.tache;
  const statut = btn.dataset.value;

  const ancien = state.statuts.get(tacheId);
  if (ancien === statut) return; // déjà dans cet état

  // Mise à jour optimiste de l'UI
  state.statuts.set(tacheId, statut);
  majTacheUI(tacheId);
  majProgression();

  try {
    // Contrat : PATCH /api/eleve/{eleve_id}/tache/{tache_id} { statut } → { ok: true }
    await patchJSON(`/api/eleve/${state.eleveId}/tache/${tacheId}`, { statut });
  } catch (err) {
    // Rollback en cas d'échec
    state.statuts.set(tacheId, ancien);
    majTacheUI(tacheId);
    majProgression();
    toast(err.message || "Mise à jour impossible.", "danger");
  }
});

/** Rafraîchit le rendu d'une seule tâche (boutons + bordure). */
function majTacheUI(tacheId) {
  const statut = state.statuts.get(tacheId) || "";
  const article = document.querySelector(`.task[data-id="${CSS.escape(tacheId)}"]`);
  if (!article) return;
  article.dataset.statut = statut;
  article.querySelectorAll(".status-btn").forEach((b) => {
    const actif = b.dataset.value === statut;
    b.classList.toggle("is-active", actif);
    b.setAttribute("aria-pressed", String(actif));
  });
}

/** Barre de progression globale (tâches "complete" / total). */
function majProgression() {
  const total = state.taches.length;
  const faites = [...state.statuts.values()].filter((s) => s === "complete").length;
  const pct = total ? Math.round((faites / total) * 100) : 0;
  document.getElementById("progress-label").textContent = `${faites} / ${total}`;
  document.getElementById("progress-global-bar").style.width = `${pct}%`;
  document.getElementById("progress-pct").textContent = `${pct}%`;
}

/* --------------------------------------------------------------------------
   3. Chat IA
   -------------------------------------------------------------------------- */
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("question");
const chatLog = document.getElementById("chat-log");
const btnChat = document.getElementById("btn-chat");

// Auto-agrandissement du textarea + envoi avec Entrée (Maj+Entrée = nouvelle ligne)
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;

  ajouterBulle(question, "user");
  chatInput.value = "";
  chatInput.style.height = "auto";
  chatInput.focus();

  // Indicateur « l'assistant réfléchit… »
  const penseur = ajouterTyping();
  btnChat.disabled = true;

  try {
    // Contrat : POST /api/chat { eleve_id, session_id, question }
    //           → { reponse, timestamp }
    const data = await postJSON("/api/chat", {
      eleve_id: state.eleveId,
      session_id: state.sessionId,
      question,
    });
    penseur.remove();
    ajouterBulle(data.reponse || "(réponse vide)", "ai", data.timestamp);
  } catch (err) {
    penseur.remove();
    ajouterBulle(
      `Désolé, je n'ai pas pu répondre (${esc(err.message || "erreur")}). Réessaie dans un instant.`,
      "ai"
    );
    toast("L'assistant est indisponible.", "danger");
  } finally {
    btnChat.disabled = false;
  }
});

/** Ajoute une bulle de chat (user = droite, ai = gauche). */
function ajouterBulle(texte, role, timestamp) {
  const bulle = document.createElement("div");
  bulle.className = `chat-bubble chat-bubble--${role}`;
  bulle.textContent = texte;
  if (timestamp) {
    const meta = document.createElement("div");
    meta.className = "chat-bubble__meta";
    meta.textContent = formaterHeure(timestamp);
    bulle.appendChild(meta);
  }
  chatLog.appendChild(bulle);
  chatLog.scrollTop = chatLog.scrollHeight;
}

/** Ajoute l'indicateur animé de réflexion et le renvoie. */
function ajouterTyping() {
  const el = document.createElement("div");
  el.className = "chat-bubble chat-bubble--ai";
  el.setAttribute("aria-label", "L'assistant réfléchit");
  el.innerHTML = `<span class="typing" aria-hidden="true"><span></span><span></span><span></span></span>`;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

/** Formate un timestamp ISO 8601 en heure locale FR (repli : texte brut). */
function formaterHeure(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
