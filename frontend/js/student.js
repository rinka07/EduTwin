/* ==========================================================================
   EduTwin — student.js  (espace élève, gestion multi-élèves par poste)

   1. Connexion POSTE  → POST /api/session/{sid}/poste/join (1 à 3 élèves)
   2. Vue TP partagée  → sélecteur d'élève actif, répartition des étapes,
                         minuteur par étape, blocage conditionné au chatbot,
                         verrouillage « Terminé »
   3. Chat IA          → POST /api/chat (par élève actif)
   4. Reprise          → GET /api/poste/{pid} après déconnexion

   L'API figée (PATCH /api/eleve/{id}/tache/{id}) reste inchangée : la
   progression demeure suivie individuellement par élève.
   ========================================================================== */

import { postJSON, patchJSON, putJSON, getJSON } from "./api.js";

const t = (k, p) => (window.EduI18n ? window.EduI18n.t(k, p) : k);

/* Clés de persistance : garde le poste + son état après une actualisation. */
const CLE_POSTE = "edutwin_poste";
const cleEtat = (pid) => `edutwin_poste_state_${pid}`;

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
  posteId: null,
  numero: null,
  classe: null,
  eleves: [],                 // [{ eleve_id, nom }]
  activeEleveId: null,
  taches: [],                 // [{ id, titre, consigne }]
  tempsParTache: 0,           // minutes
  statuts: new Map(),         // eleveId → Map(tacheId → statut)
  assignations: new Map(),    // tacheId → eleveId
  hasChatted: new Set(),      // eleveId ayant consulté l'assistant
  timerStarts: new Map(),     // `${eleveId}:${tacheId}` → ts (ms) de démarrage
  timerOver: new Set(),       // `${eleveId}:${tacheId}` déjà signalés en retard
  chatLogs: new Map(),        // eleveId → [{ role, texte, ts }]
  pendingConsultTache: null,  // tâche pour laquelle l'élève va consulter l'IA
};

const activeStatuts = () => {
  if (!state.statuts.has(state.activeEleveId)) state.statuts.set(state.activeEleveId, new Map());
  return state.statuts.get(state.activeEleveId);
};
const nomEleve = (id) => (state.eleves.find((e) => e.eleve_id === id)?.nom) || "";

/* ==========================================================================
   1. CONNEXION AU POSTE
   ========================================================================== */
(function prefillSession() {
  const s = new URLSearchParams(location.search).get("session");
  if (s) document.getElementById("session_id").value = s.trim();
})();

/* Champs d'élèves dynamiques (1 à 3) */
const elevesFields = document.getElementById("eleves-fields");
const btnAddEleve = document.getElementById("btn-add-eleve");

function ligneEleve() {
  const row = document.createElement("div");
  row.className = "eleve-row";
  row.innerHTML = `
    <input class="input eleve-nom" type="text" autocomplete="off"
           data-i18n-attr="placeholder:student.eleve.placeholder"
           placeholder="${esc(t("student.eleve.placeholder"))}">
    <button class="btn btn--sm btn--danger-ghost eleve-remove" type="button"
            aria-label="${esc(t("student.eleve.remove"))}">
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>`;
  return row;
}
function majBoutonsEleves() {
  const rows = elevesFields.querySelectorAll(".eleve-row");
  rows.forEach((r) => r.querySelector(".eleve-remove").style.display = rows.length > 1 ? "" : "none");
  btnAddEleve.disabled = rows.length >= 3;
}
elevesFields.appendChild(ligneEleve());
majBoutonsEleves();

btnAddEleve.addEventListener("click", () => {
  if (elevesFields.querySelectorAll(".eleve-row").length >= 3) return;
  const row = ligneEleve();
  elevesFields.appendChild(row);
  row.querySelector(".eleve-nom").focus();
  majBoutonsEleves();
});
elevesFields.addEventListener("click", (e) => {
  const btn = e.target.closest(".eleve-remove");
  if (!btn) return;
  btn.closest(".eleve-row").remove();
  majBoutonsEleves();
});

