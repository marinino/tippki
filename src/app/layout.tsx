import { Fraunces, Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { THEME_BOOTSTRAP } from "./lib/theme";

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

// Support-Widget von HappySupport. Die Kennung im Pfad ("tippki") ist der Mandant; mehr
// braucht der Anbieter nicht, um die richtige Wissensbasis auszuliefern.
//
// Der Identitaetsblock aus der Anleitung (user + userJwt) fehlt hier bewusst: Tippki hat
// keine Benutzer, nur ein geteiltes Admin-Passwort und ansonsten anonyme Besucher. Es
// gibt also keine stabile Kennung, die man signieren koennte -- und eine erfundene waere
// schlechter als keine, weil dann alle Besucher als dieselbe Person gefuehrt wuerden.
//
// Der Aufrufpuffer bleibt trotzdem stehen: er nimmt HappyWidget(...)-Aufrufe entgegen,
// die vor dem Laden des Skripts passieren, und spielt sie danach nach.
const HAPPY_WIDGET_BOOTSTRAP = `
window.HappyWidget = window.HappyWidget || function () {
  (window.HappyWidget.q = window.HappyWidget.q || []).push(arguments);
};
window.HappyWidgetConfig = {};
`;

export const metadata = {
  title: "Tippki",
  description: "Faire Bundesliga-Quoten aus einem Dixon-Coles-Modell, ohne Buchmacherdaten",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning, weil das Skript unten data-theme auf genau dieses
    // Element schreibt, bevor React uebernimmt -- der Server kann das nicht wissen.
    <html
      lang="de"
      className={`${inter.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Roh und inline, nicht ueber next/script: das Umschalten der Flaechen muss vor
            dem ersten Anstrich passieren, sonst blitzt die dunkle Ansicht auf. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        {/* Die Reihenfolge ist das Einzige, was hier zaehlt: widget.js liest die
            Konfiguration beim Start, sie muss also vorher stehen. beforeInteractive
            landet im ersten HTML, afterInteractive erst nach der Hydration -- damit ist
            der Abstand gross genug.

            lazyOnload waere fuer ein Support-Widget die naheliegendere Wahl, haengt in
            App Router aber am load-Ereignis und fuegt das Tag dann gar nicht mehr ein. */}
        <Script id="happy-widget-config" strategy="beforeInteractive">
          {HAPPY_WIDGET_BOOTSTRAP}
        </Script>
        <Script
          src="https://api.happysupport.ai/v1/widget/tippki/widget.js"
          data-language="de"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
