import type { usePredictions } from "../hooks/usePredictions";
import { MatchCard } from "./MatchCard";
import { FreshnessLines, MatchdayToolbar } from "./MatchdayToolbar";
import { SkeletonCards } from "./Skeleton";

export function PredictionsSection({
  predictions,
  canRefresh,
}: {
  predictions: ReturnType<typeof usePredictions>;
  canRefresh: boolean;
}) {
  const { data, loading, load, llm, refreshLlm } = predictions;

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Faire Quoten</h2>
          {data?.nextMatchday != null && data.matchday === data.nextMatchday && (
            <p className="section-subtitle">Nächster Spieltag</p>
          )}
        </div>
        <MatchdayToolbar
          data={data}
          onMatchdayChange={(md) => load(md)}
          onRefreshLlm={refreshLlm}
          llmLoading={llm.loading}
          canRefresh={canRefresh}
        />
      </div>

      {llm.message && <p className="refresh-message">{llm.message}</p>}
      <FreshnessLines data={data} />

      {!data && <SkeletonCards />}

      {data && data.predictions.length === 0 && (
        <p className="loading-text">Für diesen Spieltag liegen keine Partien vor.</p>
      )}

      {data && data.predictions.length > 0 && (
        <div className="card-list" style={{ opacity: loading ? 0.45 : 1 }}>
          {data.predictions.map((p) => (
            <MatchCard key={`${p.homeTeam}-${p.awayTeam}`} prediction={p} />
          ))}
        </div>
      )}

      {data && data.predictions.some((p) => p.homeIsEstimated || p.awayIsEstimated) && (
        <p className="footnote">* geschätzt — keine oder wenig Bundesliga-Historie</p>
      )}
    </section>
  );
}