const formJoin = document.getElementById("form-join");
const btnJoin = document.getElementById("btn-join");

formJoin.addEventListener("submit", async (e) => {
  e.preventDefault();
  ["err-code", "err-session", "err-eleves", "err-join"].forEach((id) => (document.getElementById(id).textContent = ""));

  const code_acces = document.getElementById("code_acces").value.trim().toUpperCase();
  const session_id = document.getElementById("session_id").value.trim();
  const classe = document.getElementById("classe").value.trim();
  const numeroRaw = document.getElementById("numero").value.trim();
  const noms = [...elevesFields.querySelectorAll(".eleve-nom")]
    .map((i) => i.value.trim()).filter(Boolean);

  if (!code_acces) { erreurChamp("err-code", t("student.err.code"), "code_acces"); return; }
  if (!session_id) { erreurChamp("err-session", t("student.err.session"), "session_id"); return; }
  if (!noms.length) { document.getElementById("err-eleves").textContent = t("student.err.noeleve"); return; }

  setLoading(btnJoin, true, t("student.join.submit"));
  try {
    const body = { code_acces, eleves: noms };
    if (classe) body.classe = classe;
    if (numeroRaw) body.numero = parseInt(numeroRaw, 10);
    const data = await postJSON(`/api/session/${encodeURIComponent(session_id)}/poste/join`, body);

    initEtatDepuisJoin(session_id, data);
    localStorage.setItem(CLE_POSTE, JSON.stringify({ posteId: state.posteId }));
    entrerVueTP();
    toast(t("student.welcome", { noms: noms.join(", ") }), "success");
  } catch (err) {
    const msg = (err.status === 400 || err.status === 403) ? t("student.err.code.invalid") : (err.message || t("student.err.join"));
    document.getElementById("err-join").textContent = msg;
    toast(msg, "danger");
  } finally {
    setLoading(btnJoin, false, t("student.join.submit"));
  }
});

function erreurChamp(idErreur, message, idChamp) {
  document.getElementById(idErreur).textContent = message;
  document.getElementById(idChamp)?.focus();
}

function initEtatDepuisJoin(sessionId, data) {
  state.sessionId = sessionId;
  state.posteId = data.poste_id;
  state.numero = data.numero;
  state.classe = data.classe;
  state.eleves = data.eleves || [];
  state.taches = data.taches || [];
  state.tempsParTache = data.temps_par_tache || 0;
  state.activeEleveId = state.eleves[0]?.eleve_id || null;
  state.statuts = new Map();
  state.eleves.forEach((el) => state.statuts.set(el.eleve_id, new Map()));
}

/* ==========================================================================
   2. VUE TP
   ========================================================================== */
function entrerVueTP() {
  document.getElementById("ecran-join").classList.add("hidden");
  document.getElementById("ecran-tp").classList.remove("hidden");
  document.getElementById("btn-quitter")?.classList.remove("hidden");
  majEntetePoste();
  renderSwitcher();
  renderTaches();
  majProgression();
  renderChat();
  document.getElementById("question").focus();
  demarrerMinuteurs();
}

function majEntetePoste() {
  const bits = [];
  if (state.numero != null) bits.push(`${t("teacher.col.poste")} ${state.numero}`);
  if (state.classe) bits.push(state.classe);
  document.getElementById("header-poste").textContent = bits.join(" · ");
}

/* --- Sélecteur d'élève actif ------------------------------------------- */
function renderSwitcher() {
  const wrap = document.getElementById("eleve-switcher");
  const card = document.getElementById("switcher-card");
  // Un seul élève : pas de sélecteur (poste individuel).
  if (state.eleves.length <= 1) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const label = `<span class="eleve-switcher__label">${esc(t("student.active.label"))} :</span>`;
  wrap.innerHTML = label + state.eleves.map((el) => {
    const actif = el.eleve_id === state.activeEleveId;
    return `<button class="eleve-tab${actif ? " is-active" : ""}" type="button"
      data-eleve="${esc(el.eleve_id)}" aria-pressed="${actif}">${esc(el.nom)}</button>`;
  }).join("");
}
document.getElementById("eleve-switcher").addEventListener("click", (e) => {
  const btn = e.target.closest(".eleve-tab");
  if (!btn) return;
  state.activeEleveId = btn.dataset.eleve;
  renderSwitcher();
  renderTaches();
  majProgression();
  renderChat();
  persistEtat();
});

