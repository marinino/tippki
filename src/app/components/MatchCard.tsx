import { hasNumbers, type PricedPrediction, type Prediction } from "../types";
import { describeProvenance, describeSource, formatMatchDayTime, num, odds } from "../lib/format";
import { modeSuffix, scoresByOutcome } from "../lib/scoreByOutcome";
import { ProbabilityBar } from "./ProbabilityBar";
import { TeamName } from "./TeamName";
import { MatchDetails } from "./MatchDetails";
import styles from "./MatchCard.module.css";

// Die grosse Zahl war frueher der abzugebende Tipp. Jetzt ist es die faire Quote des
// wahrscheinlichsten Ausgangs -- das ist die Zahl, die ein Buchmacher aushaengen wuerde
// und an der sich dieses Modell messen lassen muss.
export function MatchCard({ prediction: p }: { prediction: Prediction }) {
  if (!hasNumbers(p)) return <MissingCard prediction={p} />;
  const favourite = pickFavourite(p);
  const source = describeSource(p.source);
  const scores = scoresByOutcome(p.prices.correctScore, p.scoreGrid);

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span className={styles.kickoff}>{formatMatchDayTime(p.date)}</span>
        <span className={styles.provenance}>
          {describeProvenance(p.llmStatus)}
          {source && <span className={styles.frozen}> · {source}</span>}
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
          <span className={styles.meta}>
            Häufigstes {p.mostLikelyScore}
            {modeSuffix(scores, p.mostLikelyScore)}
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
        scores={scores}
      />

      <MatchDetails prediction={p} />
    </article>
  );
}

// Angepfiffen, ohne Schnappschuss und ohne Logzeile. Keine Zahlen statt nachgerechneter:
// eine Vorhersage, die erst nach Anpfiff entsteht, ist keine.
function MissingCard({ prediction: p }: { prediction: Prediction }) {
  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span className={styles.kickoff}>{formatMatchDayTime(p.date)}</span>
        <span className={styles.provenance}>keine Vorhersage festgehalten</span>
      </header>
      <div className={styles.body}>
        <div className={styles.teams}>
          <TeamName name={p.homeTeam} logo={p.homeLogo} isEstimated={false} />
          <TeamName name={p.awayTeam} logo={p.awayLogo} isEstimated={false} muted />
        </div>
      </div>
    </article>
  );
}

function pickFavourite(p: PricedPrediction): { label: string; fairOdds: number } {
  const options = [
    { label: `Sieg ${p.homeTeam}`, prob: p.homeWinProb, fairOdds: p.prices.outcome.home.fairOdds },
    { label: "Unentschieden", prob: p.drawProb, fairOdds: p.prices.outcome.draw.fairOdds },
    { label: `Sieg ${p.awayTeam}`, prob: p.awayWinProb, fairOdds: p.prices.outcome.away.fairOdds },
  ];
  return options.reduce((best, o) => (o.prob > best.prob ? o : best));
}
