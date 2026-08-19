// Manueller Refresh des recherchierten Spielkontexts. Nach dem Vorbild von
// refresh-odds/route.ts: nie automatisch bei einem Seitenaufruf, weil jeder Aufruf echtes
// Geld kostet. Seit der Automatik gibt es zwei Ausloeser -- den Zeitplan in GitHub Actions
// und diesen Knopf --, aber beide fuehren ueber denselben Workflow.

import { isAdminRequest } from "../../../data/adminAuth";
import { READ_ONLY_MESSAGE, isReadOnlyDeployment } from "../../../data/deployment";
import { dispatchWorkflow } from "../../../data/dispatchWorkflow";
import { isLlmConfigured } from "../../../llm/anthropicClient";
import { refreshLlmContext } from "../../../llm/refreshLlmContext";

export async function POST(request: Request) {
  const requested = new URL(request.url).searchParams.get("matchday");
  const matchday = requested ? Number(requested) : undefined;

  // Vor der Key-Pruefung: eine gehostete Instanz recherchiert selbst dann nicht, wenn
  // dort versehentlich ein Key hinterlegt wurde. Sie stoesst den Workflow an, und die
  // Recherche laeuft dort, wo auch der Zeitplan sie ausloest.
  if (isReadOnlyDeployment()) {
    if (!isAdminRequest(request)) {
      return Response.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
    }
    try {
      const inputs: Record<string, string> = { grund: "manuell" };
      // Von Hand ausgeloest heisst: das Zeitfenster wird bewusst uebergangen. Genau dafuer
      // ist der Knopf da -- wenn der planmaessige Lauf ausgefallen ist.
      inputs.erzwingen = "true";
      if (matchday) inputs.spieltag = String(matchday);
      return Response.json(await dispatchWorkflow("spielkontext", inputs));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Unbekannter Fehler" },
        { status: 502 }
      );
    }
  }

  if (!isLlmConfigured()) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY fehlt. In .env.local eintragen und Dev-Server neu starten." },
      { status: 400 }
    );
  }

  try {
    const summary = await refreshLlmContext(matchday);
    return Response.json(summary);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unbekannter Fehler" },
      { status: 500 }
    );
  }
}
