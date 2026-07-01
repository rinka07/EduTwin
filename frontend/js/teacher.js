/* ==========================================================================
   EduTwin — teacher.js (espace enseignant)
   - Authentification (mot de passe → jeton) + déconnexion
   - Restauration de la séance en cours après actualisation (localStorage)
   - Historique des séances (GET /api/teacher/sessions)
   - Création de session, import de fiche TP
   - Édition des tâches proposées par l'IA (ajout / modif / suppression)
   - Dashboard temps réel (GET dashboard + WebSocket)
   ========================================================================== */

import {
  postJSON, getJSON, patchJSON, deleteJSON, uploadFile,
  setTokenEnseignant, getTokenEnseignant,
} from "./api.js";
import { SessionSocket } from "./ws.js";

/* --- Helpers UI ---------------------------------------------------------- */
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
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
async function copier(texte) {
  try { await navigator.clipboard.writeText(texte); return true; }
  catch (_) {
    const ta = document.createElement("textarea");
    ta.value = texte; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
    ta.remove(); return ok;
  }
}
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
const $ = (id) => document.getElementById(id);

/* --- État + persistance -------------------------------------------------- */
const CLE_SESSION = "edutwin_teacher_session";   // session_id en cours
const state = { sessionId: null, codeAcces: null, titre: null, socket: null };

/* ==========================================================================
   AUTHENTIFICATION
   ========================================================================== */
function afficherLogin() {
  $("ecran-login").classList.remove("hidden");
  $("app-enseignant").classList.add("hidden");
  $("btn-logout").classList.add("hidden");
  $("mot_de_passe").focus?.();
}
function afficherApp() {
  $("ecran-login").classList.add("hidden");
  $("app-enseignant").classList.remove("hidden");
  $("btn-logout").classList.remove("hidden");
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("err-login").textContent = "";
  const mot_de_passe = $("mot_de_passe").value;
  if (!mot_de_passe) { $("err-login").textContent = "Saisissez le mot de passe."; return; }

  setLoading($("btn-login"), true, "Connexion…");
  try {
    const data = await postJSON("/api/teacher/login", { mot_de_passe });
    setTokenEnseignant(data.token);
    afficherApp();
    await chargerHistorique();
    await restaurerSession();
    toast("Bienvenue dans l'espace enseignant.", "success");
  } catch (err) {
    $("err-login").textContent = err.status === 401
      ? "Mot de passe incorrect." : (err.message || "Connexion impossible.");
  } finally {
    setLoading($("btn-login"), false, "Se connecter");
  }
});

// Afficher / masquer le mot de passe
$("btn-voir-mdp").addEventListener("click", () => {
  const inp = $("mot_de_passe");
  inp.type = inp.type === "password" ? "text" : "password";
  $("btn-voir-mdp").setAttribute(
    "aria-label", inp.type === "password" ? "Afficher le mot de passe" : "Masquer le mot de passe");
});

// Déconnexion
$("btn-logout").addEventListener("click", () => {
  setTokenEnseignant(null);
  localStorage.removeItem(CLE_SESSION);
  state.socket?.close();
  state.sessionId = null;
  afficherLogin();
  toast("Déconnecté·e.", "info");
});

/* ==========================================================================
   HISTORIQUE DES SÉANCES
   ========================================================================== */
async function chargerHistorique() {
  try {
    const data = await getJSON("/api/teacher/sessions");
    rendreHistorique(data.sessions || []);
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
    // non bloquant
  }
}

function rendreHistorique(sessions) {
  const liste = $("historique-liste");
  const vide = $("histo-empty");
  if (!sessions.length) {
    liste.innerHTML = "";
    vide.classList.remove("hidden");
    return;
  }
  vide.classList.add("hidden");
  liste.innerHTML = sessions.map((s) => {
    const date = formaterDate(s.created_at);
    const actif = s.session_id === state.sessionId ? " is-current" : "";
    return `
      <button type="button" class="histo-item${actif}" data-session="${esc(s.session_id)}"
              data-code="${esc(s.code_acces)}" data-titre="${esc(s.titre_tp)}">
        <span class="histo-item__main">
          <span class="histo-item__titre">${esc(s.titre_tp)}</span>
          <span class="histo-item__meta">
            <span class="mono">${esc(s.code_acces)}</span> · ${s.nb_eleves} élève(s) · ${s.nb_taches} tâche(s)
          </span>
        </span>
        <span class="histo-item__date">${esc(date)}</span>
      </button>`;
  }).join("");
}

