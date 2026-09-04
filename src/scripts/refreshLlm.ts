// CLI-Zwilling zu POST /api/refresh-llm.
//
//   npm run refresh-llm
//   npm run refresh-llm -- --matchday=3
//
// Kostet echtes Geld (gemessen rund 0,37 USD fuer neun Partien), deshalb nur manuell --
// im Regelbetrieb loest die Automatik in spielkontext.yml aus.

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
console.log(`Recherchebericht: ${summary.researchChars} Zeichen.`);
console.log(`Geschaetzte Kosten zu Listenpreisen: ${summary.estimatedCostUsd.toFixed(2)} USD`);
console.log(`Gespeichert in data/llm_context_cache.json`);

// Ein erschoepftes Suchbudget hat Spieltag 1 gekostet, und zwar lautlos: das Modell bricht
// dann die Recherche ab und meldet fuer jede Partie "nichts gefunden". Deshalb steht der
// Hinweis hier oben und nicht in einer Logzeile.
if (summary.searchErrors.length > 0) {
  const codes = [...new Set(summary.searchErrors)].join(", ");
  console.log(`\nACHTUNG: ${summary.searchErrors.length} Suchfehler (${codes}).`);
  if (summary.searchErrors.includes("max_uses_exceeded")) {
    console.log(
      `Das Suchbudget war zu knapp. Die Nullbefunde unten sind deshalb nicht belastbar --\n` +
        `MAX_SEARCHES in src/llm/anthropicClient.ts anheben.`
    );
  }
}

// Dass die meisten Partien keine Faktoren haben, ist der erwartete Ausgang -- aber nur,
// wenn wirklich gesucht wurde. Ohne diese Unterscheidung sah Spieltag 1 aus wie ein
// ruhiger Spieltag.
if (summary.fixturesWithFactors === 0 && summary.fixturesWithContext > 0) {
  console.log(
    `\nKeine Partie mit bemerkenswerten Faktoren -- bei ${summary.usage.webSearches} Websuchen\n` +
      `und ${summary.researchChars} Zeichen Bericht. Bei zweistelliger Suchzahl und langem\n` +
      `Bericht ist das der Normalfall; bei kurzem Bericht hat die Recherche nichts hergegeben.`
  );
}
