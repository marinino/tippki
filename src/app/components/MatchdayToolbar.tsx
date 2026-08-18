import type { PredictionsResponse } from "../types";
import { formatTimestamp } from "../lib/format";
import styles from "./MatchdayToolbar.module.css";

// Spieltagwahl plus der eine Aktualisierungsknopf, der Geld kostet -- deshalb bleibt er
// manuell. Der frueher danebenstehende Quoten-Knopf ist entfallen: Buchmacherquoten sind
// in diesem Projekt Messlatte und keine Eingabe, es gibt also nichts abzurufen.
export function MatchdayToolbar({
  data,
  onMatchdayChange,
  onRefreshLlm,
  llmLoading,
}: {
  data: PredictionsResponse | null;
  onMatchdayChange: (matchday: number) => void;
  onRefreshLlm: () => void;
  llmLoading: boolean;
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
      <button className="button secondary" onClick={onRefreshLlm} disabled={llmLoading}>
        {llmLoading ? "Recherchiert …" : "Spielkontext recherchieren"}
      </button>
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
