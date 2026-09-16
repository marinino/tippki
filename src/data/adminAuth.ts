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
//
// Seit dem 16.09.2026 ein viertes: das Token darf nichts ueber das Passwort verraten.
// Vorher war das Passwort selbst der HMAC-Schluessel, und Nachricht wie Signatur stehen im
// Token. Wer an ein Token kam, konnte Passwoerter offline durchprobieren -- ohne Server,
// ohne Bremse, ohne Spur. Nachgestellt: "schalke04" aus 120.010 Kandidaten in 0,43 s auf
// einem CPU-Kern. Jetzt signiert ein eigenes, zufaelliges ADMIN_TOKEN_SECRET; ohne das
// laesst sich aus einem Token kein einziger Passwortkandidat pruefen.

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "tippki_admin";
const PURPOSE = "tippki-admin-v1";
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

// Die Login-Route bremst jeden Versuch, aber das haelt keinen parallelen Angriff auf: 50
// gleichzeitige Anfragen sind 125 Versuche pro Sekunde, 500 sind 1.250. Was online schuetzt,
// ist die Laenge des Passworts. 20 Zeichen sind fuer ein zufaellig erzeugtes Passwort
// grosszuegig und fuer ein ausgedachtes eine spuerbare Huerde.
export const MIN_PASSWORD_LENGTH = 20;

// 32 Zeichen: genug fuer 32 zufaellige Bytes in base64url (43 Zeichen) mit Abstand. Die
// Zahl ist ein Riegel gegen "abc" als Platzhalter, keine Entropiemessung.
export const MIN_TOKEN_SECRET_LENGTH = 32;

// Warum der Admin-Modus nicht verfuegbar ist, oder null, wenn er es ist.
//
// Getrennt von isAdminConfigured, weil die Oberflaeche ohne Konfiguration gar nichts
// anzeigt -- ein fehlendes Geheimnis liesse den Admin-Link sonst lautlos verschwinden. Der
// Grund landet deshalb im Server-Log, sobald ueberhaupt ein Passwort gesetzt ist.
export function adminConfigProblem(): string | null {
  const password = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.ADMIN_TOKEN_SECRET ?? "";
  if (password.length === 0) return "ADMIN_PASSWORD ist nicht gesetzt.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `ADMIN_PASSWORD ist kuerzer als ${MIN_PASSWORD_LENGTH} Zeichen.`;
  }
  if (secret.length < MIN_TOKEN_SECRET_LENGTH) {
    return `ADMIN_TOKEN_SECRET fehlt oder ist kuerzer als ${MIN_TOKEN_SECRET_LENGTH} Zeichen.`;
  }
  // Sonst waere es wieder das Passwort, das signiert -- genau der alte Zustand.
  if (secret === password) return "ADMIN_TOKEN_SECRET darf nicht dasselbe sein wie ADMIN_PASSWORD.";
  return null;
}

export function isAdminConfigured(): boolean {
  return adminConfigProblem() === null;
}

// Bindet das Token an das aktuelle Passwort, ohne dass es aus dem Token herauslesbar waere:
// ein Fingerabdruck unter dem Geheimnis. Damit entwertet ein neues Passwort weiterhin alle
// ausgegebenen Token, wie vorher -- und ein neues Geheimnis ebenso.
function passwordBinding(password: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}|passwort|${password}`).digest("hex");
}

function sign(payload: string, password: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${PURPOSE}|${payload}|${passwordBinding(password, secret)}`)
    .digest("hex");
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
// Sitzungsspeicher noetig.
export function issueToken(now: Date = new Date()): string {
  const password = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.ADMIN_TOKEN_SECRET ?? "";
  const expiresAt = Math.floor(now.getTime() / 1000) + LIFETIME_SECONDS;
  return `${expiresAt}.${sign(String(expiresAt), password, secret)}`;
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

  const password = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.ADMIN_TOKEN_SECRET ?? "";
  return equals(signature, sign(payload, password, secret), secret);
}

export function checkPassword(candidate: unknown): boolean {
  if (!isAdminConfigured() || typeof candidate !== "string") return false;
  const password = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.ADMIN_TOKEN_SECRET ?? "";
  return equals(candidate, password, secret);
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
