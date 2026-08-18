import type { TableEntry } from "../types";
import { FormPills } from "./FormPills";
import { TeamName } from "./TeamName";
import styles from "./LeagueTable.module.css";

export function LeagueTable({ rows, dimmed }: { rows: TableEntry[]; dimmed: boolean }) {
  return (
    <div className={styles.wrap} style={{ opacity: dimmed ? 0.5 : 1 }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.pos}>#</th>
            <th className={styles.teamCol}>Team</th>
            <th className={styles.collapsible}>Sp</th>
            <th className={styles.collapsible}>S</th>
            <th className={styles.collapsible}>U</th>
            <th className={styles.collapsible}>N</th>
            <th className={styles.collapsible}>Tore</th>
            <th>Diff</th>
            <th>Pkt</th>
            <th className={styles.formCol}>Form</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.team}>
              <td className={styles.pos}>{row.position}</td>
              <td className={styles.teamCol}>
                <TeamName name={row.team} logo={row.logo} />
              </td>
              <td className={styles.collapsible}>{row.matches}</td>
              <td className={styles.collapsible}>{row.won}</td>
              <td className={styles.collapsible}>{row.draw}</td>
              <td className={styles.collapsible}>{row.lost}</td>
              <td className={styles.collapsible}>
                {row.goals}:{row.opponentGoals}
              </td>
              <td>{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
              <td className={styles.points}>{row.points}</td>
              <td className={styles.formCol}>
                <FormPills form={row.form} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
