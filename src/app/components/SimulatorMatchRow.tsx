import type { SimPrediction } from "../types";
import type { SimInput } from "../hooks/useSimulation";
import { num, odds } from "../lib/format";
import { ProbabilityBar } from "./ProbabilityBar";
import { TeamName } from "./TeamName";
import styles from "./SimulatorMatchRow.module.css";
import cardStyles from "./MatchCard.module.css";

// Gleiche Kartensprache wie im Tipps-Tab, aber jede Teamzeile traegt ihr eigenes
// Eingabefeld. Vorher standen beide Felder als "2 : 1" in der Mitte zwischen den
// Namen -- welche Zahl zu welchem Team gehoerte, musste man sich denken.
export function SimulatorMatchRow({
  prediction: p,
  input,
  onChange,
}: {
  prediction: SimPrediction;
  input: SimInput;
  onChange: (side: "home" | "away", value: string) => void;
}) {
  return (
    <article className={cardStyles.card}>
      <div className={cardStyles.body}>
        <div className={styles.teams}>
          <div className={styles.teamRow}>
            <TeamName name={p.homeTeam} logo={p.homeLogo} isEstimated={p.homeIsEstimated} />
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className={styles.score}
              aria-label={`Tore ${p.homeTeam}`}
              value={input.home}
              onChange={(e) => onChange("home", e.target.value)}
            />
          </div>
          <div className={styles.teamRow}>
            <TeamName name={p.awayTeam} logo={p.awayLogo} isEstimated={p.awayIsEstimated} muted />
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className={styles.score}
              aria-label={`Tore ${p.awayTeam}`}
              value={input.away}
              onChange={(e) => onChange("away", e.target.value)}
            />
          </div>
        </div>

        <div className={cardStyles.verdict}>
          <span className={cardStyles.tip}>{odds(favouriteOdds(p))}</span>
          <span className={cardStyles.meta}>faire Quote Favorit</span>
          <span className={cardStyles.meta}>Häufigstes {p.mostLikelyScore}</span>
          <span className={cardStyles.meta}>
            Ø {num(p.expectedHomeGoals, 1)}:{num(p.expectedAwayGoals, 1)}
          </span>
        </div>
      </div>

      <ProbabilityBar
        homeWinProb={p.homeWinProb}
        drawProb={p.drawProb}
        awayWinProb={p.awayWinProb}
      />
    </article>
  );
}

function favouriteOdds(p: SimPrediction): number {
  const o = p.prices.outcome;
  return [
    { prob: p.homeWinProb, fairOdds: o.home.fairOdds },
    { prob: p.drawProb, fairOdds: o.draw.fairOdds },
    { prob: p.awayWinProb, fairOdds: o.away.fairOdds },
  ].reduce((best, x) => (x.prob > best.prob ? x : best)).fairOdds;
}
