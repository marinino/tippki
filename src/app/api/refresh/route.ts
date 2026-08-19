import { isAdminRequest } from "../../../data/adminAuth";
import { READ_ONLY_MESSAGE, isReadOnlyDeployment } from "../../../data/deployment";
import { dispatchWorkflow } from "../../../data/dispatchWorkflow";
import { clearMatchCache, deriveSeasonFromDate } from "../../../data/loadMatches";
import { refreshSeasonData } from "../../../data/refreshResults";
import { clearXgFormCache } from "../../../model/xgForm";

export async function POST(request: Request) {
  // Auf der gehosteten Instanz gibt es kein beschreibbares data/. Statt hier einen
  // zweiten Schreibpfad aufzumachen, loest der angemeldete Admin denselben Workflow aus,
  // den auch die Automatik faehrt -- Ergebnis identisch, nur ueber Commit und Deployment.
  if (isReadOnlyDeployment()) {
    if (!isAdminRequest(request)) {
      return Response.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
    }
    try {
      return Response.json(await dispatchWorkflow("ergebnisse", { grund: "manuell" }));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Unbekannter Fehler" },
        { status: 502 }
      );
    }
  }

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
