import type { Prediction } from "../types";
import { describeProvenance, formatMatchDayTime, num } from "../lib/format";
import { ProbabilityBar } from "./ProbabilityBar";
import { TeamName } from "./TeamName";
import { MatchDetails } from "./MatchDetails";
import styles from "./MatchCard.module.css";

export function MatchCard({ prediction: p }: { prediction: Prediction }) {
  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span className={styles.kickoff}>{formatMatchDayTime(p.date)}</span>
        <span className={styles.provenance}>
          {describeProvenance(p.marketConstraints, p.llmApplied)}
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
          <span className={styles.tip}>{p.tip}</span>
          <span className={styles.meta}>{num(p.expectedPoints, 2)} EV</span>
          <span className={styles.meta}>
            Alt {p.runnerUpTip} · {num(p.runnerUpExpectedPoints, 2)}
          </span>
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
