import { SCORING_SCHEMES } from "../../eval/scoringScheme";
import type { PredictionsResponse } from "../types";
import { formatTimestamp } from "../lib/format";
import styles from "./MatchdayToolbar.module.css";

// Schema- und Spieltagwahl plus die beiden Aktualisierungsknoepfe, die Geld bzw.
// API-Kontingent kosten -- deshalb bleiben sie manuell.
export function MatchdayToolbar({
  data,
  scheme,
  onSchemeChange,
  onMatchdayChange,
  onRefreshOdds,
  oddsLoading,
  onRefreshLlm,
  llmLoading,
}: {
  data: PredictionsResponse | null;
  scheme: string;
  onSchemeChange: (key: string) => void;
  onMatchdayChange: (matchday: number) => void;
  onRefreshOdds: () => void;
  oddsLoading: boolean;
  onRefreshLlm: () => void;
  llmLoading: boolean;
}) {
  return (
    <div className={styles.controls}>
      <select className="select" value={scheme} onChange={(e) => onSchemeChange(e.target.value)}>
        {Object.values(SCORING_SCHEMES).map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
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
      <button className="button secondary" onClick={onRefreshOdds} disabled={oddsLoading}>
        {oddsLoading ? "Holt Quoten …" : "Quoten aktualisieren"}
      </button>
      <button className="button secondary" onClick={onRefreshLlm} disabled={llmLoading}>
        {llmLoading ? "Recherchiert …" : "Spielkontext recherchieren"}
      </button>
    </div>
  );
}

// Wann Quoten und Spielkontext zuletzt geholt wurden. Ein Stand aus einem anderen
// Spieltag waere schlimmer als keiner -- die API liefert deshalb null statt veralteter
// Zeitstempel, und dann steht hier nichts.
export function FreshnessLines({ data }: { data: PredictionsResponse | null }) {
  if (!data) return null;
  return (
    <>
      {data.llmFetchedAt && (
        <p className="section-subtitle">
          Spielkontext-Stand: {formatTimestamp(data.llmFetchedAt)}
          {data.llmModel ? ` · ${data.llmModel}` : ""}
        </p>
      )}
      {data.oddsFetchedAt && (
        <p className="section-subtitle">Quoten-Stand: {formatTimestamp(data.oddsFetchedAt)}</p>
      )}
    </>
  );
}
