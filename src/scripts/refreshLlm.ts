// CLI-Zwilling zu POST /api/refresh-llm.
//
//   npm run refresh-llm
//   npm run refresh-llm -- --matchday=3
//
// Kostet echtes Geld (rund 1 $ fuer neun Partien), deshalb nur manuell.

import { loadEnvLocal } from "../data/loadEnv";
import { isLlmConfigured } from "../llm/anthropicClient";
import { refreshLlmContext } from "../llm/refreshLlmContext";

loadEnvLocal();

if (!isLlmConfigured()) {
  console.error(
    "ANTHROPIC_API_KEY fehlt.\n" +
      "In .env.local eintragen:  ANTHROPIC_API_KEY=sk-ant-...\n" +
      "Es wird kein Aufruf gemacht und nichts berechnet."
  );
  process.exit(1);
}

const flag = process.argv.find((a) => a.startsWith("--matchday="));
const matchday = flag ? Number(flag.slice("--matchday=".length)) : undefined;

const summary = await refreshLlmContext(matchday);

console.log(`Spieltag ${summary.matchday}, Modell ${summary.model}`);
console.log(
  `${summary.fixturesWithContext}/${summary.fixturesTotal} Partien recherchiert, ` +
    `davon ${summary.fixturesWithFactors} mit gefundenen Faktoren.`
);

const failureCount = Object.keys(summary.failures).length;
if (failureCount > 0) {
  console.log(`\n${failureCount} Fehlschlaege:`);
  for (const [key, reason] of Object.entries(summary.failures)) {
    console.log(`  ${key}: ${reason}`);
  }
}

console.log(
  `\nVerbrauch: ${summary.usage.inputTokens} Eingabe-Token, ` +
    `${summary.usage.outputTokens} Ausgabe-Token, ${summary.usage.webSearches} Websuchen.`
);
console.log(`Geschaetzte Kosten zu Listenpreisen: ${summary.estimatedCostUsd.toFixed(2)} USD`);
console.log(`Gespeichert in data/llm_context_cache.json`);

// Dass die meisten Partien keine Faktoren haben, ist der erwartete Ausgang -- nicht ein
// Zeichen dafuer, dass die Recherche nicht funktioniert.
if (summary.fixturesWithFactors === 0 && summary.fixturesWithContext > 0) {
  console.log(
    `\nKeine Partie mit bemerkenswerten Faktoren. Das ist der Normalfall und kein Fehler.`
  );
}