/* --- Rendu des tâches --------------------------------------------------- */
function renderTaches() {
  const liste = document.getElementById("task-list");
  if (!state.taches.length) {
    liste.innerHTML = `
      <div class="empty">
        <svg class="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>
        <span class="empty__title">${esc(t("student.empty.title"))}</span>
        <span class="text-sm">${esc(t("student.empty.desc"))}</span>
      </div>`;
    return;
  }
  liste.innerHTML = state.taches.map((tache, i) => renderTache(tache, i + 1)).join("");
}

function renderTache(tache, num) {
  const statuts = activeStatuts();
  const statut = statuts.get(tache.id) || "";
  const assignedTo = state.assignations.get(tache.id) || "";
  const isMine = assignedTo === state.activeEleveId;
  const editable = !assignedTo || isMine;
  const locked = statut === "complete";
  const consulted = state.hasChatted.has(state.activeEleveId);

  const options = [`<option value="">${esc(t("student.assign.none"))}</option>`]
    .concat(state.eleves.map((el) =>
      `<option value="${esc(el.eleve_id)}"${el.eleve_id === assignedTo ? " selected" : ""}>${esc(el.nom)}</option>`))
    .join("");

  const btn = (val, labelKey, extraCls = "", extraAttr = "") => {
    const disabled = !editable || (locked && val !== "complete");
    return `<button class="btn btn--sm btn--ghost status-btn${statut === val ? " is-active" : ""}${extraCls}"
             type="button" data-tache="${esc(tache.id)}" data-value="${val}"
             aria-pressed="${statut === val}"${disabled ? " disabled" : ""}${extraAttr}>${esc(t(labelKey))}</button>`;
  };
  // Bouton « Bloqué » : verrou tant que l'assistant n'a pas été consulté.
  const gated = editable && !locked && !consulted;
  const bloqueBtn = `<button class="btn btn--sm btn--ghost status-btn${statut === "bloque" ? " is-active" : ""}${gated ? " is-gated" : ""}"
      type="button" data-tache="${esc(tache.id)}" data-value="bloque"
      aria-pressed="${statut === "bloque"}"${(!editable || locked) ? " disabled" : ""}
      ${gated ? `title="${esc(t("student.blocked.hint"))}"` : ""}>
      ${gated ? '<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ' : ""}${esc(t("student.status.bloque"))}</button>`;

  const timer = (state.tempsParTache > 0)
    ? `<span class="task-timer" id="timer-${esc(tache.id)}" data-tache="${esc(tache.id)}">
         <svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/></svg>
         <span class="task-timer__text">${esc(t("student.timer.label"))} ${state.tempsParTache} min</span>
       </span>`
    : "";

  const badge = isMine
    ? `<span class="badge badge--info task__mine"><span class="badge__dot" aria-hidden="true"></span>${esc(t("student.badge.mine"))}</span>`
    : "";
  const hint = locked ? t("student.locked.hint") : (!editable ? t("student.notMine.hint") : "");

  return `
    <article class="task${isMine ? " task--mine" : ""}${!editable ? " task--other" : ""}" data-statut="${esc(statut)}" data-id="${esc(tache.id)}">
      <div class="task__head">
        <div class="task__title-wrap">
          <span class="task__num" aria-hidden="true">${num}</span>
          <h3 class="task__title">${esc(tache.titre)}</h3>
        </div>
        ${badge}
      </div>
      <pre class="task__consigne">${esc(tache.consigne)}</pre>
      <div class="task__meta">
        <label class="task__assign">
          <span class="task__assign-label">${esc(t("student.assignTo"))}</span>
          <select class="select task__assign-select" data-tache="${esc(tache.id)}">${options}</select>
        </label>
        ${timer}
      </div>
      <div class="task__actions" role="group" aria-label="${esc(t("student.tasks"))}">
        ${btn("en_cours", "student.status.encours")}
        ${bloqueBtn}
        ${btn("complete", "student.status.termine")}
      </div>
      ${hint ? `<p class="task__hint">${esc(hint)}</p>` : ""}
    </article>`;
}

