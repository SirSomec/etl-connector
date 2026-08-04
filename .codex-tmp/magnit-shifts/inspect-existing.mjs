import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const workDir = path.dirname(fileURLToPath(import.meta.url));
const workbookPath = path.resolve(workDir, "../../outputs/2026-07-27-magnit-operator-cancellations/magnit-operator-cancellations-2026-07.xlsx");
const outputPath = path.join(workDir, "existing-layout.png");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));

const inspection = await workbook.inspect({
  kind: "workbook,sheet,table,computedStyle",
  range: "Отмены оператором!A1:F10",
  maxChars: 7000,
  tableMaxRows: 10,
  tableMaxCols: 6
});
console.log(inspection.ndjson);

const preview = await workbook.render({
  sheetName: "Отмены оператором",
  range: "A1:F18",
  scale: 1.25,
  format: "png"
});
await fs.writeFile(outputPath, new Uint8Array(await preview.arrayBuffer()));
console.log(outputPath);
