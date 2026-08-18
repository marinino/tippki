import type { PriceSheet } from "../../model/priceSheet";
import { num, odds } from "../lib/format";
import styles from "./PriceSheetView.module.css";

// Das vollstaendige Preisblatt, so wie ein Buchmacher es aushaengen wuerde -- nur ohne
// Marge. Die Kehrwerte summieren je Markt exakt auf 1; ein Buchmacher schlaegt darauf
// noch seinen Aufschlag, weshalb seine Quoten immer etwas niedriger liegen als diese.
export function PriceSheetView({ prices }: { prices: PriceSheet }) {
  return (
    <div className={styles.sheet}>
      <Market label="1X2">
        <Cell name="1" price={prices.outcome.home} />
        <Cell name="X" price={prices.outcome.draw} />
        <Cell name="2" price={prices.outcome.away} />
      </Market>

      <Market label="Doppelte Chance">
        <Cell name="1X" price={prices.doubleChance.homeOrDraw} />
        <Cell name="12" price={prices.doubleChance.homeOrAway} />
        <Cell name="X2" price={prices.doubleChance.drawOrAway} />
      </Market>

      <Market label="Beide treffen">
        <Cell name="Ja" price={prices.bothTeamsToScore.yes} />
        <Cell name="Nein" price={prices.bothTeamsToScore.no} />
      </Market>

      <Market label="Torsumme">
        {prices.totals
          .filter((t) => t.line <= 4.5)
          .map((t) => (
            <span key={t.line} className={styles.pair}>
              <Cell name={`Ü ${num(t.line, 1)}`} price={t.over} />
              <Cell name={`U ${num(t.line, 1)}`} price={t.under} />
            </span>
          ))}
      </Market>

      <Market label="Handicap">
        {prices.handicaps
          .filter((h) => Math.abs(h.line) <= 2.5)
          .map((h) => (
            <span key={h.line} className={styles.pair}>
              <Cell name={`H ${h.line > 0 ? "+" : ""}${num(h.line, 1)}`} price={h.home} />
              <Cell name={`A ${h.line < 0 ? "+" : ""}${num(-h.line, 1)}`} price={h.away} />
            </span>
          ))}
      </Market>

      <Market label="Exaktes Ergebnis">
        {prices.correctScore.slice(0, 12).map((c) => (
          <Cell key={c.score} name={c.score} price={c.price} />
        ))}
        <Cell name="sonstige" price={prices.correctScoreOther} />
      </Market>
    </div>
  );
}

function Market({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.market}>
      <span className={styles.marketLabel}>{label}</span>
      <div className={styles.cells}>{children}</div>
    </div>
  );
}

function Cell({ name, price }: { name: string; price: { prob: number; fairOdds: number } }) {
  return (
    <span className={styles.cell} title={`${num(price.prob * 100, 1)} %`}>
      <span className={styles.name}>{name}</span>
      <span className={styles.value}>{odds(price.fairOdds)}</span>
    </span>
  );
}
