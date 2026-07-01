/* ==========================================================================
   EduTwin — ws.js
   Connexion WebSocket à une session avec reconnexion automatique et
   dispatch des messages par type.
   URL (contrat §1/§5) : ws://${location.host}/ws/session/${session_id}
   Enveloppe des messages (contrat §2) : { "type": <str>, "data": <objet> }
   Types : "eleve_join" | "tache_update" | "chat" | "dashboard".
   ========================================================================== */

export class SessionSocket {
  /**
   * @param {string} sessionId - identifiant de session.
   * @param {object} handlers  - callbacks : { onDashboard, onEleveJoin,
   *   onTacheUpdate, onChat, onOpen, onClose, onMessage(type, data) }.
   */
  constructor(sessionId, handlers = {}) {
    this.sessionId = sessionId;
    this.handlers = handlers;
    this.ws = null;
    this.fermetureVoulue = false;   // true si on ferme volontairement (pas de reconnexion)
    this.tentative = 0;              // compteur pour le backoff
    this.timerReconnexion = null;
  }

  /** Ouvre la connexion. Le protocole (ws/wss) suit celui de la page. */
  connect() {
    this.fermetureVoulue = false;
    const protocole = location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocole}://${location.host}/ws/session/${this.sessionId}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this._planifierReconnexion();
      return;
    }

    this.ws.addEventListener("open", () => {
      this.tentative = 0;
      this.handlers.onOpen?.();
    });

    this.ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return; // message non-JSON ignoré
      }
      this._dispatch(message);
    });

    this.ws.addEventListener("close", () => {
      this.handlers.onClose?.();
      if (!this.fermetureVoulue) this._planifierReconnexion();
    });

    // En cas d'erreur, le navigateur émet aussi "close" : la reconnexion y est gérée.
    this.ws.addEventListener("error", () => {
      this.ws?.close();
    });
  }

  /** Aiguille un message vers le bon handler selon son type. */
  _dispatch({ type, data }) {
    // Handler générique optionnel (pratique pour du debug/log).
    this.handlers.onMessage?.(type, data);
    switch (type) {
      case "dashboard":     this.handlers.onDashboard?.(data);    break;
      case "eleve_join":    this.handlers.onEleveJoin?.(data);    break;
      case "tache_update":  this.handlers.onTacheUpdate?.(data);  break;
      case "chat":          this.handlers.onChat?.(data);         break;
      default: /* type inconnu : ignoré silencieusement */         break;
    }
  }

  /** Reconnexion avec backoff exponentiel plafonné (1s → 15s). */
  _planifierReconnexion() {
    if (this.fermetureVoulue) return;
    clearTimeout(this.timerReconnexion);
    this.tentative += 1;
    const delai = Math.min(1000 * 2 ** (this.tentative - 1), 15000);
    this.timerReconnexion = setTimeout(() => this.connect(), delai);
  }

  /** Ferme volontairement (désactive la reconnexion). */
  close() {
    this.fermetureVoulue = true;
    clearTimeout(this.timerReconnexion);
    this.ws?.close();
  }
}
