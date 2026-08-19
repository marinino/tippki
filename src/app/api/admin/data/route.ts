// Liste der gepflegten Dateien, plus je ein Link in den GitHub-Editor.
//
// Bearbeitet wird nicht hier, sondern dort: der Editor auf github.com bringt Diff,
// Historie und Zuruecknehmen mit, und ein Commit dort deployt diese Instanz ohnehin neu.
// Ein selbstgebautes Textfeld haette nichts davon -- dafuer die Moeglichkeit, den
// Spielplan mit einem Tippfehler unbemerkt unbrauchbar zu machen.

import { isAdminRequest } from "../../../../data/adminAuth";
import { dataFileStatus } from "../../../../data/dataFiles";

function repository(): string | null {
  const explicit = process.env.GITHUB_REPOSITORY;
  if (explicit) return explicit;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  return owner && slug ? `${owner}/${slug}` : null;
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 403 });
  }

  const repo = repository();
  const ref = process.env.GITHUB_DISPATCH_REF ?? "main";

  const dateien = dataFileStatus().map((f) => ({
    ...f,
    editUrl: repo ? `https://github.com/${repo}/edit/${ref}/data/${f.name}` : null,
    historieUrl: repo ? `https://github.com/${repo}/commits/${ref}/data/${f.name}` : null,
  }));

  // Der juengste Zeitstempel steht fuer den Stand der Auslieferung. Je Datei waere er in
  // der Cloud wertlos: dort stammen alle Aenderungsdaten aus dem Build und sind gleich.
  const zeitstempel = dateien
    .map((f) => f.geaendert)
    .filter((t): t is string => t !== null)
    .sort();
  const stand = zeitstempel.length > 0 ? zeitstempel[zeitstempel.length - 1] : null;

  return Response.json({ dateien, repository: repo, stand });
}
