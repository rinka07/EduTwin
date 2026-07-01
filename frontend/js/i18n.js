/* ==========================================================================
   EduTwin — i18n.js  (bilingue FR / EN, hors-ligne, sans dépendance)
   Script CLASSIQUE (chargé avant les modules) : expose window.EduI18n.

   Utilisation dans le HTML :
     data-i18n="cle"                     → remplace le textContent
     data-i18n-attr="placeholder:cle"    → remplace un/des attribut(s)
   Utilisation dans le JS (modules) :
     EduI18n.t("cle", { nom: "Amina" })  → chaîne traduite + interpolation
     EduI18n.getLang() / EduI18n.setLang("en")
     window.addEventListener("edu:langchange", () => rerender())
   ========================================================================== */
(function () {
  "use strict";

  var CLE = "edutwin_lang";
  var DEFAUT = "fr";

  var TRAD = {
    fr: {
      /* --- Commun / en-tête --- */
      "brand.sub": "Assistant de TP · LAN · Hors-ligne",
      "lang.label": "Langue",
      "lang.fr": "Français",
      "lang.en": "English",
      "nav.skip": "Aller au contenu principal",

      /* --- Accueil (index) --- */
      "home.welcome": "Bienvenue sur EduTwin",
      "home.subtitle": "Choisissez votre espace pour démarrer un TP d'informatique.",
      "home.teacher.title": "Espace Enseignant",
      "home.teacher.desc": "Créez une session, importez la fiche TP et suivez la progression des élèves en temps réel.",
      "home.teacher.cta": "Ouvrir l'espace enseignant",
      "home.student.title": "Espace Élève",
      "home.student.desc": "Rejoignez la session avec votre code d'accès, suivez les tâches et posez vos questions à l'assistant.",
      "home.student.cta": "Rejoindre une session",
      "home.footer": "EduTwin fonctionne 100 % en local sur votre réseau — aucune connexion Internet requise.",

      /* --- Élève : connexion poste --- */
      "student.title": "Espace Élève",
      "student.join.title": "Rejoindre depuis ce poste",
      "student.join.intro": "Un poste peut être partagé par 1 à 3 élèves. Indiquez qui travaille sur cette machine.",
      "student.field.code": "Code d'accès",
      "student.field.code.hint": "Communiqué par votre enseignant.",
      "student.field.session": "Identifiant de session",
      "student.field.session.hint": "Se remplit automatiquement via le lien de l'enseignant (?session=…).",
      "student.field.classe": "Classe (optionnel)",
      "student.field.numero": "N° de poste (optionnel)",
      "student.field.numero.hint": "Laissez vide pour une numérotation automatique.",
      "student.eleves.legend": "Élèves sur ce poste",
      "student.eleve.placeholder": "Nom de l'élève",
      "student.eleve.add": "Ajouter un élève",
      "student.eleve.remove": "Retirer",
      "student.join.submit": "Rejoindre",
      "student.err.code": "Saisissez le code d'accès.",
      "student.err.session": "L'identifiant de session est requis.",
      "student.err.noeleve": "Indiquez au moins un élève.",
      "student.err.code.invalid": "Code d'accès invalide.",
      "student.err.join": "Connexion impossible.",
      "student.welcome": "Poste connecté : {noms}",

      /* --- Élève : vue TP --- */
      "student.tp.title": "Mon TP",
      "student.tp.subtitle": "Mettez à jour votre avancement et posez vos questions à l'assistant.",
      "student.note": "EduTwin ne remplace pas votre éditeur de code : gardez votre IDE ouvert à côté et codez-y. Ici, mettez à jour votre avancement et demandez des indices.",
      "student.active.label": "Élève actif",
      "student.tasks": "Tâches",
      "student.assignTo": "Assigné à",
      "student.assign.none": "Non assigné",
      "student.badge.mine": "À toi",
      "student.status.encours": "En cours",
      "student.status.bloque": "Bloqué",
      "student.status.termine": "Terminé",
      "student.blocked.hint": "Consulte d'abord l'assistant pour débloquer ce bouton.",
      "student.locked.hint": "Tâche terminée : statut verrouillé.",
      "student.notMine.hint": "Cette étape est assignée à un autre élève du poste.",
      "student.timer.label": "Temps imparti",
      "student.timer.remaining": "restant",
      "student.timer.over": "Temps dépassé",
      "student.timer.overToast": "Temps dépassé sur « {tache} ». Continue, l'enseignant est prévenu.",
      "student.empty.title": "Aucune tâche pour l'instant",
      "student.empty.desc": "L'enseignant n'a pas encore importé la fiche TP.",
      "student.progress": "Progression",
      "student.quit": "Quitter",

      /* --- Élève : chat --- */
      "chat.title": "Assistant EduTwin",
      "chat.sub": "Des indices, jamais la solution toute faite.",
      "chat.hello": "Bonjour ! Pose-moi une question sur une tâche et je te guiderai pas à pas.",
      "chat.placeholder": "Posez votre question…",
      "chat.send": "Envoyer la question",
      "chat.prefill": "J'ai besoin d'aide sur : {tache}. ",
      "chat.unavailable": "L'assistant est indisponible.",
      "chat.error": "Désolé, je n'ai pas pu répondre. Réessaie dans un instant.",

      /* --- Enseignant : login --- */
      "teacher.title": "Espace Enseignant",
      "teacher.login.intro": "Accès réservé. Saisissez le mot de passe pour gérer vos séances de TP.",
      "teacher.password": "Mot de passe",
      "teacher.err.password": "Saisissez le mot de passe.",
      "teacher.login.submit": "Se connecter",
      "teacher.login.error": "Mot de passe incorrect.",
      "teacher.logout": "Déconnexion",
      "teacher.welcome": "Bienvenue dans l'espace enseignant.",

      /* --- Enseignant : configuration --- */
      "teacher.subtitle": "Créez une session, importez la fiche TP, ajustez les tâches puis suivez la progression en temps réel.",
      "teacher.histo.title": "Historique des séances",
      "teacher.histo.empty.title": "Aucune séance",
      "teacher.histo.empty.desc": "Créez votre première session ci-dessous.",
      "teacher.session.title": "1. Nouvelle session",
      "teacher.field.titre": "Titre du TP",
      "teacher.field.duree": "Durée (min)",
      "teacher.field.nbtaches": "Nb tâches",
      "teacher.field.nbtaches.hint": "Minimum 3 étapes. La durée est répartie équitablement entre les étapes.",
      "teacher.session.submit": "Créer la session",
      "teacher.err.titre": "Le titre du TP est obligatoire.",
      "teacher.err.nbtaches": "Le nombre de tâches doit être d'au moins 3.",
      "teacher.code.label": "Code d'accès élève",
      "teacher.code.copy": "Copier le code",
      "teacher.code.copied": "Copié !",
      "teacher.link.copy": "Copier le lien élève",
      "teacher.link.copied": "Lien copié !",
      "teacher.doc.title": "2. Fiche TP",
      "teacher.doc.drop": "Choisir un fichier PDF ou Word",
      "teacher.doc.hint": "Le texte sera extrait et découpé en tâches.",
      "teacher.doc.submit": "Importer et indexer",
      "teacher.doc.after": "Créez d'abord la session, puis importez la fiche.",
      "teacher.res.title": "Ressources complémentaires",
      "teacher.res.hint": "Déposez des documents sources (consignes, exemples…) pour aider l'IA à mieux cadrer le TP.",
      "teacher.res.drop": "Ajouter un document (PDF, Word, texte…)",
      "teacher.res.submit": "Déposer la ressource",
      "teacher.res.empty": "Aucune ressource déposée.",
      "teacher.tasks.title": "3. Tâches du TP",
      "teacher.tasks.hint": "Ajustez les tâches proposées par l'assistant IA : modifiez le titre ou la consigne, ajoutez ou supprimez une étape.",
      "teacher.tasks.count": "{n} / {cible} étapes",
      "teacher.tasks.empty.title": "Aucune tâche",
      "teacher.tasks.empty.desc": "Importez une fiche TP ou ajoutez les tâches manuellement.",
      "teacher.tasks.add": "Ajouter une tâche",
      "teacher.tasks.save": "Enregistrer",
      "teacher.tasks.delete": "Supprimer",
      "teacher.tasks.confirm": "Confirmer ?",

      /* --- Enseignant : dashboard --- */
      "teacher.dashboard.title": "Dashboard temps réel",
      "teacher.ws.online": "En ligne",
      "teacher.ws.offline": "Reconnexion…",
      "teacher.kpi.connected": "Élèves connectés",
      "teacher.kpi.blocked": "Élèves bloqués",
      "teacher.kpi.progress": "Progression moyenne",
      "teacher.students": "Élèves",
      "teacher.col.student": "Élève",
      "teacher.col.poste": "Poste",
      "teacher.col.progress": "Progression",
      "teacher.col.step": "Étape en cours",
      "teacher.col.status": "Statut",
      "teacher.students.empty.title": "Aucun élève connecté",
      "teacher.students.empty.desc": "Communiquez le code d'accès pour que les élèves rejoignent.",
      "teacher.feed.title": "Notifications",
      "teacher.feed.empty.title": "En attente d'activité",
      "teacher.feed.empty.desc": "Les connexions, avancées et questions apparaîtront ici.",
      "teacher.filter.byStatus": "Filtrer par statut",
      "teacher.filter.byStudent": "Filtrer par élève",
      "teacher.filter.all": "Tous",
      "teacher.filter.allStudents": "Tous les élèves",

      /* --- Statuts / notifications (labels) --- */
      "status.actif": "Actif",
      "status.bloque": "Bloqué",
      "status.inactif": "Inactif",
      "notif.connected": "Connecté",
      "notif.encours": "En cours",
      "notif.bloque": "Bloqué",
      "notif.termine": "Terminé",
      "notif.retard": "Retard",
      "notif.question": "Question",
      "notif.joined": "{qui} a rejoint le poste {poste}.",
      "notif.joinedSolo": "{qui} a rejoint la session.",
      "notif.started": "{qui} a démarré « {tache} ».",
      "notif.blocked": "{qui} est bloqué·e sur « {tache} ».",
      "notif.completed": "{qui} a terminé « {tache} ».",
      "notif.late": "{qui} dépasse le temps sur « {tache} ».",
      "notif.asked": "{qui} a posé une question :",

      /* --- Divers --- */
      "misc.step": "Étape",
      "misc.none": "—"
    },

    en: {
      "brand.sub": "Lab assistant · LAN · Offline",
      "lang.label": "Language",
      "lang.fr": "Français",
      "lang.en": "English",
      "nav.skip": "Skip to main content",

      "home.welcome": "Welcome to EduTwin",
      "home.subtitle": "Choose your space to start a computer-science lab.",
      "home.teacher.title": "Teacher Space",
      "home.teacher.desc": "Create a session, import the lab sheet and track student progress in real time.",
      "home.teacher.cta": "Open the teacher space",
      "home.student.title": "Student Space",
      "home.student.desc": "Join the session with your access code, follow the tasks and ask the assistant.",
      "home.student.cta": "Join a session",
      "home.footer": "EduTwin runs 100% locally on your network — no Internet connection required.",

      "student.title": "Student Space",
      "student.join.title": "Join from this workstation",
      "student.join.intro": "A workstation can be shared by 1 to 3 students. Enter who works on this machine.",
      "student.field.code": "Access code",
      "student.field.code.hint": "Provided by your teacher.",
      "student.field.session": "Session ID",
      "student.field.session.hint": "Auto-filled via the teacher's link (?session=…).",
      "student.field.classe": "Class (optional)",
      "student.field.numero": "Workstation no. (optional)",
      "student.field.numero.hint": "Leave empty for automatic numbering.",
      "student.eleves.legend": "Students on this workstation",
      "student.eleve.placeholder": "Student name",
      "student.eleve.add": "Add a student",
      "student.eleve.remove": "Remove",
      "student.join.submit": "Join",
      "student.err.code": "Enter the access code.",
      "student.err.session": "The session ID is required.",
      "student.err.noeleve": "Enter at least one student.",
      "student.err.code.invalid": "Invalid access code.",
      "student.err.join": "Unable to connect.",
      "student.welcome": "Workstation connected: {noms}",

      "student.tp.title": "My Lab",
      "student.tp.subtitle": "Update your progress and ask the assistant your questions.",
      "student.note": "EduTwin does not replace your code editor: keep your IDE open beside it and code there. Here, update your progress and ask for hints.",
      "student.active.label": "Active student",
      "student.tasks": "Tasks",
      "student.assignTo": "Assigned to",
      "student.assign.none": "Unassigned",
      "student.badge.mine": "Yours",
      "student.status.encours": "In progress",
      "student.status.bloque": "Blocked",
      "student.status.termine": "Done",
      "student.blocked.hint": "Ask the assistant first to unlock this button.",
      "student.locked.hint": "Task done: status locked.",
      "student.notMine.hint": "This step is assigned to another student on the workstation.",
      "student.timer.label": "Time allotted",
      "student.timer.remaining": "left",
      "student.timer.over": "Time exceeded",
      "student.timer.overToast": "Time exceeded on “{tache}”. Keep going, your teacher has been notified.",
      "student.empty.title": "No task yet",
      "student.empty.desc": "The teacher has not imported the lab sheet yet.",
      "student.progress": "Progress",
      "student.quit": "Leave",

      "chat.title": "EduTwin Assistant",
      "chat.sub": "Hints, never the ready-made solution.",
      "chat.hello": "Hello! Ask me a question about a task and I'll guide you step by step.",
      "chat.placeholder": "Ask your question…",
      "chat.send": "Send question",
      "chat.prefill": "I need help with: {tache}. ",
      "chat.unavailable": "The assistant is unavailable.",
      "chat.error": "Sorry, I couldn't answer. Please try again shortly.",

      "teacher.title": "Teacher Space",
      "teacher.login.intro": "Restricted access. Enter the password to manage your lab sessions.",
      "teacher.password": "Password",
      "teacher.err.password": "Enter the password.",
      "teacher.login.submit": "Sign in",
      "teacher.login.error": "Incorrect password.",
      "teacher.logout": "Sign out",
      "teacher.welcome": "Welcome to the teacher space.",

      "teacher.subtitle": "Create a session, import the lab sheet, adjust tasks then track progress in real time.",
      "teacher.histo.title": "Session history",
      "teacher.histo.empty.title": "No session",
      "teacher.histo.empty.desc": "Create your first session below.",
      "teacher.session.title": "1. New session",
      "teacher.field.titre": "Lab title",
      "teacher.field.duree": "Duration (min)",
      "teacher.field.nbtaches": "Task count",
      "teacher.field.nbtaches.hint": "Minimum 3 steps. Duration is split evenly across the steps.",
      "teacher.session.submit": "Create the session",
      "teacher.err.titre": "The lab title is required.",
      "teacher.err.nbtaches": "The number of tasks must be at least 3.",
      "teacher.code.label": "Student access code",
      "teacher.code.copy": "Copy code",
      "teacher.code.copied": "Copied!",
      "teacher.link.copy": "Copy student link",
      "teacher.link.copied": "Link copied!",
      "teacher.doc.title": "2. Lab sheet",
      "teacher.doc.drop": "Choose a PDF or Word file",
      "teacher.doc.hint": "The text will be extracted and split into tasks.",
      "teacher.doc.submit": "Import and index",
      "teacher.doc.after": "Create the session first, then import the sheet.",
      "teacher.res.title": "Additional resources",
      "teacher.res.hint": "Upload source documents (instructions, examples…) to help the AI frame the lab.",
      "teacher.res.drop": "Add a document (PDF, Word, text…)",
      "teacher.res.submit": "Upload the resource",
      "teacher.res.empty": "No resource uploaded.",
      "teacher.tasks.title": "3. Lab tasks",
      "teacher.tasks.hint": "Adjust the tasks proposed by the AI: edit the title or instructions, add or remove a step.",
      "teacher.tasks.count": "{n} / {cible} steps",
      "teacher.tasks.empty.title": "No task",
      "teacher.tasks.empty.desc": "Import a lab sheet or add tasks manually.",
      "teacher.tasks.add": "Add a task",
      "teacher.tasks.save": "Save",
      "teacher.tasks.delete": "Delete",
      "teacher.tasks.confirm": "Confirm?",

      "teacher.dashboard.title": "Real-time dashboard",
      "teacher.ws.online": "Online",
      "teacher.ws.offline": "Reconnecting…",
      "teacher.kpi.connected": "Connected students",
      "teacher.kpi.blocked": "Blocked students",
      "teacher.kpi.progress": "Average progress",
      "teacher.students": "Students",
      "teacher.col.student": "Student",
      "teacher.col.poste": "Workstation",
      "teacher.col.progress": "Progress",
      "teacher.col.step": "Current step",
      "teacher.col.status": "Status",
      "teacher.students.empty.title": "No student connected",
      "teacher.students.empty.desc": "Share the access code so students can join.",
      "teacher.feed.title": "Notifications",
      "teacher.feed.empty.title": "Waiting for activity",
      "teacher.feed.empty.desc": "Connections, progress and questions will appear here.",
      "teacher.filter.byStatus": "Filter by status",
      "teacher.filter.byStudent": "Filter by student",
      "teacher.filter.all": "All",
      "teacher.filter.allStudents": "All students",

      "status.actif": "Active",
      "status.bloque": "Blocked",
      "status.inactif": "Inactive",
      "notif.connected": "Connected",
      "notif.encours": "In progress",
      "notif.bloque": "Blocked",
      "notif.termine": "Done",
      "notif.retard": "Late",
      "notif.question": "Question",
      "notif.joined": "{qui} joined workstation {poste}.",
      "notif.joinedSolo": "{qui} joined the session.",
      "notif.started": "{qui} started “{tache}”.",
      "notif.blocked": "{qui} is blocked on “{tache}”.",
      "notif.completed": "{qui} completed “{tache}”.",
      "notif.late": "{qui} is over time on “{tache}”.",
      "notif.asked": "{qui} asked a question:",

      "misc.step": "Step",
      "misc.none": "—"
    }
  };

  var lang = (function () {
    try {
      var s = localStorage.getItem(CLE);
      if (s && TRAD[s]) return s;
    } catch (e) {}
    return DEFAUT;
  })();

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return params[k] != null ? params[k] : m;
    });
  }

  function t(key, params) {
    var table = TRAD[lang] || TRAD[DEFAUT];
    var val = table[key];
    if (val == null) val = (TRAD[DEFAUT][key] != null ? TRAD[DEFAUT][key] : key);
    return interpolate(val, params);
  }

  function applyTo(root) {
    root = root || document;
    // Contenus texte
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    // Attributs : "placeholder:cle;aria-label:cle2"
    root.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(";").forEach(function (paire) {
        var kv = paire.split(":");
        if (kv.length === 2) el.setAttribute(kv[0].trim(), t(kv[1].trim()));
      });
    });
    document.documentElement.setAttribute("lang", lang);
  }

  function setLang(l) {
    if (!TRAD[l]) return;
    lang = l;
    try { localStorage.setItem(CLE, l); } catch (e) {}
    applyTo(document);
    // Synchronise tous les sélecteurs de langue de la page.
    document.querySelectorAll(".lang-select").forEach(function (sel) { sel.value = l; });
    // Notifie les modules pour re-rendre les contenus dynamiques.
    window.dispatchEvent(new CustomEvent("edu:langchange", { detail: { lang: l } }));
  }

  function initSelectors() {
    document.querySelectorAll(".lang-select").forEach(function (sel) {
      sel.value = lang;
      sel.addEventListener("change", function () { setLang(sel.value); });
    });
  }

  function boot() {
    applyTo(document);
    initSelectors();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.EduI18n = { t: t, getLang: function () { return lang; }, setLang: setLang, apply: applyTo };
})();
