export type MapperFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface MapperClientOptions {
  baseUrl: string;
  fetch?: MapperFetch;
}

export type FieldType =
  | "string"
  | "integer"
  | "decimal"
  | "boolean"
  | "datetime"
  | (string & {});

export interface SchemaField {
  id: number;
  name: string;
  type: FieldType;
  required: boolean;
}

export interface Schema {
  id: number;
  name: string;
  fields: SchemaField[];
}

export interface FileMetadata {
  id: string;
  name: string;
  filename?: string;
  content_type?: string;
  extension?: string;
  size: number;
  created_at?: string;
}

export interface SourceRow {
  number: number;
  values: Record<string, string>;
}

export interface SheetAnalysis {
  name: string;
  columns: string[];
  samples?: SourceRow[];
  rows?: number;
}

export interface SourceAnalysis {
  file: FileMetadata;
  sheets: SheetAnalysis[];
}

export interface FieldMapping {
  source: number;
  target: number;
}

export interface ImportRequest {
  file_id: string;
  schema_id: number;
  sheet: number;
  mappings: FieldMapping[];
  fail_fast?: boolean;
}

export interface RowError {
  row: number;
  source_index?: number;
  target_id?: number;
  code: string;
  message: string;
}

export interface ImportResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors?: RowError[];
}

export interface ErrorDetail {
  code: string;
  message: string;
}

export interface ErrorEnvelope {
  error: ErrorDetail;
}

export class MapperError extends Error {
  readonly code: string;
  readonly status: number;
  readonly body?: unknown;

  constructor(code: string, message: string, status: number, body?: unknown) {
    super(message);
    this.name = "MapperError";
    this.code = code;
    this.status = status;
    this.body = body;
  }

  static async fromResponse(response: Response): Promise<MapperError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    const envelope = isErrorEnvelope(body) ? body.error : undefined;
    return new MapperError(
      envelope?.code ?? "http_error",
      envelope?.message ?? `Mapper request failed with HTTP ${response.status}`,
      response.status,
      body
    );
  }
}

export interface MapperClient {
  getSchema(schemaId: number | string): Promise<Schema>;
  analyzeFile(file: Blob, filename?: string): Promise<SourceAnalysis>;
  analyzeFileId(fileId: string): Promise<SourceAnalysis>;
  import(request: ImportRequest): Promise<ImportResult>;
}

const defaultFetch: MapperFetch = (input, init) => globalThis.fetch(input, init);

export function createMapperClient(
  baseUrl: string,
  fetcher?: MapperFetch
): MapperClient;
export function createMapperClient(options: MapperClientOptions): MapperClient;
export function createMapperClient(
  baseUrlOrOptions: string | MapperClientOptions,
  fetcher: MapperFetch = defaultFetch
): MapperClient {
  const baseUrl =
    typeof baseUrlOrOptions === "string"
      ? baseUrlOrOptions
      : baseUrlOrOptions.baseUrl;
  const requestFetch =
    typeof baseUrlOrOptions === "string"
      ? fetcher
      : (baseUrlOrOptions.fetch ?? defaultFetch);
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await requestFetch(`${root}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...init.headers
      }
    });
    if (!response.ok) {
      throw await MapperError.fromResponse(response);
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new MapperError(
        "invalid_response",
        error instanceof Error ? error.message : "Mapper returned invalid JSON",
        response.status
      );
    }
  }

  function jsonRequest<T>(path: string, value: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
  }

  return {
    getSchema(schemaId) {
      return request<Schema>(`/schemas/${encodeURIComponent(String(schemaId))}`);
    },
    analyzeFile(file, filename) {
      const form = new FormData();
      const name = filename ?? ("name" in file && typeof file.name === "string" ? file.name : "upload");
      form.append("file", file, name);
      return request<SourceAnalysis>("/files/analyze", {
        method: "POST",
        body: form
      });
    },
    analyzeFileId(fileId) {
      return jsonRequest<SourceAnalysis>("/files/analyze", { file_id: fileId });
    },
    import(value) {
      return jsonRequest<ImportResult>("/imports/sync", value);
    }
  };
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!value || typeof value !== "object" || !("error" in value)) {
    return false;
  }
  const error = value.error;
  return (
    !!error &&
    typeof error === "object" &&
    typeof (error as ErrorDetail).code === "string" &&
    typeof (error as ErrorDetail).message === "string"
  );
}
