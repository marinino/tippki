// Manueller Refresh des recherchierten Spielkontexts. Nach dem Vorbild von
// refresh-odds/route.ts: nie automatisch, weil jeder Aufruf echtes Geld kostet.

import { isLlmConfigured } from "../../../llm/anthropicClient";
import { refreshLlmContext } from "../../../llm/refreshLlmContext";

export async function POST(request: Request) {
  if (!isLlmConfigured()) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY fehlt. In .env.local eintragen und Dev-Server neu starten." },
      { status: 400 }
    );
  }

  const requested = new URL(request.url).searchParams.get("matchday");
  const matchday = requested ? Number(requested) : undefined;

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