/* --- Actions sur les tâches -------------------------------------------- */
document.getElementById("task-list").addEventListener("click", async (e) => {
  const btn = e.target.closest(".status-btn");
  if (!btn || btn.disabled) return;
  const tacheId = btn.dataset.tache;
  const statut = btn.dataset.value;
  const statuts = activeStatuts();
  const ancien = statuts.get(tacheId);

  // Blocage conditionné : première tentative de « Bloqué » sans avoir consulté
  // l'assistant → on redirige vers le chat au lieu de bloquer.
  if (statut === "bloque" && !state.hasChatted.has(state.activeEleveId)) {
    state.pendingConsultTache = tacheId;
    const tache = state.taches.find((x) => x.id === tacheId);
    const champ = document.getElementById("question");
    champ.value = t("chat.prefill", { tache: tache ? tache.titre : "" });
    champ.focus();
    toast(t("student.blocked.hint"), "info");
    return;
  }

  if (ancien === statut) return;

  statuts.set(tacheId, statut);
  gererMinuteur(tacheId, statut);
  majTacheUI(tacheId);
  majProgression();
  persistEtat();

  try {
    await patchJSON(`/api/eleve/${state.activeEleveId}/tache/${tacheId}`, { statut });
  } catch (err) {
    // Rollback (dont 409 = tâche verrouillée côté serveur).
    statuts.set(tacheId, ancien);
    majTacheUI(tacheId);
    majProgression();
    persistEtat();
    toast(err.status === 409 ? t("student.locked.hint") : (err.message || "Mise à jour impossible."), "danger");
  }
});

/* Répartition d'une étape à un élève du poste */
document.getElementById("task-list").addEventListener("change", async (e) => {
  const sel = e.target.closest(".task__assign-select");
  if (!sel) return;
  const tacheId = sel.dataset.tache;
  const eleveId = sel.value;
  const ancien = state.assignations.get(tacheId) || "";
  if (eleveId) state.assignations.set(tacheId, eleveId);
  else state.assignations.delete(tacheId);
  renderTaches();
  try {
    if (eleveId) await putJSON(`/api/poste/${state.posteId}/assignation`, { tache_id: tacheId, eleve_id: eleveId });
  } catch (err) {
    if (ancien) state.assignations.set(tacheId, ancien); else state.assignations.delete(tacheId);
    renderTaches();
    toast(err.message || "Assignation impossible.", "danger");
  }
});

function majTacheUI(tacheId) {
  // Rendu ciblé d'une seule tâche (sobriété : évite de tout reconstruire).
  const num = state.taches.findIndex((x) => x.id === tacheId) + 1;
  const tache = state.taches.find((x) => x.id === tacheId);
  const article = document.querySelector(`.task[data-id="${CSS.escape(tacheId)}"]`);
  if (!article || !tache) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = renderTache(tache, num);
  article.replaceWith(tmp.firstElementChild);
}

function majProgression() {
  const statuts = activeStatuts();
  const total = state.taches.length;
  const faites = [...statuts.values()].filter((s) => s === "complete").length;
  const pct = total ? Math.round((faites / total) * 100) : 0;
  document.getElementById("progress-label").textContent = `${faites} / ${total}`;
  document.getElementById("progress-global-bar").style.width = `${pct}%`;
  document.getElementById("progress-pct").textContent = `${pct}%`;
}

