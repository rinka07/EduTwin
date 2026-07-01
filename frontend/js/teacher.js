/* ==========================================================================
   EduTwin — teacher.js (espace enseignant)
   - Authentification (mot de passe → jeton) + déconnexion
   - Restauration de la séance en cours après actualisation (localStorage)
   - Historique des séances, création de session (≥ 3 étapes), import fiche TP
   - Ressources complémentaires (contexte IA)
   - Édition des tâches (contrainte : pas plus / pas moins que le nombre défini)
   - Dashboard temps réel groupé par poste + désambiguïsation des homonymes
   - Notifications typées (connecté / en cours / bloqué / terminé / retard /
     question) avec filtres par statut et par élève
   ========================================================================== */

import {
  postJSON, getJSON, patchJSON, deleteJSON, uploadFile,
  setTokenEnseignant, getTokenEnseignant,
} from "./api.js";
import { SessionSocket } from "./ws.js";

const t = (k, p) => (window.EduI18n ? window.EduI18n.t(k, p) : k);

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
const CLE_SESSION = "edutwin_teacher_session";
const state = {
  sessionId: null, codeAcces: null, titre: null, socket: null,
  feedItems: [],            // notifications { type, statut, eleveId, label, tache, question, ts }
  filterStatut: "", filterEleve: "",
  eleves: [],               // dernier snapshot dashboard
};

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
  if (!mot_de_passe) { $("err-login").textContent = t("teacher.err.password"); return; }

  setLoading($("btn-login"), true, t("teacher.login.submit"));
  try {
    const data = await postJSON("/api/teacher/login", { mot_de_passe });
    setTokenEnseignant(data.token);
    afficherApp();
    await chargerHistorique();
    await restaurerSession();
    toast(t("teacher.welcome"), "success");
  } catch (err) {
    $("err-login").textContent = err.status === 401 ? t("teacher.login.error") : (err.message || "Connexion impossible.");
  } finally {
    setLoading($("btn-login"), false, t("teacher.login.submit"));
  }
});

$("btn-voir-mdp").addEventListener("click", () => {
  const inp = $("mot_de_passe");
  inp.type = inp.type === "password" ? "text" : "password";
  $("btn-voir-mdp").setAttribute("aria-label", inp.type === "password" ? "Afficher le mot de passe" : "Masquer le mot de passe");
});

$("btn-logout").addEventListener("click", () => {
  setTokenEnseignant(null);
  localStorage.removeItem(CLE_SESSION);
  state.socket?.close();
  state.sessionId = null;
  afficherLogin();
  toast(t("teacher.logout"), "info");
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
  }
}
function rendreHistorique(sessions) {
  const liste = $("historique-liste");
  const vide = $("histo-empty");
  if (!sessions.length) { liste.innerHTML = ""; vide.classList.remove("hidden"); return; }
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
            <span class="mono">${esc(s.code_acces)}</span> · ${s.nb_eleves} · ${s.nb_taches}
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
  $("card-ressources").classList.remove("hidden");
  $("btn-res").disabled = true;

  // Réinitialise notifications + filtres pour la nouvelle séance.
  state.feedItems = []; state.filterStatut = ""; state.filterEleve = "";
  $("filter-statut").value = ""; $("filter-eleve").innerHTML = `<option value="">${esc(t("teacher.filter.allStudents"))}</option>`;
  majKpiPressed();

  await chargerTaches();
  await chargerRessources();
  demarrerDashboard(sessionId);
  rafraichirEtatHistorique();
}

