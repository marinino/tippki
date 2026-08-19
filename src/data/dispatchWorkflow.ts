// Der manuelle Rueckfallweg der gehosteten Instanz.
//
// In der Cloud ist data/ schreibgeschuetzt -- ein Knopf, der dort selbst schreiben wollte,
// koennte es gar nicht. Statt einen zweiten Schreibpfad mit eigenem Speicher aufzumachen,
// stossen die Knoepfe denselben GitHub-Workflow an, den auch die Automatik benutzt. Es
// bleibt bei genau einem Weg, auf dem Daten entstehen: Actions -> Commit -> Deployment.
// Damit kann ein Handgriff aus dem Browser nichts erzeugen, was ein automatischer Lauf
// nicht auch erzeugt haette.

// Namen statt Dateipfaden: was hier nicht steht, laesst sich nicht ausloesen. Der
// Endpunkt nimmt einen Schluessel aus dieser Tabelle entgegen, nie einen Dateinamen aus
// dem Request.
const WORKFLOWS = {
  spielkontext: "spielkontext.yml",
  ergebnisse: "ergebnisse.yml",
  nachbereitung: "nachbereitung.yml",
} as const;

export type WorkflowName = keyof typeof WORKFLOWS;

export function isWorkflowName(value: unknown): value is WorkflowName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WORKFLOWS, value);
}

export function isDispatchConfigured(): boolean {
  return (process.env.GITHUB_DISPATCH_TOKEN ?? "").length > 0;
}

// Vercel legt Eigentuemer und Repo-Namen des verbundenen Projekts selbst in die Umgebung.
// Das spart eine Variable, die man von Hand setzen und beim Umbenennen nachziehen muesste.
function repository(): string {
  const explicit = process.env.GITHUB_REPOSITORY;
  if (explicit) return explicit;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  if (owner && slug) return `${owner}/${slug}`;
  throw new Error(
    "Repository unbekannt. GITHUB_REPOSITORY auf \"eigentuemer/repo\" setzen."
  );
}

export interface DispatchResult {
  dispatched: true;
  workflow: WorkflowName;
  repository: string;
  ref: string;
}

export async function dispatchWorkflow(
  workflow: WorkflowName,
  inputs: Record<string, string> = {}
): Promise<DispatchResult> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_DISPATCH_TOKEN fehlt. Ohne Token kann die gehostete Instanz keinen Lauf " +
        "ausloesen -- der Workflow laesst sich weiterhin auf GitHub selbst starten."
    );
  }

  const repo = repository();
  const ref = process.env.GITHUB_DISPATCH_REF ?? "main";

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOWS[workflow]}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref, inputs }),
    }
  );

  // GitHub antwortet auf einen angenommenen Dispatch mit 204 und leerem Rumpf. Alles
  // andere ist ein Fehler, und der Text daraus ist die einzige Spur, die der Nutzer sieht.
  if (res.status !== 204) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`GitHub lehnte den Lauf ab (${res.status}): ${detail || "kein Grund genannt"}`);
  }

  return { dispatched: true, workflow, repository: repo, ref };
}
