// FNV-1a, 32 Bit. Kurz genug zum Lesen im Log, kollisionsfrei genug fuer eine Handvoll
// Konfigurationen pro Saison.
//
// Eigenes Modul seit dem 2026-11-19: der configHash (pipelineConfig.ts) und der Abdruck des
// Kandidaten (candidate.ts) benutzen dieselbe Funktion. Eine zweite Kopie daneben waere die
// Stelle, an der zwei Abdruecke irgendwann still verschieden rechnen. Unveraendert aus
// pipelineConfig.ts herausgezogen -- selfCheck verlangt weiter FROZEN_CONFIG_HASH.
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
