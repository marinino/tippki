// Eine einzelne gepflegte Datei herunterladen -- oder mit dem Namen "alles.zip" das
// ganze Verzeichnis auf einmal, historische Saisons eingeschlossen.

import { readdirSync } from "fs";
import { join } from "path";
import { isAdminRequest } from "../../../../../data/adminAuth";
import {
  ARCHIVE_PATTERN,
  contentTypeOf,
  isKnownDataFile,
  readDataFile,
} from "../../../../../data/dataFiles";
import { createZip, type ZipEntry } from "../../../../../data/zip";

const BUNDLE = "alles.zip";

export async function GET(request: Request, context: { params: Promise<{ name: string }> }) {
  if (!isAdminRequest(request)) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 403 });
  }

  const { name } = await context.params;

  if (name === BUNDLE) {
    const dir = join(process.cwd(), "data");
    const entries: ZipEntry[] = [];
    for (const file of readdirSync(dir).sort()) {
      if (!isKnownDataFile(file) && !ARCHIVE_PATTERN.test(file)) continue;
      const data = readDataFile(file);
      if (data) entries.push({ name: file, data });
    }
    const zip = createZip(entries);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="tippki-daten.zip"`,
        "Content-Length": String(zip.length),
        "Cache-Control": "no-store",
      },
    });
  }

  const data = readDataFile(name);
  if (!data) {
    return Response.json({ error: "Unbekannte Datei." }, { status: 404 });
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeOf(name),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(data.length),
      "Cache-Control": "no-store",
    },
  });
}