$("historique-liste").addEventListener("click", (e) => {
  const item = e.target.closest(".histo-item");
  if (!item) return;
  ouvrirSession(item.dataset.session, item.dataset.code, item.dataset.titre);
});

/* ==========================================================================
   OUVERTURE / RESTAURATION D'UNE SESSION
   ========================================================================== */
async function ouvrirSession(sessionId, code, titre) {
  state.sessionId = sessionId;
  state.codeAcces = code;
  state.titre = titre;
  localStorage.setItem(CLE_SESSION, sessionId);

  afficherCode(code, sessionId);
  $("dashboard-session-nom").textContent = titre || "";
  $("btn-importer").disabled = false;
  $("card-taches").classList.remove("hidden");

  await chargerTaches();
  demarrerDashboard(sessionId);
  rafraichirEtatHistorique();
}

// Restaure la session mémorisée (après actualisation de la page).
async function restaurerSession() {
  const sid = localStorage.getItem(CLE_SESSION);
  if (!sid) return;
  try {
    const info = await getJSON(`/api/session/${encodeURIComponent(sid)}`);
    await ouvrirSession(info.session_id, info.code_acces, info.titre_tp);
  } catch (_) {
    // Session disparue (base réinitialisée) : on oublie la référence.
    localStorage.removeItem(CLE_SESSION);
  }
}

function rafraichirEtatHistorique() {
  document.querySelectorAll(".histo-item").forEach((b) => {
    b.classList.toggle("is-current", b.dataset.session === state.sessionId);
  });
}

function forcerReconnexion() {
  setTokenEnseignant(null);
  afficherLogin();
  toast("Session expirée, reconnectez-vous.", "danger");
}

/* ==========================================================================
   1. CRÉATION DE SESSION
   ========================================================================== */
$("form-session").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("err-titre_tp").textContent = "";
  $("err-session").textContent = "";

  const titre_tp = $("titre_tp").value.trim();
  const duree_minutes = parseInt($("duree_minutes").value, 10);
  const nb_taches = parseInt($("nb_taches").value, 10);

  if (!titre_tp) { $("err-titre_tp").textContent = "Le titre du TP est obligatoire."; $("titre_tp").focus(); return; }
  if (!Number.isInteger(nb_taches) || nb_taches < 1) { $("err-session").textContent = "Le nombre de tâches doit être au moins 1."; return; }

  setLoading($("btn-creer"), true, "Création…");
  try {
    const data = await postJSON("/api/session/create", { titre_tp, duree_minutes, nb_taches });
    toast("Session créée avec succès.", "success");
    await ouvrirSession(data.session_id, data.code_acces, titre_tp);
    await chargerHistorique();
    $("form-session").reset();
    $("duree_minutes").value = 90; $("nb_taches").value = 5;
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
    $("err-session").textContent = err.message || "Échec de la création.";
    toast("Impossible de créer la session.", "danger");
  } finally {
    setLoading($("btn-creer"), false, "Créer la session");
  }
});

function afficherCode(code, sessionId) {
  $("code-acces").textContent = code;
  $("session-id").textContent = sessionId;
  $("bloc-code").classList.remove("hidden");
}

$("btn-copier-code").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (await copier(state.codeAcces || "")) {
    btn.classList.add("is-copied");
    btn.querySelector("span").textContent = "Copié !";
    setTimeout(() => { btn.classList.remove("is-copied"); btn.querySelector("span").textContent = "Copier le code"; }, 1800);
  } else { toast("Copie impossible, sélectionnez le code manuellement.", "danger"); }
});

$("btn-copier-lien").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const lien = `${location.origin}/student.html?session=${encodeURIComponent(state.sessionId || "")}`;
  if (await copier(lien)) {
    btn.textContent = "Lien copié !";
    setTimeout(() => (btn.textContent = "Copier le lien élève"), 1800);
  } else { toast("Copie du lien impossible.", "danger"); }
});

/* ==========================================================================
   2. IMPORT DE LA FICHE TP
   ========================================================================== */
const inputFichier = $("fichier");
inputFichier.addEventListener("change", () => {
  const f = inputFichier.files[0];
  $("dropzone-nom").textContent = f ? f.name : "Choisir un fichier PDF ou Word";
});

