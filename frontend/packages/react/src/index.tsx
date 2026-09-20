import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type {
  ImportResult,
  MapperClient,
  Schema,
  SourceAnalysis
} from "@mapper/client";
import {
  ImporterStatus,
  connect,
  createMapperState,
  disconnectTarget,
  transitionMapperState,
  validateMappings
} from "@mapper/core";
import type {
  MappingSchema,
  MappingSourceColumn,
  MappingSpec,
  MappingTargetField,
  MapperErrorState,
  MapperState
} from "@mapper/core";
import {
  MultipartUploadAdapter,
  type UploadAdapter
} from "@mapper/upload";

import "./styles.css";

export interface ReactFlowNode {
  id: string;
  type: "source" | "target";
  position: { x: number; y: number };
  data: {
    kind: "source" | "target";
    label: string;
    index: number;
    required?: boolean;
  };
}

export interface ReactFlowEdge {
  id: string;
  source: string;
  target: string;
  data: {
    source_index: number;
    target_index: number;
  };
}

export interface ReactFlowGraph {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
}

export function ReactFlowAdapter(
  spec: MappingSpec,
  sourceColumns: readonly (string | MappingSourceColumn)[],
  targetFields: readonly MappingTargetField[]
): ReactFlowGraph {
  const sourceNodes = sourceColumns.map((column, index) => {
    const source = typeof column === "string" ? { index, name: column } : column;
    return {
      id: `source-${source.index}`,
      type: "source" as const,
      position: { x: 0, y: source.index * 64 },
      data: { kind: "source" as const, label: source.name, index: source.index }
    };
  });
  const targetNodes = targetFields.map((field, index) => ({
    id: `target-${index}`,
    type: "target" as const,
    position: { x: 360, y: index * 64 },
    data: { kind: "target" as const, label: field.name, index, required: field.required }
  }));
  const targetIndexByID = new Map(targetFields.map((field, index) => [field.id, index]));
  const edges = spec.mappings.flatMap((mapping, index) => {
    const targetIndex = targetIndexByID.get(mapping.target);
    if (targetIndex === undefined) {
      return [];
    }
    return [{
      id: `mapping-${mapping.source}-${targetIndex}-${index}`,
      source: `source-${mapping.source}`,
      target: `target-${targetIndex}`,
      data: { source_index: mapping.source, target_index: targetIndex }
    }];
  });
  return { nodes: [...sourceNodes, ...targetNodes], edges };
}

export interface MappingEditorProps {
  sourceColumns: readonly (string | MappingSourceColumn)[];
  targetFields: readonly MappingTargetField[];
  value: MappingSpec;
  onChange: (value: MappingSpec) => void;
  disabled?: boolean;
  validation?: { errors: readonly { message: string }[] };
  className?: string;
}

