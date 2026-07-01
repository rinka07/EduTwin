/* ==========================================================================
   EduTwin — teacher.js
   Logique de l'espace enseignant :
   1. Création de session   → POST /api/session/create
   2. Import de fiche TP     → POST /api/session/{id}/document (champ "fichier")
   3. Dashboard temps réel   → GET /api/session/{id}/dashboard + WebSocket
   ========================================================================== */

import { postJSON, getJSON, uploadFile } from "./api.js";
import { SessionSocket } from "./ws.js";

/* --------------------------------------------------------------------------
   Petits helpers UI (locaux : le périmètre ne prévoit pas de module partagé)
   -------------------------------------------------------------------------- */

/** Échappe le HTML pour éviter toute injection dans les nœuds texte. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Affiche un toast auto-dismiss (3,5 s). type: info|success|danger */
function toast(message, type = "info") {
  const region = document.getElementById("toast-region");
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "danger" ? "alert" : "status");
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    // Filet de sécurité si l'animation est désactivée (reduced-motion)
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

/** Copie un texte dans le presse-papiers avec repli si l'API est indisponible. */
async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch (_) {
    // Repli : sélection via un textarea temporaire (contexte non sécurisé/LAN).
    const ta = document.createElement("textarea");
    ta.value = texte;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) {}
    ta.remove();
    return ok;
  }
}

/* --------------------------------------------------------------------------
   État applicatif
   -------------------------------------------------------------------------- */
const state = {
  sessionId: null,
  codeAcces: null,
  socket: null,
};

/* --------------------------------------------------------------------------
   1. Création de session
   -------------------------------------------------------------------------- */
const formSession = document.getElementById("form-session");
const btnCreer = document.getElementById("btn-creer");

formSession.addEventListener("submit", async (e) => {
  e.preventDefault();
  document.getElementById("err-titre_tp").textContent = "";
  document.getElementById("err-session").textContent = "";

  const titre_tp = document.getElementById("titre_tp").value.trim();
  const duree_minutes = parseInt(document.getElementById("duree_minutes").value, 10);
  const nb_taches = parseInt(document.getElementById("nb_taches").value, 10);

  // Validation côté client (erreur près du champ concerné)
  if (!titre_tp) {
    document.getElementById("err-titre_tp").textContent = "Le titre du TP est obligatoire.";
    document.getElementById("titre_tp").focus();
    return;
  }
  if (!Number.isInteger(nb_taches) || nb_taches < 1) {
    document.getElementById("err-session").textContent = "Le nombre de tâches doit être au moins 1.";
    return;
  }

  setLoading(btnCreer, true, "Création…");
  try {
    // Contrat : { titre_tp, duree_minutes, nb_taches } → { session_id, code_acces }
    const data = await postJSON("/api/session/create", { titre_tp, duree_minutes, nb_taches });
    state.sessionId = data.session_id;
    state.codeAcces = data.code_acces;
    afficherCode(data.code_acces, data.session_id);
    document.getElementById("btn-importer").disabled = false;
    toast("Session créée avec succès.", "success");
    demarrerDashboard(data.session_id);
  } catch (err) {
    document.getElementById("err-session").textContent = err.message || "Échec de la création.";
    toast("Impossible de créer la session.", "danger");
  } finally {
    setLoading(btnCreer, false, "Créer la session");
  }
});

/** Affiche le bloc code d'accès + session_id. */
function afficherCode(code, sessionId) {
  document.getElementById("code-acces").textContent = code;
  document.getElementById("session-id").textContent = sessionId;
  document.getElementById("bloc-code").classList.remove("hidden");
}

// Copie du code d'accès
document.getElementById("btn-copier-code").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (await copier(state.codeAcces || "")) {
    btn.classList.add("is-copied");
    btn.querySelector("span").textContent = "Copié !";
    setTimeout(() => {
      btn.classList.remove("is-copied");
      btn.querySelector("span").textContent = "Copier le code";
    }, 1800);
  } else {
    toast("Copie impossible, sélectionnez le code manuellement.", "danger");
  }
});

