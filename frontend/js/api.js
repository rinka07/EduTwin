/* ==========================================================================
   EduTwin — api.js
   Helpers fetch vers l'API FastAPI en URLs RELATIVES (même origine).
   Toutes les fonctions renvoient une promesse ; en cas d'erreur HTTP,
   elles rejettent avec une Error dont le message est lisible par l'UI
   (utilise le champ `detail` renvoyé par FastAPI si présent).
   ========================================================================== */

/**
 * Extrait un message d'erreur lisible d'une réponse non-OK.
 * FastAPI renvoie typiquement { "detail": "..." }.
 */
async function extraireErreur(response) {
  let message = `Erreur ${response.status}`;
  try {
    const data = await response.json();
    if (data && typeof data.detail === "string") {
      message = data.detail;
    } else if (data && Array.isArray(data.detail) && data.detail[0]?.msg) {
      // Erreurs de validation Pydantic (liste d'objets)
      message = data.detail[0].msg;
    }
  } catch (_) {
    // Corps non-JSON : on garde le message générique.
  }
  const err = new Error(message);
  err.status = response.status;
  return err;
}

/** Traite une réponse : renvoie le JSON ou lève une erreur. */
async function traiterReponse(response) {
  if (!response.ok) {
    throw await extraireErreur(response);
  }
  // Certaines réponses peuvent être vides ; on tente le JSON prudemment.
  const texte = await response.text();
  return texte ? JSON.parse(texte) : {};
}

/* --------------------------------------------------------------------------
   Jeton enseignant (X-Edu-Token) — stocké dans localStorage.
   -------------------------------------------------------------------------- */
const CLE_TOKEN = "edutwin_token";

export function setTokenEnseignant(token) {
  if (token) localStorage.setItem(CLE_TOKEN, token);
  else localStorage.removeItem(CLE_TOKEN);
}
export function getTokenEnseignant() {
  return localStorage.getItem(CLE_TOKEN) || "";
}

/** Construit les en-têtes en ajoutant le jeton enseignant s'il est présent. */
function entetes(base = {}) {
  const h = { "Accept": "application/json", ...base };
  const token = getTokenEnseignant();
  if (token) h["X-Edu-Token"] = token;
  return h;
}

/** GET JSON. */
export async function getJSON(url) {
  const response = await fetch(url, { method: "GET", headers: entetes() });
  return traiterReponse(response);
}

/** POST JSON. */
export async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: entetes({ "Content-Type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  return traiterReponse(response);
}

/** PATCH JSON. */
export async function patchJSON(url, body) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: entetes({ "Content-Type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  return traiterReponse(response);
}

/** PUT JSON. */
export async function putJSON(url, body) {
  const response = await fetch(url, {
    method: "PUT",
    headers: entetes({ "Content-Type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  return traiterReponse(response);
}

/** DELETE JSON. */
export async function deleteJSON(url) {
  const response = await fetch(url, { method: "DELETE", headers: entetes() });
  return traiterReponse(response);
}

/**
 * Upload d'un fichier via multipart/form-data.
 * @param {string} url
 * @param {File} fichier - le fichier à envoyer
 * @param {string} champ - nom du champ (contrat : "fichier")
 */
export async function uploadFile(url, fichier, champ = "fichier") {
  const formData = new FormData();
  formData.append(champ, fichier);
  const response = await fetch(url, {
    method: "POST",
    headers: entetes(), // jeton enseignant si présent ; PAS de Content-Type (boundary auto)
    body: formData,
  });
  return traiterReponse(response);
}
