import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Beide Schriften werden beim Build heruntergeladen und selbst ausgeliefert -- zur
// Laufzeit geht kein Request an Google.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Nur fuer Titel, Sektionsueberschriften und die Tipp-Ziffer. Die optische
// Groessenachse laesst die Schrift bei 34 px anders zeichnen als bei 16 px.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata = {
  title: "Tippki",
  description: "Faire Bundesliga-Quoten aus einem Dixon-Coles-Modell, ohne Buchmacherdaten",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