// Copie d'un lien élève pré-rempli (?session=... transmet le session_id)
document.getElementById("btn-copier-lien").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const lien = `${location.origin}/student.html?session=${encodeURIComponent(state.sessionId || "")}`;
  if (await copier(lien)) {
    btn.textContent = "Lien copié !";
    setTimeout(() => (btn.textContent = "Copier le lien élève"), 1800);
  } else {
    toast("Copie du lien impossible.", "danger");
  }
});

/* --------------------------------------------------------------------------
   2. Import de la fiche TP
   -------------------------------------------------------------------------- */
const inputFichier = document.getElementById("fichier");
const formDoc = document.getElementById("form-doc");
const btnImporter = document.getElementById("btn-importer");

inputFichier.addEventListener("change", () => {
  const f = inputFichier.files[0];
  document.getElementById("dropzone-nom").textContent = f ? f.name : "Choisir un fichier PDF ou Word";
});

formDoc.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fichier = inputFichier.files[0];
  const statutEl = document.getElementById("doc-status");

  if (!state.sessionId) {
    toast("Créez d'abord une session.", "danger");
    return;
  }
  if (!fichier) {
    toast("Sélectionnez un fichier à importer.", "danger");
    return;
  }

  // État « traitement en cours » avec spinner
  statutEl.className = "doc-status doc-status--work mt-4";
  statutEl.innerHTML = `<span class="spinner" aria-hidden="true"></span> Indexation de « ${esc(fichier.name)} » en cours…`;
  statutEl.classList.remove("hidden");
  setLoading(btnImporter, true, "Import…");

  try {
    // Contrat : multipart, champ "fichier" → { document_id, statut: "indexe" }
    const data = await uploadFile(`/api/session/${state.sessionId}/document`, fichier, "fichier");
    statutEl.className = "doc-status doc-status--ok mt-4";
    statutEl.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Fiche indexée (statut : ${esc(data.statut || "indexe")}).`;
    toast("Fiche TP indexée.", "success");
  } catch (err) {
    statutEl.className = "doc-status mt-4";
    statutEl.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg> Échec : ${esc(err.message || "import impossible")}.`;
    toast("Échec de l'indexation.", "danger");
  } finally {
    setLoading(btnImporter, false, "Importer et indexer");
  }
});

/* --------------------------------------------------------------------------
   3. Dashboard temps réel (état initial + WebSocket)
   -------------------------------------------------------------------------- */
async function demarrerDashboard(sessionId) {
  // État initial via HTTP
  try {
    const data = await getJSON(`/api/session/${sessionId}/dashboard`);
    majTableau(data.eleves || []);
  } catch (_) {
    // Pas bloquant : le WebSocket enverra un snapshot « dashboard ».
  }

  // WebSocket : reconnexion auto gérée par SessionSocket
  state.socket?.close();
  state.socket = new SessionSocket(sessionId, {
    onOpen:      () => setWsStatus(true),
    onClose:     () => setWsStatus(false),
    onDashboard: (data) => majTableau(data.eleves || []),
    onEleveJoin: (d) => ajouterFeed("join", d),
    onTacheUpdate: (d) => ajouterFeed("task", d),
    onChat:      (d) => ajouterFeed("chat", d),
  });
  state.socket.connect();
}

/** Indicateur de connexion WebSocket. */
function setWsStatus(online) {
  const el = document.getElementById("ws-status");
  el.classList.toggle("is-online", online);
  el.classList.toggle("is-offline", !online);
  document.getElementById("ws-status-label").textContent = online ? "En ligne" : "Reconnexion…";
}

/** Reconstruit le tableau des élèves + KPI à partir d'un snapshot. */
function majTableau(eleves) {
  const tbody = document.getElementById("tbody-eleves");
  const vide = document.getElementById("eleves-empty");

  if (!eleves.length) {
    tbody.innerHTML = "";
    vide.classList.remove("hidden");
  } else {
    vide.classList.add("hidden");
    tbody.innerHTML = eleves.map(renderLigneEleve).join("");
  }
  majKPI(eleves);
}

