/**
 * The investor's agent conversation id, kept per user in the browser so the agent page and the dock
 * that floats over every other investor screen continue the same conversation.
 */
export function sessionKey(userId: string) {
  return `countersign.agentSession.${userId}`;
}

export function newSessionId() {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `cs_${rnd.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 60);
}

/** The saved conversation id for this user, or a new one (saved) */
export function currentSessionId(userId: string) {
  try {
    const saved = localStorage.getItem(sessionKey(userId));
    if (saved) return saved;
    const id = newSessionId();
    localStorage.setItem(sessionKey(userId), id);
    return id;
  } catch {
    return newSessionId();
  }
}
