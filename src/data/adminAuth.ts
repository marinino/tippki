// Ein Passwortfeld, mehr nicht.
//
// Der Zweck ist eng: auf der gehosteten Instanz die beiden Aktualisierungen von Hand
// ausloesen koennen, wenn die Automatik ausgefallen ist. Es gibt keine Benutzer, keine
// Rollen und nichts zu verwalten -- ein geteiltes Geheimnis reicht, und alles darueber
// hinaus waere Angriffsflaeche ohne Gegenwert.
//
// Trotzdem drei Dinge, die nicht verhandelbar sind: das Passwort darf nie im Klartext in
// einem Cookie landen, der Vergleich muss zeitkonstant sein, und die Pruefung gehoert auf
// den Server. Ein Admin-Modus, den das Frontend allein entscheidet, ist keiner -- hinter
// den Knöpfen hängt ein Aufruf, der Geld kostet.

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "tippki_admin";
const PURPOSE = "tippki-admin-v1";
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export function isAdminConfigured(): boolean {
  return (process.env.ADMIN_PASSWORD ?? "").length > 0;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}|${payload}`).digest("hex");
}

// Zeitkonstant und laengenunabhaengig: timingSafeEqual wirft bei ungleicher Laenge, und
// schon diese Ausnahme waere ein Seitenkanal auf die Passwortlaenge. Der Umweg ueber
// gleich lange HMACs beseitigt beides.
function equals(a: string, b: string, secret: string): boolean {
  const ha = createHmac("sha256", secret).update(a).digest();
  const hb = createHmac("sha256", secret).update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Der Token traegt nur sein eigenes Ablaufdatum und die Signatur darueber. Kein
// Sitzungsspeicher noetig, und ein geaendertes Passwort entwertet alle ausgegebenen Token
// automatisch -- die Signatur haengt daran.
export function issueToken(now: Date = new Date()): string {
  const secret = process.env.ADMIN_PASSWORD ?? "";
  const expiresAt = Math.floor(now.getTime() / 1000) + LIFETIME_SECONDS;
  return `${expiresAt}.${sign(String(expiresAt), secret)}`;
}

export function verifyToken(token: string | null | undefined, now: Date = new Date()): boolean {
  if (!token || !isAdminConfigured()) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt * 1000 <= now.getTime()) return false;

  const secret = process.env.ADMIN_PASSWORD ?? "";
  return equals(signature, sign(payload, secret), secret);
}

export function checkPassword(candidate: unknown): boolean {
  if (!isAdminConfigured() || typeof candidate !== "string") return false;
  const secret = process.env.ADMIN_PASSWORD ?? "";
  return equals(candidate, secret, secret);
}

// Cookies aus dem Request-Header lesen, ohne auf die je nach Next-Version wandernde
// cookies()-API angewiesen zu sein.
export function isAdminRequest(request: Request, now: Date = new Date()): boolean {
  const header = request.headers.get("cookie");
  if (!header) return false;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    return verifyToken(decodeURIComponent(part.slice(eq + 1).trim()), now);
  }
  return false;
}

// SameSite=Lax reicht: alle schreibenden Aufrufe sind POST aus der eigenen Oberflaeche,
// und Lax schickt das Cookie bei fremd ausgeloesten POSTs nicht mit -- damit ist der
// CSRF-Weg auf die teuren Endpunkte zu.
export function sessionCookie(token: string | null): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  if (token === null) {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
  }
  return (
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; ` +
    `SameSite=Lax${secure}; Max-Age=${LIFETIME_SECONDS}`
  );
}
