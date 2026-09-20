import { useMemo, useState } from "react";
import type { ImportResult } from "@mapper/client";
import { createMapperClient } from "@mapper/client";
import { MapperImporter } from "@mapper/react";

export function App() {
  const client = useMemo(() => createMapperClient("/mapper"), []);
  const [result, setResult] = useState<ImportResult>();

  return (
    <div className="demo-shell">
      <div className="demo-intro">
        <p className="demo-kicker">Mapper Frontend SDK</p>
        <h1>CSV to stable schema importer</h1>
        <p>Upload source data, connect columns to schema fields, submit typed rows.</p>
      </div>
      <MapperImporter client={client} schemaId={7} onImported={setResult} />
      {result ? (
        <aside className="demo-result" aria-label="Import result">
          <strong>Latest import</strong>
          <span>{result.succeeded} succeeded · {result.failed} failed</span>
        </aside>
      ) : null}
    </div>
  );
}
