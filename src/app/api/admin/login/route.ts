import {
  checkPassword,
  isAdminConfigured,
  issueToken,
  sessionCookie,
} from "../../../../data/adminAuth";

// Ein kleiner, fester Aufschlag auf jeden Versuch. Er macht das Durchprobieren teuer,
// ohne einen Zaehler zu brauchen -- und ein Zaehler waere hier ohnehin wertlos, weil
// jede Serverless-Instanz ihren eigenen haette.
const DELAY_MS = 400;

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Auf dieser Instanz ist kein Admin-Passwort gesetzt." },
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
