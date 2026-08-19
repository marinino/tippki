// Zustand des Admin-Modus. Bewusst ohne jede Angabe darueber, ob ein Passwortversuch
// nah dran war -- die Antwort ist dieselbe, ob nie eines gesetzt wurde oder ob eines
// falsch war.

import { isAdminConfigured, isAdminRequest, sessionCookie } from "../../../data/adminAuth";
import { isDispatchConfigured } from "../../../data/dispatchWorkflow";

export async function GET(request: Request) {
  return Response.json({
    // Ohne gesetztes Passwort zeigt die Oberflaeche den Login gar nicht erst an.
    configured: isAdminConfigured(),
    admin: isAdminRequest(request),
    // Ob der Rueckfallweg vollstaendig ist. Fehlt der Token, kann der angemeldete Admin
    // zwar die Knoepfe sehen, aber nichts ausloesen -- das soll er vorher wissen.
    canDispatch: isDispatchConfigured(),
  });
}

export async function DELETE() {
  return Response.json(
    { admin: false },
    { headers: { "Set-Cookie": sessionCookie(null) } }
  );
}
