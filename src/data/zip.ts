// Ein minimaler ZIP-Schreiber.
//
// Node bringt zlib mit, aber kein Archivformat, und eine Abhaengigkeit fuer "mehrere
// Dateien in einem Download" waere unverhaeltnismaessig. Geschrieben wird das kleinste
// gueltige ZIP: lokale Dateikoepfe, deflate-komprimierte Daten, zentrales Verzeichnis,
// End-of-Central-Directory. Kein ZIP64, keine Verschluesselung, keine Ordner -- fuer ein
// paar Megabyte CSV und JSON reicht das, und alles darueber hinaus waere Code, den
// niemand prueft.
//
// Alle Zahlenfelder sind little-endian, so will es die Formatbeschreibung (PKWARE APPNOTE).

import { deflateRawSync } from "node:zlib";

// CRC32 nach IEEE 802.3, wie ZIP es verlangt. Die Tabelle wird einmal gebaut.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

// MS-DOS-Zeitstempel: Sekunden in Zweierschritten, Jahr ab 1980. Grob, aber das Format
// kann nichts Feineres, und Archivprogramme erwarten genau das.
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const d =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: d };
}

export function createZip(entries: readonly ZipEntry[], now: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const compressed = deflateRawSync(entry.data);
    const sum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // Signatur
    local.writeUInt16LE(20, 4); // benoetigte Version
    local.writeUInt16LE(0x0800, 6); // Flags: Dateiname ist UTF-8
    local.writeUInt16LE(8, 8); // Methode: deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // kein Extra-Feld
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // erzeugende Version
    central.writeUInt16LE(20, 6); // benoetigte Version
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // Extra
    central.writeUInt16LE(0, 32); // Kommentar
    central.writeUInt16LE(0, 34); // Datentraeger
    central.writeUInt16LE(0, 36); // interne Attribute
    central.writeUInt32LE(0, 38); // externe Attribute
    central.writeUInt32LE(offset, 42); // Offset des lokalen Kopfes
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // Datentraegernummer
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // kein Archivkommentar

  return Buffer.concat([...locals, centralBuf, end]);
}