$("form-doc").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fichier = inputFichier.files[0];
  const statutEl = $("doc-status");
  if (!state.sessionId) { toast("Créez d'abord une session.", "danger"); return; }
  if (!fichier) { toast("Sélectionnez un fichier à importer.", "danger"); return; }

  statutEl.className = "doc-status doc-status--work mt-4";
  statutEl.innerHTML = `<span class="spinner" aria-hidden="true"></span> Indexation de « ${esc(fichier.name)} » en cours…`;
  statutEl.classList.remove("hidden");
  setLoading($("btn-importer"), true, "Import…");

  try {
    const data = await uploadFile(`/api/session/${state.sessionId}/document`, fichier, "fichier");
    statutEl.className = "doc-status doc-status--ok mt-4";
    statutEl.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> Fiche importée (statut : ${esc(data.statut || "indexe")}).`;
    toast("Fiche TP importée.", "success");
    await chargerTaches();   // les tâches extraites (Lot 2) apparaissent dans l'éditeur
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
    statutEl.className = "doc-status mt-4";
    statutEl.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg> Échec : ${esc(err.message || "import impossible")}.`;
    toast("Échec de l'import.", "danger");
  } finally {
    setLoading($("btn-importer"), false, "Importer et indexer");
  }
});

/* ==========================================================================
   3. ÉDITEUR DE TÂCHES
   ========================================================================== */
async function chargerTaches() {
  if (!state.sessionId) return;
  try {
    const data = await getJSON(`/api/session/${state.sessionId}/taches`);
    rendreTaches(data.taches || []);
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
  }
}

function rendreTaches(taches) {
  const editor = $("taches-editor");
  const vide = $("taches-empty");
  if (!taches.length) {
    editor.innerHTML = "";
    vide.classList.remove("hidden");
    return;
  }
  vide.classList.add("hidden");
  editor.innerHTML = taches.map((t, i) => `
    <div class="tache-edit" data-id="${esc(t.id)}">
      <div class="tache-edit__num" aria-hidden="true">${i + 1}</div>
      <div class="tache-edit__fields">
        <label class="sr-only" for="t-titre-${esc(t.id)}">Titre de la tâche ${i + 1}</label>
        <input class="input tache-edit__titre" id="t-titre-${esc(t.id)}" value="${esc(t.titre)}" placeholder="Titre de la tâche">
        <label class="sr-only" for="t-cons-${esc(t.id)}">Consigne de la tâche ${i + 1}</label>
        <textarea class="textarea tache-edit__consigne" id="t-cons-${esc(t.id)}" rows="3" placeholder="Consigne détaillée">${esc(t.consigne)}</textarea>
        <div class="tache-edit__actions">
          <button class="btn btn--sm btn--accent" type="button" data-act="save">Enregistrer</button>
          <button class="btn btn--sm btn--danger-ghost" type="button" data-act="delete">Supprimer</button>
        </div>
      </div>
    </div>`).join("");
}

$("taches-editor").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const ligne = btn.closest(".tache-edit");
  const tacheId = ligne.dataset.id;

  if (btn.dataset.act === "save") {
    const titre = ligne.querySelector(".tache-edit__titre").value.trim();
    const consigne = ligne.querySelector(".tache-edit__consigne").value;
    if (!titre) { toast("Le titre de la tâche est obligatoire.", "danger"); return; }
    setLoading(btn, true, "…");
    try {
      await patchJSON(`/api/session/${state.sessionId}/taches/${tacheId}`, { titre, consigne });
      toast("Tâche enregistrée.", "success");
      ligne.classList.add("is-saved");
      setTimeout(() => ligne.classList.remove("is-saved"), 1200);
    } catch (err) {
      if (err.status === 401) { forcerReconnexion(); return; }
      toast(err.message || "Enregistrement impossible.", "danger");
    } finally { setLoading(btn, false, "Enregistrer"); }
    return;
  }

  if (btn.dataset.act === "delete") {
    // Confirmation en deux temps (évite une boîte de dialogue bloquante).
    if (btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.textContent = "Confirmer ?";
      btn.classList.add("is-armed");
      setTimeout(() => {
        if (btn.dataset.armed === "1") {
          btn.dataset.armed = "0"; btn.textContent = "Supprimer"; btn.classList.remove("is-armed");
        }
      }, 3000);
      return;
    }
    try {
      await deleteJSON(`/api/session/${state.sessionId}/taches/${tacheId}`);
      toast("Tâche supprimée.", "info");
      await chargerTaches();
    } catch (err) {
      if (err.status === 401) { forcerReconnexion(); return; }
      toast(err.message || "Suppression impossible.", "danger");
    }
  }
});

