import type { Prediction } from "../types";
import { describeProvenance, formatMatchDayTime, num, odds } from "../lib/format";
import { ProbabilityBar } from "./ProbabilityBar";
import { TeamName } from "./TeamName";
import { MatchDetails } from "./MatchDetails";
import styles from "./MatchCard.module.css";

// Die grosse Zahl war frueher der abzugebende Tipp. Jetzt ist es die faire Quote des
// wahrscheinlichsten Ausgangs -- das ist die Zahl, die ein Buchmacher aushaengen wuerde
// und an der sich dieses Modell messen lassen muss.
export function MatchCard({ prediction: p }: { prediction: Prediction }) {
  const favourite = pickFavourite(p);

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span className={styles.kickoff}>{formatMatchDayTime(p.date)}</span>
        <span className={styles.provenance}>
          {describeProvenance(p.llmApplied)}
        </span>
      </header>

      <div className={styles.body}>
        <div className={styles.teams}>
          <TeamName name={p.homeTeam} logo={p.homeLogo} isEstimated={p.homeIsEstimated} />
          <TeamName
            name={p.awayTeam}
            logo={p.awayLogo}
            isEstimated={p.awayIsEstimated}
            muted
          />
        </div>

        <div className={styles.verdict}>
          <span className={styles.tip}>{odds(favourite.fairOdds)}</span>
          <span className={styles.meta}>{favourite.label} · faire Quote</span>
          <span className={styles.meta}>Häufigstes {p.mostLikelyScore}</span>
          <span className={styles.meta}>
            Ø {num(p.expectedHomeGoals, 1)}:{num(p.expectedAwayGoals, 1)}
          </span>
        </div>
      </div>

      <ProbabilityBar
        homeWinProb={p.homeWinProb}
        drawProb={p.drawProb}
        awayWinProb={p.awayWinProb}
      />

      <MatchDetails prediction={p} />
    </article>
  );
}

function pickFavourite(p: Prediction): { label: string; fairOdds: number } {
  const options = [
    { label: `Sieg ${p.homeTeam}`, prob: p.homeWinProb, fairOdds: p.prices.outcome.home.fairOdds },
    { label: "Unentschieden", prob: p.drawProb, fairOdds: p.prices.outcome.draw.fairOdds },
    { label: `Sieg ${p.awayTeam}`, prob: p.awayWinProb, fairOdds: p.prices.outcome.away.fairOdds },
  ];
  return options.reduce((best, o) => (o.prob > best.prob ? o : best));
}