/* ==========================================================================
   Minuteur par étape (alerte sans bloquer)
   ========================================================================== */
let minuteurInterval = null;
function cleTimer(tacheId) { return `${state.activeEleveId}:${tacheId}`; }

function gererMinuteur(tacheId, statut) {
  const cle = cleTimer(tacheId);
  if (statut === "en_cours") {
    if (!state.timerStarts.has(cle)) state.timerStarts.set(cle, Date.now());
  } else {
    state.timerStarts.delete(cle);
    state.timerOver.delete(cle);
  }
}

function demarrerMinuteurs() {
  if (minuteurInterval || state.tempsParTache <= 0) return;
  minuteurInterval = setInterval(tickMinuteurs, 1000);
  tickMinuteurs();
}

function tickMinuteurs() {
  if (state.tempsParTache <= 0) return;
  const budgetMs = state.tempsParTache * 60 * 1000;
  const statuts = activeStatuts();
  state.taches.forEach((tache) => {
    const el = document.getElementById(`timer-${cssId(tache.id)}`);
    if (!el) return;
    const cle = cleTimer(tache.id);
    const txt = el.querySelector(".task-timer__text");
    if (statuts.get(tache.id) === "en_cours" && state.timerStarts.has(cle)) {
      const reste = budgetMs - (Date.now() - state.timerStarts.get(cle));
      if (reste <= 0) {
        el.classList.add("is-over");
        txt.textContent = t("student.timer.over");
        if (!state.timerOver.has(cle)) {
          state.timerOver.add(cle);
          signalerRetard(tache);
        }
      } else {
        el.classList.remove("is-over");
        el.classList.add("is-running");
        txt.textContent = `${formatMMSS(reste)} ${t("student.timer.remaining")}`;
      }
    } else {
      el.classList.remove("is-over", "is-running");
      txt.textContent = `${t("student.timer.label")} ${state.tempsParTache} min`;
    }
  });
}

function cssId(id) { return String(id).replace(/"/g, '\\"'); }
function formatMMSS(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function signalerRetard(tache) {
  toast(t("student.timer.overToast", { tache: tache.titre }), "info");
  try { await postJSON(`/api/eleve/${state.activeEleveId}/tache/${tache.id}/retard`, {}); }
  catch (_) { /* alerte best-effort */ }
  persistEtat();
}

/* ==========================================================================
   3. CHAT IA (par élève actif)
   ========================================================================== */
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("question");
const chatLog = document.getElementById("chat-log");
const btnChat = document.getElementById("btn-chat");

chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatForm.requestSubmit(); }
});

function logsActifs() {
  if (!state.chatLogs.has(state.activeEleveId)) state.chatLogs.set(state.activeEleveId, []);
  return state.chatLogs.get(state.activeEleveId);
}

function renderChat() {
  chatLog.innerHTML = "";
  const logs = logsActifs();
  if (!logs.length) { ajouterBulle(t("chat.hello"), "ai", null, false); return; }
  logs.forEach((m) => ajouterBulle(m.texte, m.role, m.ts, false));
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;

  ajouterBulle(question, "user");
  logsActifs().push({ role: "user", texte: question });
  chatInput.value = "";
  chatInput.style.height = "auto";
  chatInput.focus();

  // Consultation de l'assistant → débloque le bouton « Bloqué » pour cet élève.
  const premiereConsult = !state.hasChatted.has(state.activeEleveId);
  state.hasChatted.add(state.activeEleveId);
  state.pendingConsultTache = null;
  if (premiereConsult) renderTaches();
  persistEtat();

  const penseur = ajouterTyping();
  btnChat.disabled = true;
  try {
    const data = await postJSON("/api/chat", {
      eleve_id: state.activeEleveId, session_id: state.sessionId, question,
    });
    penseur.remove();
    const rep = data.reponse || "(réponse vide)";
    ajouterBulle(rep, "ai", data.timestamp);
    logsActifs().push({ role: "ai", texte: rep, ts: data.timestamp });
    persistEtat();
  } catch (err) {
    penseur.remove();
    ajouterBulle(t("chat.error"), "ai");
    toast(t("chat.unavailable"), "danger");
  } finally {
    btnChat.disabled = false;
  }
});

