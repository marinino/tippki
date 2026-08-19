/** @type {import('next').NextConfig} */
const nextConfig = {
  // Der Typecheck laeuft ueber `npm test` und in der Nachbereitung -- ihn beim Deployment
  // ein zweites Mal zu bezahlen bringt nichts.
  //
  // Achtung, das ist NICHT der Schalter, der Next von TypeScript unabhaengig macht: Next
  // betritt die Typecheck-Phase auch dann und laedt dabei die klassische Compiler-API.
  // TypeScript 7 (tsgo) bringt nur die CLI mit, keine API. Ausserhalb von CI faellt das
  // nicht auf, weil Next sich dann still eine nachinstalliert; unter CI=1 -- also bei
  // Vercel und in GitHub Actions -- bricht der Build kommentarlos ab, mit nichts als
  // "buildStage": "type-checking" in .next/diagnostics/. Deshalb steht in den
  // devDependencies TypeScript 5. Wer wieder auf 7 geht, muss das hier mitdenken.
  typescript: { ignoreBuildErrors: true },

  // Die CSVs und JSONs unter data/ werden zur Laufzeit gelesen, aber nirgends importiert.
  // Ohne diesen Eintrag packt Next sie nicht ins Serverbuendel, und in der Cloud fehlt
  // genau das, woraus das Modell gebaut wird.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
    "/": ["./data/**"],
  },
};

export default nextConfig;