export function MappingEditor({
  sourceColumns,
  targetFields,
  value,
  onChange,
  disabled = false,
  validation,
  className
}: MappingEditorProps) {
  const sourceByIndex = new Map(
    sourceColumns.map((column, index) => {
      const source = typeof column === "string" ? { index, name: column } : column;
      return [source.index, source.name] as const;
    })
  );
  const sourceOptions = sourceColumns.map((column, index) =>
    typeof column === "string" ? { index, name: column } : column
  );
  const sourceByTarget = new Map(value.mappings.map((mapping) => [mapping.target, mapping.source]));
  const graph = ReactFlowAdapter(value, sourceColumns, targetFields);
  const classes = ["mapper-editor", className].filter(Boolean).join(" ");

  function changeTarget(target: number, rawSource: string) {
    const next = rawSource === ""
      ? disconnectTarget(value, target)
      : connect(value, Number(rawSource), target);
    onChange(next);
  }

  return (
    <section className={classes} aria-label="Mapping editor">
      <div className="mapper-editor__header">
        <h2>Map columns</h2>
        <span className="mapper-importer__muted">
          {graph.edges.length} connection{graph.edges.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mapper-editor__mapping-list">
        {targetFields.map((target, targetIndex) => {
          const source = sourceByTarget.get(target.id);
          return (
            <div className="mapper-editor__mapping" key={`target-${targetIndex}`}>
              <label htmlFor={`mapper-target-${targetIndex}`}>
                {target.name}{target.required ? " *" : ""}
              </label>
              <select
                id={`mapper-target-${targetIndex}`}
                aria-label={`Source for ${target.name}`}
                disabled={disabled}
                value={source === undefined ? "" : String(source)}
                onChange={(event) => changeTarget(target.id, event.currentTarget.value)}
              >
                <option value="">Unmapped</option>
                {sourceOptions.map((column) => (
                  <option key={`source-${column.index}`} value={column.index}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <div className="mapper-editor__graph" aria-label="Derived mapping graph">
        {graph.edges.length === 0 ? (
          <span className="mapper-importer__muted">No connections yet.</span>
        ) : (
          graph.edges.map((edge) => (
            <div className="mapper-editor__edge" key={edge.id}>
              <span>{sourceByIndex.get(edge.data.source_index) ?? `Column ${edge.data.source_index}`}</span>
              <span className="mapper-editor__arrow" aria-hidden="true">→</span>
              <span>{targetFields[edge.data.target_index]?.name ?? "Unknown target"}</span>
            </div>
          ))
        )}
      </div>
      {validation && validation.errors.length > 0 ? (
        <div className="mapper-editor__errors" role="alert">
          <ul>
            {validation.errors.map((error, index) => <li key={`${error.message}-${index}`}>{error.message}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

type ImporterState = MapperState<Schema, SourceAnalysis, ImportResult>;

export interface MapperImporterProps {
  client: MapperClient;
  schemaId: number;
  uploadAdapter?: UploadAdapter;
  initialMapping?: Partial<MappingSpec>;
  onImported?: (result: ImportResult) => void;
  className?: string;
}

export function MapperImporter({
  client,
  schemaId,
  uploadAdapter,
  initialMapping,
  onImported,
  className
}: MapperImporterProps) {
  const [state, setState] = useState<ImporterState>(() => {
    const mapping: MappingSpec = {
      file_id: initialMapping?.file_id ?? "",
      schema_id: initialMapping?.schema_id ?? schemaId,
      sheet: initialMapping?.sheet ?? 0,
      mappings: initialMapping?.mappings?.map((mapping) => ({ ...mapping })) ?? []
    };
    return createMapperState(mapping) as ImporterState;
  });

  useEffect(() => {
    let active = true;
    setState((current) => transitionMapperState(current, { type: "analysis_started" }));
    client.getSchema(schemaId).then((schema) => {
      if (!active) return;
      setState((current) => transitionMapperState(current, { type: "ready", schema }));
    }).catch((error: unknown) => {
      if (!active) return;
      setState((current) => transitionMapperState(current, { type: "failed", error: toErrorState(error) }));
    });
    return () => {
      active = false;
    };
  }, [client, schemaId]);

  const sheet = state.analysis?.sheets[state.mapping.sheet] ?? state.analysis?.sheets[0];
  const sourceColumns = sheet?.columns ?? [];
  const schema = state.schema;
  const validation = schema
    ? validateMappings(state.mapping, schema as MappingSchema, sourceColumns.length)
    : undefined;
  const adapter = useMemo(
    () => uploadAdapter ?? new MultipartUploadAdapter(client),
    [client, uploadAdapter]
  );
  const classes = ["mapper-importer", className].filter(Boolean).join(" ");
  const busy = state.status === ImporterStatus.Uploading ||
    state.status === ImporterStatus.Analyzing ||
    state.status === ImporterStatus.Importing;

  async function handleFile(file: File) {
    setState((current) => transitionMapperState(current, { type: "upload_started" }));
    try {
      const analysis = await adapter.upload(file, file.name);
      const schemaValue = state.schema ?? await client.getSchema(schemaId);
      setState((current) => transitionMapperState(current, { type: "analysis_started" }));
      setState((current) => transitionMapperState(current, {
        type: "mapping_changed",
        mapping: { ...current.mapping, file_id: analysis.file.id, schema_id: schemaId, sheet: 0, mappings: [] }
      }));
      setState((current) => transitionMapperState(current, {
        type: "ready",
        schema: schemaValue,
        analysis
      }));
    } catch (error: unknown) {
      setState((current) => transitionMapperState(current, { type: "failed", error: toErrorState(error) }));
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void handleFile(file);
  }

  async function submit() {
    if (!validation?.valid || !state.analysis || !schema) return;
    const request = { ...state.mapping, schema_id: schema.id };
    setState((current) => transitionMapperState(current, { type: "import_started" }));
    try {
      const result = await client.import(request);
      setState((current) => transitionMapperState(current, { type: "import_succeeded", result }));
      onImported?.(result);
    } catch (error: unknown) {
      setState((current) => transitionMapperState(current, { type: "failed", error: toErrorState(error) }));
    }
  }

  function changeSheet(event: ChangeEvent<HTMLSelectElement>) {
    const sheetIndex = Number(event.currentTarget.value);
    setState((current) => transitionMapperState(current, {
      type: "mapping_changed",
      mapping: { ...current.mapping, sheet: sheetIndex, mappings: [] }
    }));
  }

  return (
    <main className={classes} aria-busy={busy}>
      <header className="mapper-importer__header">
        <h1>Mapper importer</h1>
        <span className="mapper-importer__status">{state.status}</span>
      </header>
      {state.error ? (
        <div className="mapper-importer__error" role="alert">
          <strong>{state.error.code}</strong>: {state.error.message}
        </div>
      ) : null}
      <div className="mapper-importer__layout">
        <section className="mapper-importer__section" aria-label="Schema">
          <h2>Target schema</h2>
          {schema ? (
            <div className="mapper-importer__stack">
              <strong>{schema.name}</strong>
              <div className="mapper-importer__fields">
                {schema.fields.map((field) => (
                  <div className="mapper-importer__field" key={field.id}>
                    <span>{field.name}</span>
                    <small>{field.type}{field.required ? " · required" : ""}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : <span className="mapper-importer__muted">Loading schema…</span>}
        </section>
        <section className="mapper-importer__section" aria-label="Source file">
          <h2>Source file</h2>
          <div className="mapper-importer__stack">
            <label className="mapper-importer__upload">
              Choose CSV or XLSX
              <input type="file" accept=".csv,.xlsx,text/csv" onChange={handleFileChange} disabled={busy} />
            </label>
            {state.analysis ? <span>{state.analysis.file.name}</span> : <span className="mapper-importer__muted">No file uploaded.</span>}
            {state.analysis && state.analysis.sheets.length > 1 ? (
              <label>
                Sheet
                <select value={state.mapping.sheet} onChange={changeSheet} disabled={busy}>
                  {state.analysis.sheets.map((item, index) => <option key={`sheet-${index}`} value={index}>{item.name}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        </section>
      </div>
      {schema && state.analysis ? (
        <MappingEditor
          sourceColumns={sourceColumns}
          targetFields={schema.fields}
          value={state.mapping}
          onChange={(mapping) => setState((current) => transitionMapperState(current, { type: "mapping_changed", mapping }))}
          disabled={busy}
          validation={validation}
        />
      ) : null}
      {state.result ? (
        <div className="mapper-importer__success" role="status">
          Imported {state.result.succeeded} of {state.result.processed} rows.
          {state.result.failed > 0 ? ` ${state.result.failed} failed.` : ""}
        </div>
      ) : null}
      <section className="mapper-importer__section">
        <button type="button" onClick={() => void submit()} disabled={busy || !validation?.valid}>
          Import rows
        </button>
      </section>
    </main>
  );
}

function toErrorState(error: unknown): MapperErrorState {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string") {
      return { code: value.code, message: value.message };
    }
  }
  return {
    code: "unknown_error",
    message: error instanceof Error ? error.message : "Mapper request failed"
  };
}

export type { MappingSpec, MappingTargetField } from "@mapper/core";
export type { MapperClient, Schema, SourceAnalysis, ImportResult } from "@mapper/client";
export type { UploadAdapter } from "@mapper/upload";