async function restaurerSession() {
  const sid = localStorage.getItem(CLE_SESSION);
  if (!sid) return;
  try {
    const info = await getJSON(`/api/session/${encodeURIComponent(sid)}`);
    await ouvrirSession(info.session_id, info.code_acces, info.titre_tp);
  } catch (_) { localStorage.removeItem(CLE_SESSION); }
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

  if (!titre_tp) { $("err-titre_tp").textContent = t("teacher.err.titre"); $("titre_tp").focus(); return; }
  if (!Number.isInteger(nb_taches) || nb_taches < 3) { $("err-session").textContent = t("teacher.err.nbtaches"); return; }

  setLoading($("btn-creer"), true, t("teacher.session.submit"));
  try {
    const data = await postJSON("/api/session/create", { titre_tp, duree_minutes, nb_taches });
    toast(t("teacher.welcome"), "success");
    await ouvrirSession(data.session_id, data.code_acces, titre_tp);
    await chargerHistorique();
    $("form-session").reset();
    $("duree_minutes").value = 90; $("nb_taches").value = 5;
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
    $("err-session").textContent = err.message || "Échec de la création.";
    toast(err.message || "Impossible de créer la session.", "danger");
  } finally {
    setLoading($("btn-creer"), false, t("teacher.session.submit"));
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
    btn.querySelector("span").textContent = t("teacher.code.copied");
    setTimeout(() => { btn.classList.remove("is-copied"); btn.querySelector("span").textContent = t("teacher.code.copy"); }, 1800);
  } else { toast("Copie impossible.", "danger"); }
});
$("btn-copier-lien").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const lien = `${location.origin}/student.html?session=${encodeURIComponent(state.sessionId || "")}`;
  if (await copier(lien)) {
    btn.textContent = t("teacher.link.copied");
    setTimeout(() => (btn.textContent = t("teacher.link.copy")), 1800);
  } else { toast("Copie du lien impossible.", "danger"); }
});

/* ==========================================================================
   2. IMPORT DE LA FICHE TP
   ========================================================================== */
const inputFichier = $("fichier");
inputFichier.addEventListener("change", () => {
  const f = inputFichier.files[0];
  $("dropzone-nom").textContent = f ? f.name : t("teacher.doc.drop");
});
$("form-doc").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fichier = inputFichier.files[0];
  const statutEl = $("doc-status");
  if (!state.sessionId) { toast(t("teacher.doc.after"), "danger"); return; }
  if (!fichier) { toast(t("teacher.doc.drop"), "danger"); return; }

  statutEl.className = "doc-status doc-status--work mt-4";
  statutEl.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(fichier.name)}…`;
  statutEl.classList.remove("hidden");
  setLoading($("btn-importer"), true, t("teacher.doc.submit"));
  try {
    const data = await uploadFile(`/api/session/${state.sessionId}/document`, fichier, "fichier");
    statutEl.className = "doc-status doc-status--ok mt-4";
    statutEl.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> ${esc(data.statut || "indexe")}`;
    toast(t("teacher.doc.title"), "success");
    await chargerTaches();
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
    statutEl.className = "doc-status mt-4";
    statutEl.innerHTML = `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg> ${esc(err.message || "import impossible")}`;
    toast("Échec de l'import.", "danger");
  } finally {
    setLoading($("btn-importer"), false, t("teacher.doc.submit"));
  }
});

/* ==========================================================================
   2b. RESSOURCES COMPLÉMENTAIRES (contexte IA)
   ========================================================================== */
const inputRes = $("fichier-res");
inputRes.addEventListener("change", () => {
  const f = inputRes.files[0];
  $("dropzone-res-nom").textContent = f ? f.name : t("teacher.res.drop");
  $("btn-res").disabled = !(f && state.sessionId);
});
$("form-res").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fichier = inputRes.files[0];
  if (!state.sessionId || !fichier) return;
  setLoading($("btn-res"), true, t("teacher.res.submit"));
  try {
    await uploadFile(`/api/session/${state.sessionId}/ressource`, fichier, "fichier");
    toast(t("teacher.res.title"), "success");
    inputRes.value = ""; $("dropzone-res-nom").textContent = t("teacher.res.drop");
    await chargerRessources();
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
    toast(err.message || "Dépôt impossible.", "danger");
  } finally {
    setLoading($("btn-res"), false, t("teacher.res.submit"));
    $("btn-res").disabled = true;
  }
});
async function chargerRessources() {
  if (!state.sessionId) return;
  try {
    const data = await getJSON(`/api/session/${state.sessionId}/ressources`);
    rendreRessources(data.ressources || []);
  } catch (_) { /* non bloquant */ }
}
function rendreRessources(ressources) {
  const ul = $("res-list");
  const vide = $("res-empty");
  if (!ressources.length) { ul.innerHTML = ""; vide.classList.remove("hidden"); return; }
  vide.classList.add("hidden");
  ul.innerHTML = ressources.map((r) => `
    <li class="res-item">
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
      <a href="/api/ressource/${esc(r.ressource_id)}" download>${esc(r.nom)}</a>
    </li>`).join("");
}

/* ==========================================================================
   3. ÉDITEUR DE TÂCHES
   ========================================================================== */
