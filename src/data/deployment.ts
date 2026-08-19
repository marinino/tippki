// Laeuft diese Instanz als Deployment oder auf Noahs Rechner?
//
// Beide Aktualisierungen schreiben nach data/ -- Ergebnisse in die Saison-CSV, die
// Recherche in den LLM-Cache. In der Cloud ist das Dateisystem schreibgeschuetzt, ein
// Klick liefe dort in einen EROFS-Fehler.
//
// Der wichtigere Grund ist aber nicht technisch: der Recherche-Zeitpunkt gehoert zum
// Eingefrorenen (SAISONBETRIEB.md) -- drei Stunden vor dem ersten Anpfiff, von Hand, ein
// Aufruf je Spieltag. Ein oeffentlich klickbarer Knopf ueberschriebe den Cache zu einem
// beliebigen Zeitpunkt und gaebe dabei fremdes Geld aus. Die gehostete Instanz zeigt
// deshalb nur, was zuletzt committet wurde.
//
// NODE_ENV ist dafuer der ehrliche Schalter: `next dev` ist "development", ein Build ist
// "production", und die tsx-Skripte laufen ganz ohne NODE_ENV -- `npm run refresh-llm`
// schreibt also weiterhin.
export function isReadOnlyDeployment(): boolean {
  return process.env.NODE_ENV === "production";
}

export const READ_ONLY_MESSAGE =
  "Diese Instanz ist nur zum Anschauen. Aktualisiert wird lokal per npm-Skript, " +
  "danach committet und gepusht.";
