/** @type {import('next').NextConfig} */
const nextConfig = {
  // Der Typecheck laeuft ueber `npm test` (tsgo, TypeScript 7). Next bringt seinen
  // eigenen mit und erwartet dafuer die klassische Compiler-API, die es in TS 7 nicht
  // mehr gibt -- der Build bricht sonst ab, bevor er ueberhaupt anfaengt.
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