/** Correspondance statut → classe de badge + libellé. */
const STATUT_UI = {
  actif:   { cls: "badge--success", label: "Actif" },
  bloque:  { cls: "badge--danger",  label: "Bloqué" },
  inactif: { cls: "badge--muted",   label: "Inactif" },
};

/** Rendu d'une ligne du tableau élève. */
function renderLigneEleve(e) {
  const total = e.taches_total || 0;
  const faites = e.taches_completes || 0;
  const pct = total ? Math.round((faites / total) * 100) : 0;
  const ui = STATUT_UI[e.statut] || STATUT_UI.inactif;
  return `
    <tr>
      <td><span class="student-name">${esc(e.nom)}</span></td>
      <td class="progress-cell">
        <div class="progress"><div class="progress__bar" style="width:${pct}%"></div></div>
        <div class="progress-cell__meta">${faites} / ${total} tâches · ${pct}%</div>
      </td>
      <td><span class="badge ${ui.cls}"><span class="badge__dot" aria-hidden="true"></span>${ui.label}</span></td>
    </tr>`;
}

/** Met à jour les 3 KPI. */
function majKPI(eleves) {
  const connectes = eleves.length;
  const bloques = eleves.filter((e) => e.statut === "bloque").length;
  let sommePct = 0;
  for (const e of eleves) {
    const total = e.taches_total || 0;
    sommePct += total ? (e.taches_completes || 0) / total : 0;
  }
  const moyenne = connectes ? Math.round((sommePct / connectes) * 100) : 0;
  document.getElementById("kpi-connectes").textContent = connectes;
  document.getElementById("kpi-bloques").textContent = bloques;
  document.getElementById("kpi-progression").textContent = `${moyenne}%`;
}

/* --- Flux d'activité ---------------------------------------------------- */
const STATUT_TACHE_LABEL = {
  en_cours: "a démarré",
  bloque:   "est bloqué·e sur",
  complete: "a terminé",
};

/** Ajoute un évènement en haut du flux. type: join|task|chat */
function ajouterFeed(type, d) {
  const feed = document.getElementById("feed");
  document.getElementById("feed-empty").classList.add("hidden");

  const heure = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  let icone = "";
  let corps = "";

  if (type === "join") {
    icone = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>';
    corps = `<div class="feed-item__text"><span class="feed-item__strong">${esc(d.nom)}</span> a rejoint la session.</div>`;
  } else if (type === "task") {
    icone = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    const action = STATUT_TACHE_LABEL[d.statut] || "a mis à jour";
    corps = `<div class="feed-item__text"><span class="feed-item__strong">${esc(d.nom)}</span> ${action} une tâche.</div>`;
  } else { // chat
    icone = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
    corps = `<div class="feed-item__text"><span class="feed-item__strong">${esc(d.nom)}</span> a posé une question :</div>
             <div class="feed-item__q">« ${esc(d.question)} »</div>`;
  }

  const item = document.createElement("div");
  item.className = "feed-item";
  item.innerHTML = `
    <span class="feed-item__icon feed-item__icon--${type}" aria-hidden="true">${icone}</span>
    <div class="feed-item__body">${corps}<div class="feed-item__time">${heure}</div></div>`;
  feed.prepend(item);

  // Limite le feed à 60 éléments pour éviter une croissance infinie.
  while (feed.children.length > 60) feed.lastElementChild.remove();
}

/* --------------------------------------------------------------------------
   Utilitaire : état de chargement d'un bouton
   -------------------------------------------------------------------------- */
function setLoading(btn, loading, texte) {
  const label = btn.querySelector(".btn__label");
  btn.disabled = loading;
  if (loading) {
    btn.dataset.prev = label ? label.textContent : "";
    if (label) label.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(texte)}`;
  } else if (label) {
    label.textContent = texte ?? btn.dataset.prev ?? "";
  }
}
