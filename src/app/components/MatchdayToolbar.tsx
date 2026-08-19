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

// Wann der Spielkontext zuletzt geholt wurde. Ein Stand aus einem anderen Spieltag waere
// schlimmer als keiner -- die API liefert deshalb null statt eines veralteten
// Zeitstempels, und dann steht hier nichts.
export function FreshnessLines({ data }: { data: PredictionsResponse | null }) {
  if (!data?.llmFetchedAt) return null;
  return (
    <p className="section-subtitle">
      Spielkontext-Stand: {formatTimestamp(data.llmFetchedAt)}
      {data.llmModel ? ` · ${data.llmModel}` : ""}
    </p>
  );
}
