export interface FieldMapping {
  source: number;
  target: number;
}

export interface MappingSpec {
  file_id: string;
  schema_id: number;
  sheet: number;
  mappings: FieldMapping[];
}

export interface MappingTargetField {
  id: number;
  name: string;
  required: boolean;
}

export interface MappingSchema {
  id: number;
  fields: MappingTargetField[];
}

export interface MappingSourceColumn {
  index: number;
  name: string;
}

export const MappingValidationCode = {
  InvalidMapping: "invalid_mapping",
  InvalidSourceIndex: "invalid_source_index",
  UnknownTarget: "unknown_target",
  DuplicateTarget: "duplicate_target",
  RequiredTargetMissing: "required_target_missing"
} as const;

export type MappingValidationCode =
  (typeof MappingValidationCode)[keyof typeof MappingValidationCode];

export interface MappingValidationIssue {
  code: MappingValidationCode;
  message: string;
  source?: number;
  target?: number;
}

export interface MappingValidationResult {
  valid: boolean;
  codes: MappingValidationCode[];
  issues: MappingValidationIssue[];
  errors: MappingValidationIssue[];
}

export function connect(
  spec: MappingSpec,
  source: number,
  target: number
): MappingSpec {
  const mappings = spec.mappings
    .filter((mapping) => mapping.target !== target)
    .concat({ source, target })
    .sort(compareMappings);
  return { ...spec, mappings };
}

export function disconnect(
  spec: MappingSpec,
  source: number,
  target?: number
): MappingSpec {
  const mappings = spec.mappings.filter(
    (mapping) =>
      mapping.source !== source ||
      (target !== undefined && mapping.target !== target)
  );
  return { ...spec, mappings };
}

export function disconnectTarget(spec: MappingSpec, target: number): MappingSpec {
  return {
    ...spec,
    mappings: spec.mappings.filter((mapping) => mapping.target !== target)
  };
}

export function validateMappings(
  spec: MappingSpec,
  schema: MappingSchema,
  sourceCount?: number
): MappingValidationResult;
export function validateMappings(
  spec: MappingSpec,
  sourceColumns: readonly (string | MappingSourceColumn)[],
  targetFields: readonly MappingTargetField[]
): MappingValidationResult;
export function validateMappings(
  spec: MappingSpec,
  schemaOrColumns: MappingSchema | readonly (string | MappingSourceColumn)[],
  sourceCountOrFields?: number | readonly MappingTargetField[]
): MappingValidationResult {
  let schema: MappingSchema | undefined;
  let sourceColumns: readonly (string | MappingSourceColumn)[] | undefined;
  if ("fields" in schemaOrColumns) {
    schema = schemaOrColumns;
  } else {
    sourceColumns = schemaOrColumns;
  }
  const fields = schema?.fields ??
    (Array.isArray(sourceCountOrFields) ? sourceCountOrFields : []);
  const sourceCount = sourceColumns
    ? sourceColumns.length
    : typeof sourceCountOrFields === "number"
      ? sourceCountOrFields
      : undefined;
  const issues: MappingValidationIssue[] = [];

  if (schema) {
    if (schema.id === 0) {
      issues.push({
        code: MappingValidationCode.InvalidMapping,
        message: "schema ID is zero"
      });
    }
    if (spec.schema_id !== 0 && spec.schema_id !== schema.id) {
      issues.push({
        code: MappingValidationCode.InvalidMapping,
        message: `mapping schema ${spec.schema_id} does not match schema ${schema.id}`
      });
    }
  }
  if (sourceCount !== undefined && sourceCount < 0) {
    issues.push({
      code: MappingValidationCode.InvalidMapping,
      message: "source count is negative"
    });
  }

  const fieldsByID = new Map<number, MappingTargetField>();
  for (const field of fields) {
    if (field.id === 0 || fieldsByID.has(field.id)) {
      issues.push({
        code: MappingValidationCode.InvalidMapping,
        message: field.id === 0
          ? `schema field ${field.name} has zero ID`
          : `schema has duplicate field ID ${field.id}`,
        target: field.id
      });
      continue;
    }
    fieldsByID.set(field.id, field);
  }

  const mappedTargets = new Set<number>();
  for (const mapping of spec.mappings) {
    if (mapping.source < 0 ||
        (sourceCount !== undefined && mapping.source >= sourceCount)) {
      issues.push({
        code: MappingValidationCode.InvalidSourceIndex,
        message: sourceCount === undefined
          ? `source index ${mapping.source} is negative`
          : `source index ${mapping.source} is outside [0,${sourceCount})`,
        source: mapping.source
      });
    }
    if (mapping.target === 0 || !fieldsByID.has(mapping.target)) {
      issues.push({
        code: MappingValidationCode.UnknownTarget,
        message: mapping.target === 0
          ? "target ID is zero"
          : `target field ID ${mapping.target} does not exist`,
        source: mapping.source,
        target: mapping.target
      });
      continue;
    }
    if (mappedTargets.has(mapping.target)) {
      issues.push({
        code: MappingValidationCode.DuplicateTarget,
        message: `target field ID ${mapping.target} is mapped more than once`,
        source: mapping.source,
        target: mapping.target
      });
      continue;
    }
    mappedTargets.add(mapping.target);
  }

  for (const field of fields) {
    if (field.required && !mappedTargets.has(field.id)) {
      issues.push({
        code: MappingValidationCode.RequiredTargetMissing,
        message: `required target field ${field.name} is not mapped`,
        target: field.id
      });
    }
  }

  const codes = [...new Set(issues.map((issue) => issue.code))];
  return { valid: issues.length === 0, codes, issues, errors: issues };
}