$("btn-ajouter-tache").addEventListener("click", async () => {
  if (!state.sessionId) { toast("Créez d'abord une session.", "danger"); return; }
  setLoading($("btn-ajouter-tache"), true, "Ajout…");
  try {
    await postJSON(`/api/session/${state.sessionId}/taches`, {
      titre: "Nouvelle tâche", consigne: "",
    });
    await chargerTaches();
    // Focus sur le titre de la dernière tâche ajoutée.
    const lignes = document.querySelectorAll(".tache-edit__titre");
    lignes[lignes.length - 1]?.focus();
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
    toast(err.message || "Ajout impossible.", "danger");
  } finally {
    setLoading($("btn-ajouter-tache"), false, "Ajouter une tâche");
  }
});

/* ==========================================================================
   DASHBOARD TEMPS RÉEL
   ========================================================================== */
async function demarrerDashboard(sessionId) {
  try {
    const data = await getJSON(`/api/session/${sessionId}/dashboard`);
    majTableau(data.eleves || []);
  } catch (_) { /* le WebSocket enverra un snapshot */ }

  state.socket?.close();
  // Repartir d'un feed propre à l'ouverture d'une autre séance.
  $("feed").innerHTML = "";
  $("feed-empty").classList.remove("hidden");
  state.socket = new SessionSocket(sessionId, {
    onOpen:        () => setWsStatus(true),
    onClose:       () => setWsStatus(false),
    onDashboard:   (data) => majTableau(data.eleves || []),
    onEleveJoin:   (d) => ajouterFeed("join", d),
    onTacheUpdate: (d) => ajouterFeed("task", d),
    onChat:        (d) => ajouterFeed("chat", d),
  });
  state.socket.connect();
}

function setWsStatus(online) {
  const el = $("ws-status");
  el.classList.toggle("is-online", online);
  el.classList.toggle("is-offline", !online);
  $("ws-status-label").textContent = online ? "En ligne" : "Reconnexion…";
}

function majTableau(eleves) {
  const tbody = $("tbody-eleves");
  const vide = $("eleves-empty");
  if (!eleves.length) { tbody.innerHTML = ""; vide.classList.remove("hidden"); }
  else { vide.classList.add("hidden"); tbody.innerHTML = eleves.map(renderLigneEleve).join(""); }
  majKPI(eleves);
}

const STATUT_UI = {
  actif:   { cls: "badge--success", label: "Actif" },
  bloque:  { cls: "badge--danger",  label: "Bloqué" },
  inactif: { cls: "badge--muted",   label: "Inactif" },
};

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

function majKPI(eleves) {
  const connectes = eleves.length;
  const bloques = eleves.filter((e) => e.statut === "bloque").length;
  let sommePct = 0;
  for (const e of eleves) {
    const total = e.taches_total || 0;
    sommePct += total ? (e.taches_completes || 0) / total : 0;
  }
  const moyenne = connectes ? Math.round((sommePct / connectes) * 100) : 0;
  $("kpi-connectes").textContent = connectes;
  $("kpi-bloques").textContent = bloques;
  $("kpi-progression").textContent = `${moyenne}%`;
}

const STATUT_TACHE_LABEL = { en_cours: "a démarré", bloque: "est bloqué·e sur", complete: "a terminé" };

function ajouterFeed(type, d) {
  const feed = $("feed");
  $("feed-empty").classList.add("hidden");
  const heure = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  let icone = "", corps = "";
  if (type === "join") {
    icone = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>';
    corps = `<div class="feed-item__text"><span class="feed-item__strong">${esc(d.nom)}</span> a rejoint la session.</div>`;
  } else if (type === "task") {
    icone = '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    const action = STATUT_TACHE_LABEL[d.statut] || "a mis à jour";
    corps = `<div class="feed-item__text"><span class="feed-item__strong">${esc(d.nom)}</span> ${action} une tâche.</div>`;
  } else {
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
  while (feed.children.length > 60) feed.lastElementChild.remove();
}

/* --- Utilitaires --------------------------------------------------------- */
function formaterDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
       + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/* ==========================================================================
   INITIALISATION
   ========================================================================== */
(async function init() {
  if (getTokenEnseignant()) {
    // On tente de charger l'historique : si le jeton est encore valide, on entre.
    afficherApp();
    try {
      const data = await getJSON("/api/teacher/sessions");
      rendreHistorique(data.sessions || []);
      await restaurerSession();
    } catch (err) {
      if (err.status === 401) { setTokenEnseignant(null); afficherLogin(); }
    }
  } else {
    afficherLogin();
  }
})();