function ajouterBulle(texte, role, timestamp, scroll = true) {
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
  if (scroll) chatLog.scrollTop = chatLog.scrollHeight;
}
function ajouterTyping() {
  const el = document.createElement("div");
  el.className = "chat-bubble chat-bubble--ai";
  el.setAttribute("aria-label", "…");
  el.innerHTML = `<span class="typing" aria-hidden="true"><span></span><span></span><span></span></span>`;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}
function formaterHeure(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(window.EduI18n?.getLang() === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/* ==========================================================================
   PERSISTANCE & REPRISE APRÈS DÉCONNEXION
   ========================================================================== */
function persistEtat() {
  if (!state.posteId) return;
  try {
    localStorage.setItem(cleEtat(state.posteId), JSON.stringify({
      activeEleveId: state.activeEleveId,
      hasChatted: [...state.hasChatted],
      timerStarts: Object.fromEntries(state.timerStarts),
      timerOver: [...state.timerOver],
      chatLogs: Object.fromEntries([...state.chatLogs].map(([k, v]) => [k, v.slice(-30)])),
    }));
  } catch (_) {}
}

function restaurerEtatLocal() {
  try {
    const raw = localStorage.getItem(cleEtat(state.posteId));
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.activeEleveId && state.eleves.some((e) => e.eleve_id === s.activeEleveId)) state.activeEleveId = s.activeEleveId;
    state.hasChatted = new Set(s.hasChatted || []);
    state.timerStarts = new Map(Object.entries(s.timerStarts || {}));
    state.timerOver = new Set(s.timerOver || []);
    state.chatLogs = new Map(Object.entries(s.chatLogs || {}).map(([k, v]) => [k, v]));
  } catch (_) {}
}

function quitterSession() {
  if (state.posteId) localStorage.removeItem(cleEtat(state.posteId));
  localStorage.removeItem(CLE_POSTE);
  location.reload();
}
document.getElementById("btn-quitter")?.addEventListener("click", quitterSession);

(async function restaurerPoste() {
  let sauvegarde = null;
  try { sauvegarde = JSON.parse(localStorage.getItem(CLE_POSTE) || "null"); } catch (_) {}
  if (!sauvegarde?.posteId) return;

  try {
    const data = await getJSON(`/api/poste/${encodeURIComponent(sauvegarde.posteId)}`);
    state.sessionId = data.session_id;
    state.posteId = data.poste_id;
    state.numero = data.numero;
    state.classe = data.classe;
    state.tempsParTache = data.temps_par_tache || 0;
    state.taches = data.taches || [];
    state.eleves = (data.eleves || []).map((e) => ({ eleve_id: e.eleve_id, nom: e.nom }));
    state.statuts = new Map();
    (data.eleves || []).forEach((e) => {
      const m = new Map();
      (e.progression || []).forEach((p) => m.set(p.tache_id, p.statut));
      state.statuts.set(e.eleve_id, m);
    });
    state.assignations = new Map((data.assignations || []).map((a) => [a.tache_id, a.eleve_id]));
    state.activeEleveId = state.eleves[0]?.eleve_id || null;
    restaurerEtatLocal();
    entrerVueTP();
  } catch (_) {
    localStorage.removeItem(CLE_POSTE);
  }
})();

/* Re-rendu au changement de langue (contenus dynamiques). */
window.addEventListener("edu:langchange", () => {
  if (!document.getElementById("ecran-tp").classList.contains("hidden")) {
    renderSwitcher(); renderTaches(); majProgression(); renderChat(); majEntetePoste();
  }
  // Rafraîchit les placeholders des champs d'élèves de l'écran de connexion.
  elevesFields.querySelectorAll(".eleve-nom").forEach((i) => (i.placeholder = t("student.eleve.placeholder")));
});
