// Mapping von unseren (football-data.co.uk) Teamnamen auf die Understat-Bezeichnung,
// damit sich xG-Daten von Understat den Spielen in unseren CSVs zuordnen lassen.
export const OUR_NAME_TO_UNDERSTAT: Record<string, string> = {
  Augsburg: "Augsburg",
  "Bayern Munich": "Bayern Munich",
  Bielefeld: "Arminia Bielefeld",
  Bochum: "Bochum",
  Darmstadt: "Darmstadt",
  Dortmund: "Borussia Dortmund",
  "Ein Frankfurt": "Eintracht Frankfurt",
  // Fehlte bis zum 10.09.2026, und das war teuer: computeXgForm steigt bei fehlender
  // Zuordnung mit 0 aus. Elversberg hatte damit als einzige Mannschaft der Liga eine
  // dauerhaft abgeschaltete Formkurve -- nicht "keine Form gerade", sondern nie eine, die
  // ganze Saison lang. Aufgefallen ist es nur, weil im Formfenster "(nichts)" stand, wo bei
  // allen anderen zwei Spieldaten standen. Understat fuehrt den Verein unter genau diesem
  // Namen; es fehlte nichts als diese Zeile.
  Elversberg: "Elversberg",
  "FC Koln": "FC Cologne",
  "Fortuna Dusseldorf": "Fortuna Duesseldorf",
  Freiburg: "Freiburg",
  "Greuther Furth": "Greuther Fuerth",
  Hamburg: "Hamburger SV",
  Hannover: "Hannover 96",
  Heidenheim: "FC Heidenheim",
  Hertha: "Hertha Berlin",
  Hoffenheim: "Hoffenheim",
  "Holstein Kiel": "Holstein Kiel",
  Ingolstadt: "Ingolstadt",
  Leverkusen: "Bayer Leverkusen",
  "M'gladbach": "Borussia M.Gladbach",
  Mainz: "Mainz 05",
  Nurnberg: "Nuernberg",
  Paderborn: "Paderborn",
  "RB Leipzig": "RasenBallsport Leipzig",
  "Schalke 04": "Schalke 04",
  "St Pauli": "St. Pauli",
  Stuttgart: "VfB Stuttgart",
  "Union Berlin": "Union Berlin",
  "Werder Bremen": "Werder Bremen",
  Wolfsburg: "Wolfsburg",
};