export function validate(
  spec: MappingSpec,
  schema: MappingSchema,
  sourceCount?: number
): MappingValidationResult {
  return validateMappings(spec, schema, sourceCount);
}

export const ImporterStatus = {
  Idle: "idle",
  Uploading: "uploading",
  Analyzing: "analyzing",
  Ready: "ready",
  Importing: "importing",
  Success: "success",
  Error: "error"
} as const;

export type ImporterStatus =
  (typeof ImporterStatus)[keyof typeof ImporterStatus];

export interface MapperErrorState {
  code: string;
  message: string;
}

export interface MapperState<Schema = unknown, Analysis = unknown, Result = unknown> {
  status: ImporterStatus;
  mapping: MappingSpec;
  schema?: Schema;
  analysis?: Analysis;
  result?: Result;
  error?: MapperErrorState;
}

export function createMapperState(mapping: MappingSpec = emptyMapping()): MapperState {
  return { status: ImporterStatus.Idle, mapping: copyMapping(mapping) };
}

export type MapperEvent<Schema = unknown, Analysis = unknown, Result = unknown> =
  | { type: "upload_started" }
  | { type: "analysis_started" }
  | { type: "ready"; schema?: Schema; analysis?: Analysis }
  | { type: "import_started" }
  | { type: "import_succeeded"; result: Result }
  | { type: "failed"; error: MapperErrorState }
  | { type: "mapping_changed"; mapping: MappingSpec }
  | { type: "reset" };

export function transitionMapperState<Schema, Analysis, Result>(
  state: MapperState<Schema, Analysis, Result>,
  event: MapperEvent<Schema, Analysis, Result>
): MapperState<Schema, Analysis, Result> {
  if (event.type === "mapping_changed") {
    return { ...state, mapping: copyMapping(event.mapping) };
  }
  if (event.type === "reset") {
    return createMapperState(state.mapping) as MapperState<Schema, Analysis, Result>;
  }
  if (!canTransition(state.status, event.type)) {
    return state;
  }
  switch (event.type) {
    case "upload_started":
      return {
        ...state,
        status: ImporterStatus.Uploading,
        analysis: undefined,
        result: undefined,
        error: undefined
      };
    case "analysis_started":
      return { ...state, status: ImporterStatus.Analyzing, error: undefined };
    case "ready":
      return {
        ...state,
        status: ImporterStatus.Ready,
        schema: event.schema,
        analysis: event.analysis,
        result: undefined,
        error: undefined
      };
    case "import_started":
      return { ...state, status: ImporterStatus.Importing, result: undefined, error: undefined };
    case "import_succeeded":
      return { ...state, status: ImporterStatus.Success, result: event.result, error: undefined };
    case "failed":
      return { ...state, status: ImporterStatus.Error, error: event.error };
  }
}

export function canTransition(
  status: ImporterStatus,
  event: MapperEvent["type"]
): boolean {
  if (event === "mapping_changed" || event === "reset") {
    return true;
  }
  const allowed: Record<ImporterStatus, readonly string[]> = {
    [ImporterStatus.Idle]: ["upload_started", "analysis_started"],
    [ImporterStatus.Uploading]: ["analysis_started", "failed"],
    [ImporterStatus.Analyzing]: ["ready", "failed", "upload_started"],
    [ImporterStatus.Ready]: ["analysis_started", "import_started", "failed", "upload_started"],
    [ImporterStatus.Importing]: ["import_succeeded", "failed"],
    [ImporterStatus.Success]: ["analysis_started", "upload_started"],
    [ImporterStatus.Error]: ["upload_started", "analysis_started"]
  };
  return allowed[status].includes(event);
}

function compareMappings(left: FieldMapping, right: FieldMapping): number {
  return left.source - right.source || left.target - right.target;
}

function copyMapping(mapping: MappingSpec): MappingSpec {
  return {
    ...mapping,
    mappings: mapping.mappings.map((item) => ({ ...item }))
  };
}

function emptyMapping(): MappingSpec {
  return { file_id: "", schema_id: 0, sheet: 0, mappings: [] };
}
