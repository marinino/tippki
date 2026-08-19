# Saisonbetrieb 2026/27

Die Saison ist der Vorwärtstest. Alles, was hier steht, dient einem Zweck: dass die Zahl am
Saisonende etwas bedeutet.

Eingefroren am **2026-08-19**, vor dem ersten Spieltag (28.08.2026).

```
Konfigurations-Hash    8ccc38ce
Prompt-Fingerabdruck   d7212c76
Zuordnungs-Abdruck     0c522175
LLM-Modell             claude-haiku-4-5
Kalibrierungstemperatur 1,20
```

Die Temperatur ist die letzte Änderung vor dem Einfrieren. Gescannt auf Validation
(2018–2022, 1529 Spiele), Testset unangetastet: mittlerer Kalibrierungsfehler 2,62 → 1,21
Prozentpunkte, LogLoss 1,0035 → 0,9954 (p < 0,0001), und die Verbesserung trägt jede der
fünf Saisons einzeln. Details und Messtabelle in `scoreMatrix.ts`.

---

## Der Ablauf je Spieltag

Die Reihenfolge ist nicht kosmetisch.

Seit der Saison 2026/27 läuft sie automatisch in GitHub Actions. Die Begründungen unten
haben sich dadurch nicht geändert — nur die Hand, die es auslöst. Wer wissen will, wie der
Zeitplan das trifft, findet es unter [Die Automatik](#die-automatik).

**Drei Stunden vor dem ersten Anpfiff des Spieltags** — freitags also gegen 17:30.

```bash
npm run refresh-llm
```

Recherchiert Ausfälle, Belastung und Motivation für alle neun Partien. Kostet rund 0,11 USD
je Aufruf. Nie bei einem Seitenaufruf und nie auf Verdacht — der inhaltliche Wert hängt am
Zeitpunkt, und ein Aufruf zehn Tage vorher überschreibt den Cache mit einem leeren Befund.

Warum genau drei Stunden, und warum ein einziger Aufruf für den ganzen Spieltag:

- **Ein Aufruf**, weil gebündelt 6–8 Suchen und ein Systemprompt anfallen statt 27–36 Suchen
  und neun Systemprompts. Der Cache ist entsprechend gebaut — ein `matchday`, ein
  `fetchedAt` —, ein zweiter Aufruf überschreibt den ersten.
- **So spät wie vertretbar**, weil ein Spieltag sich über 45 Stunden zieht (Fr 20:30 bis
  So 17:30). Ein Aufruf am Donnerstag hätte der Freitagspartie 27 Stunden Vorlauf gelassen
  und den Sonntagsspielen 72 — ausgerechnet die Hälfte des Spieltags ohne das, was den
  Layer wertvoll macht. Bei drei Stunden sind es 3 bis 46.
- **Nicht später**, aus zwei Gründen. `forward-log` überspringt jede Partie, die schon
  angepfiffen ist, und das Log ist append-only: eine übersprungene Partie fehlt dauerhaft.
  In das Fenster müssen aber Recherche, ein Blick in die `failures` des Caches, eventuell ein
  zweiter Versuch und `forward-log` passen. Und: Aufstellungen erscheinen 60–75 Minuten vor
  Anpfiff. Drei Stunden vorher liegt verlässlich davor — jeder Spieltag sieht dasselbe
  Informationsregime, statt mal mit und mal ohne Aufstellung.

**Dieser Zeitpunkt ist Teil des Eingefrorenen.** Er steht nicht im `configHash` und kann
dort auch nicht stehen — er ist eine Handlung, kein Parameter. Er verändert den
Informationsgehalt der Eingabe aber erheblich: wer zehn Spieltage früh recherchiert und
danach spät, sammelt zwei Populationen, die kein Hash je auseinanderhalten wird.

Genau deshalb ist das Zeitfenster der Automatik eng (±20 Minuten) und nicht großzügig.
Ein weites Fenster wäre bequemer und richtete exakt diesen Schaden an. Verpasst ein
Spieltag sein Fenster, bleibt er ohne Spielkontext — das ist ehrlicher als ein Spieltag mit
anderem Informationsstand, und die Zeile im Log sagt es (`llm: null`).

```bash
npm run forward-log
```

Friert beide Varianten ein, `model` und `withLlm`, für jede Partie. **Erst nach
`refresh-llm`.** Läuft es vorher, fällt `withLlm` mit `model` zusammen, und die
Idempotenz-Prüfung überspringt die Partien danach — die Zeilen wären dauerhaft wertlos für
den gepaarten Test.

**Nach dem Spielwochenende**

```bash
npm run refresh
npm run refresh-market
npm run forward-eval
```

`refresh` holt Ergebnisse (OpenLigaDB) und xG (Understat), `refresh-market` die
Buchmacher-Schlussquoten von football-data. Die kommen ein bis drei Tage nach dem Spieltag —
zu früh abgerufen fehlen sie noch. `forward-eval` rechnet ab: Spielkontext gegen Basismodell,
beide gegen den Buchmacher.

---

## Die Automatik

Drei Workflows in `.github/workflows/`. Sie führen genau die Skripte oben aus, committen
`data/` zurück, und der Push deployt die gehostete Instanz neu. Es gibt damit **einen
einzigen Weg, auf dem Daten entstehen** — auch der Admin-Knopf im Browser stößt nur diese
Workflows an, statt selbst zu schreiben.

| Workflow | Wann | Was |
|---|---|---|
| `spielkontext.yml` | alle 15 min, 08–16 UTC, Di/Mi/Fr/Sa/So | prüft die Fälligkeit; im Fenster: `refresh-llm`, dann `forward-log` |
| `ergebnisse.yml` | alle 30 min, 15–22 UTC, Di/Mi/Fr/Sa/So | `refresh` — Ergebnisse und xG |
| `nachbereitung.yml` | Mo + Di + Do, 07:00 UTC | `fetch-fixtures`, `refresh`, `refresh-market`, `forward-eval`, Vorschau aufs nächste Fenster |

### Der Spielplan wächst mit

Die DFL setzt die genauen Anstoßzeiten erst sechs bis acht Wochen im Voraus an; bis dahin
liegt bei OpenLigaDB jede Partie im Standardslot samstags 15:30. Das Recherchefenster
berechnet sich aus dem *ersten* Anpfiff eines Spieltags — steht dort samstags 15:30,
während in Wirklichkeit freitags um 20:30 eröffnet wird, recherchiert die Automatik am
Samstagmittag, also nach dem Freitagsspiel.

Deshalb läuft `fetch-fixtures` an **drei** Stellen:

1. In `spielkontext.yml` **vor** der Fälligkeitsprüfung, bei jedem der viertelstündlichen
   Ticks. Die Entscheidung wird damit nie aus veralteten Zeiten berechnet — sie ist die
   einzige Frage, die dieser Workflow stellt, und aus einem alten Spielplan wäre die
   Antwort schlicht falsch. Schlägt der Abruf fehl, läuft der Workflow mit dem bisherigen
   Spielplan weiter, statt die Recherche ausfallen zu lassen.
2. In `nachbereitung.yml`, montags, dienstags und donnerstags.
3. Von Hand über `npm run fetch-fixtures`.

Verschiebt sich dabei eine Anstoßzeit, wird sie sofort committet und ausgeliefert — auch
wenn im selben Lauf gar nicht recherchiert wurde. Zwei Sicherungen im Skript: es bricht ab,
statt einen auf unter 90 % geschrumpften Spielplan zu schreiben, und von Hand gesetzte
Wappen in `teamLogos.json` bleiben stehen.

**Was passiert, wenn eine Ansetzung aus dem Zeitplan fällt.** Verlegt die DFL einen
Spieltagsauftakt auf einen Montag oder auf 13:00, läge das Fenster außerhalb der
`cron`-Zeilen, und der Spieltag fiele stumm durch. Deshalb läuft `npm test` als letzter
Schritt der Nachbereitung: der Abschnitt „Recherchefenster" rechnet für alle 34 Spieltage
nach, dass ihr Fenster auf einen abgedeckten UTC-Wochentag und in dessen Stundenfenster
fällt. Der Lauf wird rot — Wochen bevor der betroffene Spieltag ansteht, und ohne dass
Daten verloren gehen, weil vorher schon committet wurde. Das ist der Grund, aus dem das
Stundenfenster eng bleiben darf: eine Lücke meldet sich von selbst.

**Absetzungen.** Wird eine einzelne Partie in den Dezember verlegt, ist der nächste
Spieltag trotzdem der nächste *chronologisch* — nicht die kleinste Spieltagsnummer, die
noch etwas vor sich hat. Sonst bliebe der 5. bis Dezember der „nächste", sein Fenster läge
im Dezember, und die Spieltage 6 bis 15 liefen unrecherchiert durch. Siehe
`nextMatchdayOf` in [kickoff.ts](src/data/kickoff.ts).

Aus all dem folgt: der Zeitplan bleibt breiter, als er heute sein müsste. Nach dem
derzeitigen Spielplan lägen 28 von 34 Fenstern samstags — auf Fr/Sa/Di eingedampft würde
das rund 40 % sparen und genau dann brechen, wenn die echten Termine kommen.

**Warum der Zeitplan stumpf ist und die Entscheidung im Skript liegt.** Cron in GitHub
Actions feuert nicht pünktlich, sondern irgendwann in den Minuten danach, unter Last auch
deutlich später. Ein Workflow, der „um 17:30" recherchiert, recherchiert in Wahrheit
irgendwann zwischen 17:30 und 17:50. Deshalb läuft die Prüfung viertelstündlich, und
[researchWindow.ts](src/data/researchWindow.ts) entscheidet: liegt der erste Anpfiff des
nächsten Spieltags gerade drei Stunden ± 20 Minuten entfernt? Ein verspäteter Tick fällt so
in denselben Korridor wie ein pünktlicher. Zwei Sperren stehen daneben: der Cache eines
bereits recherchierten Spieltags wird nicht überschrieben (sonst kostete jeder Tick im
Fenster erneut Geld), und näher als 90 Minuten vor Anpfiff läuft nichts mehr — dann stehen
die Aufstellungen.

**Zeitzonen.** In `fixtures.json` stehen Anstoßzeiten ohne Zone (`2026-08-28T20:30:00`).
`new Date()` liest so etwas als Ortszeit der ausführenden Maschine — auf einem Runner in
UTC also zwei Stunden zu spät, im Winter eine. Deshalb geht jede Anstoßzeit durch
[parseKickoff](src/data/kickoff.ts), das den String explizit als Europe/Berlin liest, mit
korrektem Verhalten über beide Zeitumstellungen. Der selfCheck-Abschnitt „Anstoßzeiten sind
zeitzonenfest" vergleicht gegen absolute UTC-Zeitpunkte und läuft deshalb auf einem
deutschen Laptop wie auf einem UTC-Runner gleich durch. Die gefährlichste Stelle war nicht
die Anzeige, sondern die Sperre in `forward-log`, die nach Anpfiff nicht mehr protokolliert:
unter UTC hätte ein laufendes Spiel zwei Stunden lang noch zukünftig ausgesehen.

**Läuft ein Fenster aus dem Zeitplan?** Der selfCheck rechnet für alle 34 Spieltage nach,
dass das Recherchefenster auf einen abgedeckten UTC-Wochentag und in das Stundenfenster
fällt. Ein Spielplan mit einer Montagspartie als Auftakt würde dort auffliegen, nicht erst
im Oktober. `nachbereitung.yml` zeigt zusätzlich jede Woche, wann das nächste Fenster liegt.

**Was in GitHub hinterlegt sein muss:** ein einziges Secret, `ANTHROPIC_API_KEY`. Sonst
nichts — den Rest erledigt der mitgelieferte `GITHUB_TOKEN`.

**Kosten.** Rund 1150 Läufe im Monat. GitHub rechnet je Lauf mindestens eine Minute ab, für
private Repositories sind 2000 Minuten im Monat frei — also etwa 60 % des Kontingents. Wird
es eng, ist der Hebel das Stundenfenster in den `cron`-Zeilen, nicht die Taktung.

---

## Die gehostete Instanz

Was online steht, ist ein Abbild des letzten Commits — nicht mehr und nicht weniger.

Die App liest ihre Daten aus `data/`, und ein Deployment hat dort kein Schreibrecht. Beide
Aktualisierungsknöpfe sind deshalb serverseitig gesperrt (403) und in der Oberfläche gar
nicht erst sichtbar; `readOnly` in der Antwort von `/api/predictions` steuert das. Der
Schalter ist `NODE_ENV`: `next dev` zeigt die Knöpfe, ein Build nicht, und die tsx-Skripte
laufen ohnehin daran vorbei.

Das ist nicht nur eine technische Notwendigkeit. Ein öffentlich klickbarer
Recherche-Knopf würde den Cache zu einem beliebigen Zeitpunkt überschreiben — und der
Zeitpunkt gehört zum Eingefrorenen. Nebenbei gäbe er fremdes Geld aus. **Auf dem Hoster
gehört kein `ANTHROPIC_API_KEY` hinterlegt** — dort recherchiert nichts, der Key gehört in
die GitHub-Secrets.

### Admin-Modus

Ein Passwortfeld, mehr nicht. Ist `ADMIN_PASSWORD` gesetzt, erscheint unter dem Kopf ein
unscheinbarer „Admin"-Link; nach der Anmeldung kommen die beiden Knöpfe zurück. Sie
schreiben dann nicht selbst, sondern stoßen den passenden Workflow an — derselbe Weg wie
bei der Automatik, nur von Hand ausgelöst. Dafür braucht die Instanz zusätzlich
`GITHUB_DISPATCH_TOKEN` (fein granuliert, nur dieses Repository, „Actions: Read and
write"). Fehlt er, sagt die Oberfläche das, und die Workflows lassen sich weiterhin auf
GitHub selbst starten.

Der Recherche-Knopf setzt `erzwingen=true` — er übergeht also das Zeitfenster und die
Idempotenzsperre. Genau dafür ist er da: wenn der planmäßige Lauf ausgefallen ist. Die
90-Minuten-Grenze vor Anpfiff bleibt trotzdem stehen, und nach Anpfiff läuft gar nichts
mehr.

Ohne gesetztes `ADMIN_PASSWORD` gibt es keinen Login, keine Knöpfe und keine Anmeldemaske —
die Instanz ist dann rein zum Anschauen. Die Sperre sitzt in den Routen selbst, nicht in
der Oberfläche: wer das Flag im Browser umbiegt, sieht Knöpfe, die 403 liefern.

### An die Daten kommen

Der Reiter **Daten** erscheint nur für einen angemeldeten Admin. Er listet jede gepflegte
Datei mit Größe, einzeln herunterladbar, dazu „Alles herunterladen" als ZIP — die
historischen Saison-CSVs eingeschlossen, rund 470 kB für 1,9 MB Daten. Das ist der Weg für
Auswertungen und für eine lokale Arbeitskopie.

Bearbeitet wird **nicht** hier, sondern auf GitHub: je Datei ein Link in den Editor und
einen in die Historie. Dort gibt es Diff, Zurücknehmen und eine nachvollziehbare
Änderungsspur — alles, was ein Textfeld in dieser Oberfläche nicht hätte, dafür aber ohne
die Möglichkeit, den Spielplan mit einem Tippfehler unbemerkt unbrauchbar zu machen. Ein
Commit dort stößt ohnehin ein Deployment an, nach ein bis zwei Minuten steht die Änderung
hier.

Der Endpunkt gibt nur Namen aus einer festen Liste heraus
([dataFiles.ts](src/data/dataFiles.ts)), nie einen Pfad aus dem Request — `../../.env` ist
damit kein Dateiname, sondern ein unbekannter Eintrag.

Absichtlich ohne Zeitstempel je Datei: in der Cloud stammen die Änderungsdaten aus dem
Build und stünden für alle Dateien gleich. Was gilt, ist der Stand der Auslieferung, und
der steht einmal oben.

### Was committet wird

`data/D1_2627.csv` (Ergebnisse und Schlussquoten), `data/xg_bundesliga.json` (xG),
`data/llm_context_cache.json` (die Recherche) und `data/forward_log.jsonl` (die Evidenz).
Die Workflows erledigen das; von Hand ginge es genauso.

**`data/forward_log.jsonl` ist seit der Automatik versioniert.** Vorher stand es in
`.gitignore` — das ging, solange `forward-log` auf einem Rechner lief, der stehen bleibt.
In einem Wegwerf-Container wäre die Evidenz der Saison nach jedem Lauf weg. Versioniert
bekommt sie außerdem etwas, das eine append-only-Datei allein nicht hat: eine nachprüfbare
Historie. Wer eine einmal abgegebene Vorhersage nachträglich ändert, ändert damit auch die
Commit-Kette.

### Der Marker auf der Karte

Vier Zustände statt eines Ja/Nein, weil „reines Modell" bisher drei sehr verschiedene Fälle
zusammenwarf:

| Anzeige | Bedeutung |
|---|---|
| Modell + Kontext | recherchiert, Torerwartung korrigiert |
| recherchiert · ohne Befund | recherchiert, nichts gefunden, was die Zahlen bewegt |
| Recherche fehlgeschlagen | Lauf war da, Antwort nicht zuzuordnen — steht mit Grund in den Details |
| reines Modell | für diese Partie wurde nicht recherchiert |

Der Unterschied trägt: läuft die Automatik still ins Leere, sah das vorher aus wie ein
unauffälliger Spieltag. Und beim Beobachten der Korrekturgrößen (siehe unten) ist „inert"
etwas anderes als „hat nie stattgefunden".

---

## Eingefroren — nicht anfassen

**Die Faustregel: steht es im `configHash`, ist es eingefroren.** Das ist keine Konvention,
sondern mechanisch geprüft — [selfCheck.ts](src/scripts/selfCheck.ts), Abschnitt
„Konfigurations-Hash", geht jedes einzelne Feld durch und verlangt, dass es den Hash bewegt.

| Was | Wo | Wert |
|---|---|---|
| Saison-Gewichte | `teamStrength.ts` | `SEASON_RECENCY_WEIGHTS` |
| Form-Fenster und -Gewicht | `xgForm.ts` | `XG_FORM_WINDOW`, `XG_FORM_WEIGHT` |
| Matrix-Parameter | `scoreMatrix.ts` | `RHO`, `DRAW_BOOST`, `MAX_GOALS` |
| Kalibrierungstemperatur | `scoreMatrix.ts` | `DEFAULT_OUTCOME_TEMPERATURE` = 1,20 |
| Ridge | `pipelineConfig.ts` | `ridgePseudoMatches` |
| LLM-Dämpfung | `llmAdjustment.ts` | `DEFAULT_LLM_GAIN` = 0,6 |
| LLM-Klammer | `llmAdjustment.ts` | `DEFAULT_LLM_MAX_LOG_ADJUSTMENT` = 0,15 |
| Rechercheanweisung | `matchContext.ts` | `SYSTEM_PROMPT`, `buildMatchdayPrompt` |
| Faktengewichte | `factMapping.ts` | `ROLE_WEIGHTS`, `IMPORTANCE_SCALE`, Aggregation |
| Sprachmodell | `modelProfile.ts` / `LLM_MODEL` | `claude-haiku-4-5` |

Dazu kommt seit der Automatik ein Wert, der **nicht** im `configHash` steht und trotzdem
eingefroren ist: `LEAD_MINUTES` = 180 in [researchWindow.ts](src/data/researchWindow.ts).
Das ist der Recherchezeitpunkt, der oben als „eine Handlung, kein Parameter" beschrieben
ist — er ist jetzt beides. Dass er in Code steht, macht ihn nachprüfbar, aber nicht
beliebig: ihn im Saisonverlauf zu verschieben erzeugt genau die zwei Populationen, vor
denen der Abschnitt oben warnt, und der Hash würde es diesmal nicht einmal anzeigen.
`TOLERANCE_MINUTES` und `HARD_FLOOR_MINUTES` sind Betriebsparameter und dürfen sich
bewegen, solange das Fenster eng bleibt.

**Warum.** Der LLM-Layer lässt sich nicht backtesten — das Modell hinter dem LLM kennt den
Ausgang alter Spiele. Das Vorwärts-Log ist die einzige ehrliche Evidenz, die es je geben
wird. Diese Parameter im Saisonverlauf an den eigenen Ergebnissen nachzuziehen verbrennt sie
genauso, wie Tunen auf dem Testset das Testset verbrennt — nur ohne Rettungsanker: ein
zweites Vorwärtsjahr kostet ein Jahr.

Dazu die Fallzahl. 306 Spiele je Saison, davon vielleicht die Hälfte mit echtem Unterschied.
Ein Effekt von 0,005 RPS — die Größenordnung, die den Marktabstand schließen würde — braucht
ein Vielfaches davon. Was nach zehn Spieltagen sichtbar wird, ist Rauschen, und ein
Parameter, der auf Rauschen gedreht wird, wird schlechter.

**Wie lange.** Nicht bis Saisonende, sondern bis genug Vorwärtsevidenz da ist, sie zu
bewegen. Realistisch zwei bis drei Saisons. 0,6 ist ein bewusst zurückhaltender Prior, kein
gefitteter Wert.

**Was passiert, wenn doch.** Der Hash ändert sich, `forward-eval` gruppiert danach und
weigert sich ohne `--pool`, darüber hinweg zu mitteln. Aus einer Saison à 306 werden zwei à
150, und keine davon löst etwas auf. Das ist kein Schutz vor der Änderung — nur davor, dass
sie unbemerkt bleibt.

---

## Frei — jederzeit änderbar

Alles, was die Vorhersage nicht verändert:

- **Auswertung** (`src/eval/`) — Metriken, Signifikanztests, Kalibrierung, Ausgabeformate.
  Rückwirkend auf alle geloggten Zeilen anwendbar, deshalb harmlos.
- **UI** (`src/app/`) — Darstellung, Sortierung, was angezeigt wird.
- **Skripte und CLI-Ausgaben** (`src/scripts/`) — solange sie nichts an der Pipeline drehen.
- **Datenaktualisierung** — `refresh`, `refresh-market`, Teamnamen-Zuordnungen, Fixtures.
- **Zeitpläne** — die `cron`-Zeilen in `.github/workflows/`, solange das Recherchefenster
  weiter getroffen wird. Der selfCheck prüft genau das.
- **Admin-Modus und Hosting** — Passwort, Token, Oberfläche. Sie verändern keine Zahl.
- **Tests** — neue Prüfungen sind immer willkommen.

---

## Beobachten, aber nicht nachdrehen

Diese drei Dinge sagen etwas über das *Verhalten* des Layers, nicht über seine Trefferquote.
Sie kosten deshalb nichts und sollten laufend angeschaut werden:

1. **Größe der Korrekturen** — `homeLogAdj` / `awayLogAdj` in jeder Logzeile, in der UI als
   „Torerwartung Heim −8 %, Auswärts +6 %". Liegen sie durchweg bei 0,01, ist der Layer
   faktisch inert und die Frage nach dem richtigen Gain verfrüht.
2. **Wie oft die Klammer greift** — schlägt sie ständig an, ist die Recherche zu
   enthusiastisch oder die Aggregation zu additiv.
3. **Qualität der Fakten** — findet das LLM die Ausfälle, die es wirklich gab? War
   „bestätigt" bestätigt? Stimmen die Quellen? Das prüfst du gegen die öffentliche Realität,
   nicht gegen Ergebnisse. Hier sitzt vermutlich der größere Hebel: ein falsch extrahierter
   Fakt ist durch keinen Gain zu retten.

Beobachtung ist keine Erlaubnis zum Nachdrehen. Wird ein Befund groß genug, wird er
aufgeschrieben und **nach** der Saison umgesetzt.

---

## Sonderfall: ein echter Fehler

Ein Fehler ist kein Tuning-Wunsch. Fällt in der Saison auf, dass etwas nachweislich falsch
rechnet — nicht „suboptimal", sondern falsch —, wird es repariert. Dann gilt:

1. Reparieren, Grund im Code dokumentieren.
2. Der Hash ändert sich. Das ist richtig so: es *ist* eine andere Pipeline.
3. Im Log stehen ab da zwei Gruppen. `forward-eval` wertet sie getrennt aus. Nicht `--pool`
   benutzen, um das zu übertünchen.

Die Grenze ist nicht immer scharf. Der Test: lässt sich die Änderung begründen, **ohne** auf
die Ergebnisse dieser Saison zu schauen? Dann ist es eine Reparatur. Sonst ist es Tuning.

---

## Am Saisonende

`npm run forward-eval` über die volle Saison. Erwartungshaltung: die Zahl wird das
Konfidenzintervall nicht verlassen. Das ist kein Scheitern, sondern die Fallzahl — 306 Spiele
sind ein Anfang, keine Antwort. Der Wert liegt darin, dass die Zahl **ehrlich** ist und mit
der nächsten Saison zusammengelegt werden kann.

Erst dann werden die eingefrorenen Parameter wieder angefasst.
