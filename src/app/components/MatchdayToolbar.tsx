import type { PredictionsResponse } from "../types";
import { formatTimestamp } from "../lib/format";
import styles from "./MatchdayToolbar.module.css";

// Spieltagwahl plus der eine Aktualisierungsknopf, der Geld kostet -- deshalb bleibt er
// manuell. Der frueher danebenstehende Quoten-Knopf ist entfallen: Buchmacherquoten sind
// in diesem Projekt Messlatte und keine Eingabe, es gibt also nichts abzurufen.
//
// Auf der gehosteten Instanz faellt der Recherche-Knopf weg: dort waere er von jedem
// klickbar, und der Zeitpunkt der Recherche gehoert zum Eingefrorenen. Zurueck kommt er
// nur fuer einen angemeldeten Admin -- und stoesst dann den Workflow an, statt selbst zu
// recherchieren.
export function MatchdayToolbar({
  data,
  onMatchdayChange,
  onRefreshLlm,
  llmLoading,
  canRefresh,
}: {
  data: PredictionsResponse | null;
  onMatchdayChange: (matchday: number) => void;
  onRefreshLlm: () => void;
  llmLoading: boolean;
  canRefresh: boolean;
}) {
  return (
    <div className={styles.controls}>
      {data && data.availableMatchdays.length > 0 && (
        <select
          className="select"
          value={data.matchday ?? ""}
          onChange={(e) => onMatchdayChange(Number(e.target.value))}
        >
          {data.availableMatchdays.map((md) => (
            <option key={md} value={md}>
              Spieltag {md}
              {md === data.nextMatchday ? " · nächster" : ""}
            </option>
          ))}
        </select>
      )}
      {canRefresh && (
        <button className="button secondary" onClick={onRefreshLlm} disabled={llmLoading}>
          {llmLoading ? "Recherchiert …" : "Spielkontext recherchieren"}
        </button>
      )}
    </div>
  );
}

// Wann der Spielkontext zuletzt geholt wurde -- und ob dabei ueberhaupt recherchiert
// wurde. Ein Stand aus einem anderen Spieltag waere schlimmer als keiner: die API liefert
// deshalb null statt eines veralteten Zeitstempels, und dann steht hier nichts.
//
// Die Suchzahl steht bewusst hier oben und nicht in den Details einer einzelnen Partie:
// sie gilt fuer den ganzen Spieltag, und sie ist die Zahl, die man ZUERST lesen muss.
// Steht sie auf 0, sind saemtliche "ohne Befund" darunter bedeutungslos -- genau so sah
// der Ausfall von Spieltag 1 aus, und die Karte konnte ihn nicht zeigen.
export function FreshnessLines({ data }: { data: PredictionsResponse | null }) {
  if (!data?.llmFetchedAt) return null;

  // Durchgehend defensiv gelesen: diese Zeile rendert auf der gehosteten Instanz bei
  // jedem Seitenaufruf, und ein Zugriff auf ein fehlendes Feld nimmt dort nicht nur den
  // Spielkontext mit, sondern die ganze Seite. Der Cache ist eine Datei aus dem
  // Repository, kein typgepruefter Wert.
  const run = data.llmRun;
  const suchen = typeof run?.webSearches === "number" ? run.webSearches : null;
  const zeichen = typeof run?.researchChars === "number" ? run.researchChars : null;
  const budgetErschoepft = run?.searchErrors?.includes("max_uses_exceeded") ?? false;

  return (
    <>
      <p className="section-subtitle">
        Spielkontext-Stand: {formatTimestamp(data.llmFetchedAt)}
        {data.llmModel ? ` · ${data.llmModel}` : ""}
        {suchen !== null ? ` · ${suchen} ${suchen === 1 ? "Websuche" : "Websuchen"}` : ""}
        {zeichen !== null ? `, ${Math.round(zeichen / 100) / 10} k Zeichen Bericht` : ""}
      </p>
      {suchen === 0 && (
        <p className="section-subtitle">
          Achtung: keine einzige Websuche. Die Befunde unten sind nicht belastbar.
        </p>
      )}
      {budgetErschoepft && (
        <p className="section-subtitle">
          Achtung: das Suchbudget war erschöpft. Partien ohne Befund wurden womöglich gar
          nicht recherchiert.
        </p>
      )}
      {!run && (
        <p className="section-subtitle">
          Für diesen Stand ist nicht festgehalten, wie viel recherchiert wurde.
        </p>
      )}
    </>
  );
}
