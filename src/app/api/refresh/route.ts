import { clearMatchCache, deriveSeasonFromDate } from "../../../data/loadMatches";
import { refreshSeasonData } from "../../../data/refreshResults";
import { clearXgFormCache } from "../../../model/xgForm";

export async function POST() {
  const season = deriveSeasonFromDate(new Date());

  try {
    const summary = await refreshSeasonData(season);
    // Reihenfolge zaehlt: der xG-Form-Index wird aus loadAllMatches() gebaut, der
    // Match-Cache muss also zuerst weg.
    clearMatchCache();
    clearXgFormCache();
    return Response.json(summary);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unbekannter Fehler" }, { status: 500 });
  }
}
