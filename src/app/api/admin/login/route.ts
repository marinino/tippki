import {
  checkPassword,
  isAdminConfigured,
  issueToken,
  sessionCookie,
} from "../../../../data/adminAuth";

// Ein kleiner, fester Aufschlag auf jeden Versuch. Er bremst einen Angreifer, der Versuche
// nacheinander schickt -- und keinen, der sie parallel schickt: 50 gleichzeitige Anfragen
// sind trotzdem 125 Versuche pro Sekunde, und die 400 ms zahlt als Funktionslaufzeit der
// Betreiber, nicht der Angreifer. Bis zum 16.09.2026 stand hier, er mache "das
// Durchprobieren teuer"; das tut er nicht. Was online schuetzt, ist MIN_PASSWORD_LENGTH in
// adminAuth.ts. Ein Zaehler waere hier ohnehin wertlos, weil jede Serverless-Instanz ihren
// eigenen haette; eine echte Ratenbegrenzung gehoert, wenn ueberhaupt, vor die Funktion.
const DELAY_MS = 400;

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Auf dieser Instanz ist der Admin-Modus nicht eingerichtet." },
      { status: 400 }
    );
  }

  let password: unknown = null;
  try {
    password = ((await request.json()) as { password?: unknown }).password;
  } catch {
    // Kaputter Rumpf wird wie ein falsches Passwort behandelt.
  }

  const ok = checkPassword(password);
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));

  if (!ok) {
    return Response.json({ error: "Falsches Passwort." }, { status: 401 });
  }

  return Response.json(
    { admin: true },
    { headers: { "Set-Cookie": sessionCookie(issueToken()) } }
  );
}