async function chargerTaches() {
  if (!state.sessionId) return;
  try {
    const data = await getJSON(`/api/session/${state.sessionId}/taches`);
    const info = await getJSON(`/api/session/${state.sessionId}`);
    rendreTaches(data.taches || [], info.nb_taches || (data.taches || []).length);
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
  }
}
function rendreTaches(taches, cible) {
  const editor = $("taches-editor");
  const vide = $("taches-empty");
  $("taches-count").textContent = t("teacher.tasks.count", { n: taches.length, cible });
  // Contrainte "pas plus / pas moins" reflétée dans l'UI.
  $("btn-ajouter-tache").disabled = taches.length >= cible;
  if (!taches.length) { editor.innerHTML = ""; vide.classList.remove("hidden"); return; }
  vide.classList.add("hidden");
  const suppression = taches.length > 3;
  editor.innerHTML = taches.map((tk, i) => `
    <div class="tache-edit" data-id="${esc(tk.id)}">
      <div class="tache-edit__num" aria-hidden="true">${i + 1}</div>
      <div class="tache-edit__fields">
        <label class="sr-only" for="t-titre-${esc(tk.id)}">Titre ${i + 1}</label>
        <input class="input tache-edit__titre" id="t-titre-${esc(tk.id)}" value="${esc(tk.titre)}" placeholder="${esc(t("teacher.field.titre"))}">
        <label class="sr-only" for="t-cons-${esc(tk.id)}">Consigne ${i + 1}</label>
        <textarea class="textarea tache-edit__consigne" id="t-cons-${esc(tk.id)}" rows="3">${esc(tk.consigne)}</textarea>
        <div class="tache-edit__actions">
          <button class="btn btn--sm btn--accent" type="button" data-act="save">${esc(t("teacher.tasks.save"))}</button>
          <button class="btn btn--sm btn--danger-ghost" type="button" data-act="delete"${suppression ? "" : " disabled"}>${esc(t("teacher.tasks.delete"))}</button>
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
    if (!titre) { toast(t("teacher.err.titre"), "danger"); return; }
    setLoading(btn, true, "…");
    try {
      await patchJSON(`/api/session/${state.sessionId}/taches/${tacheId}`, { titre, consigne });
      toast(t("teacher.tasks.save"), "success");
      ligne.classList.add("is-saved");
      setTimeout(() => ligne.classList.remove("is-saved"), 1200);
    } catch (err) {
      if (err.status === 401) { forcerReconnexion(); return; }
      toast(err.message || "Enregistrement impossible.", "danger");
    } finally { setLoading(btn, false, t("teacher.tasks.save")); }
    return;
  }

  if (btn.dataset.act === "delete") {
    if (btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.textContent = t("teacher.tasks.confirm");
      btn.classList.add("is-armed");
      setTimeout(() => {
        if (btn.dataset.armed === "1") {
          btn.dataset.armed = "0"; btn.textContent = t("teacher.tasks.delete"); btn.classList.remove("is-armed");
        }
      }, 3000);
      return;
    }
    try {
      await deleteJSON(`/api/session/${state.sessionId}/taches/${tacheId}`);
      toast(t("teacher.tasks.delete"), "info");
      await chargerTaches();
    } catch (err) {
      if (err.status === 401) { forcerReconnexion(); return; }
      toast(err.message || "Suppression impossible.", "danger");
    }
  }
});
$("btn-ajouter-tache").addEventListener("click", async () => {
  if (!state.sessionId) { toast(t("teacher.doc.after"), "danger"); return; }
  setLoading($("btn-ajouter-tache"), true, "…");
  try {
    await postJSON(`/api/session/${state.sessionId}/taches`, { titre: t("teacher.tasks.add"), consigne: "" });
    await chargerTaches();
    const lignes = document.querySelectorAll(".tache-edit__titre");
    lignes[lignes.length - 1]?.focus();
  } catch (err) {
    if (err.status === 401) { forcerReconnexion(); return; }
    toast(err.message || "Ajout impossible.", "danger");
  } finally {
    setLoading($("btn-ajouter-tache"), false, t("teacher.tasks.add"));
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
  $("feed").innerHTML = "";
  $("feed-empty").classList.remove("hidden");
  state.socket = new SessionSocket(sessionId, {
    onOpen:        () => setWsStatus(true),
    onClose:       () => setWsStatus(false),
    onDashboard:   (d) => majTableau(d.eleves || []),
    onEleveJoin:   (d) => notifier("connecte", d),
    onTacheUpdate: (d) => notifier(d.statut, d),
    onChat:        (d) => notifier("question", d),
    onMessage:     (type, d) => {
      if (type === "poste_join") notifierPoste(d);
      else if (type === "retard") notifier("retard", d);
    },
  });
  state.socket.connect();
}
function setWsStatus(online) {
  const el = $("ws-status");
  el.classList.toggle("is-online", online);
  el.classList.toggle("is-offline", !online);
  $("ws-status-label").textContent = online ? t("teacher.ws.online") : t("teacher.ws.offline");
}

/* --- Tableau élèves (groupé par poste, homonymes désambiguïsés) --------- */
function majTableau(eleves) {
  state.eleves = eleves;
  const tbody = $("tbody-eleves");
  const vide = $("eleves-empty");
  if (!eleves.length) { tbody.innerHTML = ""; vide.classList.remove("hidden"); }
  else { vide.classList.add("hidden"); tbody.innerHTML = eleves.map(renderLigneEleve).join(""); }
  majKPI(eleves);
  majFiltreEleves(eleves);
}
const STATUT_UI = {
  actif:   { cls: "badge--success", key: "status.actif" },
  bloque:  { cls: "badge--danger",  key: "status.bloque" },
  inactif: { cls: "badge--muted",   key: "status.inactif" },
};
function posteLabel(e) {
  const bits = [];
  if (e.numero_poste != null) bits.push(`P${e.numero_poste}`);
  if (e.classe) bits.push(e.classe);
  return bits.length ? bits.join(" · ") : t("misc.none");
}
function renderLigneEleve(e) {
  const total = e.taches_total || 0;
  const faites = e.taches_completes || 0;
  const pct = total ? Math.round((faites / total) * 100) : 0;
  const ui = STATUT_UI[e.statut] || STATUT_UI.inactif;
  return `
    <tr>
      <td><span class="student-name">${esc(e.label || e.nom)}</span></td>
      <td class="mono">${esc(posteLabel(e))}</td>
      <td class="progress-cell">
        <div class="progress"><div class="progress__bar" style="width:${pct}%"></div></div>
        <div class="progress-cell__meta">${faites} / ${total} · ${pct}%</div>
      </td>
      <td class="cell-step">${esc(e.etape_en_cours || t("misc.none"))}</td>
      <td><span class="badge ${ui.cls}"><span class="badge__dot" aria-hidden="true"></span>${esc(t(ui.key))}</span></td>
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
  $("kpi-connectes").textContent = connectes;
  $("kpi-bloques").textContent = bloques;
  $("kpi-progression").textContent = `${connectes ? Math.round((sommePct / connectes) * 100) : 0}%`;
}
function majFiltreEleves(eleves) {
  const sel = $("filter-eleve");
  const courant = sel.value;
  sel.innerHTML = `<option value="">${esc(t("teacher.filter.allStudents"))}</option>` +
    eleves.map((e) => `<option value="${esc(e.eleve_id)}">${esc(e.label || e.nom)}</option>`).join("");
  sel.value = eleves.some((e) => e.eleve_id === courant) ? courant : "";
  if (sel.value !== state.filterEleve) state.filterEleve = sel.value;
}

/* ==========================================================================
   NOTIFICATIONS TYPÉES + FILTRES
   ========================================================================== */
const NOTIF_META = {
  connecte:  { cls: "connecte",  key: "notif.connected", icon: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>' },
  en_cours:  { cls: "en_cours",  key: "notif.encours",   icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' },
  bloque:    { cls: "bloque",    key: "notif.bloque",    icon: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>' },
  complete:  { cls: "complete",  key: "notif.termine",   icon: '<path d="M20 6 9 17l-5-5"/>' },
  retard:    { cls: "retard",    key: "notif.retard",    icon: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>' },
  question:  { cls: "question",  key: "notif.question",  icon: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>' },
};
function labelFromData(d) {
  let l = d.nom || "Élève";
  if (d.classe) l += " · " + d.classe;
  if (d.numero_poste != null) l += " · P" + d.numero_poste;
  return l;
}
// Construit le message AU MOMENT DU RENDU (pour qu'il suive la langue courante).
function messagePour(item) {
  const qui = item.qui, tache = item.tache || "";
  switch (item.type) {
    case "connecte": return item.poste != null ? t("notif.joined", { qui, poste: item.poste }) : t("notif.joinedSolo", { qui });
    case "en_cours": return t("notif.started", { qui, tache });
    case "bloque":   return t("notif.blocked", { qui, tache });
    case "complete": return t("notif.completed", { qui, tache });
    case "retard":   return t("notif.late", { qui, tache });
    case "question": return t("notif.asked", { qui });
    default:         return qui;
  }
}
function notifier(type, d) {
  if (!NOTIF_META[type]) return;
  ajouterNotif({
    type, statut: type, eleveId: d.eleve_id || "", qui: labelFromData(d),
    tache: d.titre_tache || "", question: d.question || "", ts: Date.now(),
  });
}
function notifierPoste(d) {
  const noms = (d.eleves || []).map((e) => e.nom).join(", ");
  ajouterNotif({
    type: "connecte", statut: "connecte", eleveId: "",
    qui: noms, poste: d.numero, tache: "", question: "", ts: Date.now(),
  });
}
function ajouterNotif(item) {
  state.feedItems.unshift(item);
  if (state.feedItems.length > 60) state.feedItems.pop();
  if (passeFiltre(item)) prependNotif(item);
}
function passeFiltre(item) {
  if (state.filterStatut && item.statut !== state.filterStatut) return false;
  if (state.filterEleve && item.eleveId !== state.filterEleve) return false;
  return true;
}
function nodeNotif(item) {
  const meta = NOTIF_META[item.type] || NOTIF_META.connecte;
  const heure = new Date(item.ts).toLocaleTimeString(window.EduI18n?.getLang() === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" });
  const q = item.question ? `<div class="feed-item__q">« ${esc(item.question)} »</div>` : "";
  const el = document.createElement("div");
  el.className = `feed-item feed-item--${meta.cls}`;
  el.innerHTML = `
    <span class="feed-item__icon feed-item__icon--${meta.cls}" aria-hidden="true">
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${meta.icon}</svg>
    </span>
    <div class="feed-item__body">
      <span class="feed-item__tag feed-item__tag--${meta.cls}">${esc(t(meta.key))}</span>
      <div class="feed-item__text">${esc(messagePour(item))}</div>
      ${q}
      <div class="feed-item__time">${heure}</div>
    </div>`;
  return el;
}
function prependNotif(item) {
  $("feed-empty").classList.add("hidden");
  $("feed").prepend(nodeNotif(item));
  while ($("feed").children.length > 60) $("feed").lastElementChild.remove();
}
function renderFeed() {
  const feed = $("feed");
  feed.innerHTML = "";
  const filtres = state.feedItems.filter(passeFiltre);
  if (!filtres.length) { $("feed-empty").classList.remove("hidden"); return; }
  $("feed-empty").classList.add("hidden");
  filtres.forEach((it) => feed.appendChild(nodeNotif(it)));
}

/* Filtres : sélecteurs + KPI cliquables */
$("filter-statut").addEventListener("change", (e) => { state.filterStatut = e.target.value; majKpiPressed(); renderFeed(); });
$("filter-eleve").addEventListener("change", (e) => { state.filterEleve = e.target.value; renderFeed(); });
document.querySelectorAll(".kpi--action").forEach((btn) => {
  btn.addEventListener("click", () => {
    const f = btn.dataset.filter;
    state.filterStatut = state.filterStatut === f ? "" : f;
    $("filter-statut").value = state.filterStatut;
    majKpiPressed();
    renderFeed();
  });
});
function majKpiPressed() {
  document.querySelectorAll(".kpi--action").forEach((btn) => {
    const on = btn.dataset.filter === state.filterStatut;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("is-pressed", on);
  });
}

/* --- Utilitaires --------------------------------------------------------- */
function formaterDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const loc = window.EduI18n?.getLang() === "en" ? "en-GB" : "fr-FR";
  return d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit" })
       + " " + d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
}

/* Re-rendu au changement de langue */
window.addEventListener("edu:langchange", () => {
  if (state.eleves.length) majTableau(state.eleves);
  renderFeed();
  if (state.sessionId) chargerTaches();
  chargerRessources();
});

/* ==========================================================================
   INITIALISATION
   ========================================================================== */
(async function init() {
  if (getTokenEnseignant()) {
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
