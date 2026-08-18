import type { TableResponse } from "../types";
import { LeagueTable } from "./LeagueTable";
import { SkeletonTable } from "./Skeleton";

export function TableSection({
  table,
  loading,
}: {
  table: TableResponse | null;
  loading: boolean;
}) {
  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Tabelle</h2>
          <p className="section-subtitle">
            {table ? `Saison ${table.season}/${Number(table.season) + 1}` : "Aktuelle Bundesliga-Tabelle"}
          </p>
        </div>
      </div>

      {loading && !table && <SkeletonTable />}
      {table && <LeagueTable rows={table.table} dimmed={loading} />}
    </section>
  );
}
