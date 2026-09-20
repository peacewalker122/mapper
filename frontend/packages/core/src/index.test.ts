import { describe, expect, it } from "vitest";

import {
  ImporterStatus,
  MappingValidationCode,
  connect,
  createMapperState,
  disconnect,
  transitionMapperState,
  validateMappings
} from "./index";
import type { MappingSchema, MappingSpec } from "./index";

const schema: MappingSchema = {
  id: 7,
  fields: [
    { id: 10, name: "name", required: true },
    { id: 20, name: "note", required: false }
  ]
};

const spec: MappingSpec = {
  file_id: "file-1",
  schema_id: 7,
  sheet: 0,
  mappings: []
};

describe("@mapper/core", () => {
  it("connects by stable target ID without mutating input", () => {
    const connected = connect(spec, 1, 20);
    const replaced = connect(connect(connected, 0, 10), 2, 10);

    expect(spec.mappings).toEqual([]);
    expect(replaced.mappings).toEqual([
      { source: 1, target: 20 },
      { source: 2, target: 10 }
    ]);
    expect(disconnect(replaced, 1, 20).mappings).toEqual([
      { source: 2, target: 10 }
    ]);
  });

  it("reports backend-compatible mapping errors deterministically", () => {
    const result = validateMappings(
      {
        ...spec,
        mappings: [
          { source: -1, target: 20 },
          { source: 1, target: 20 },
          { source: 3, target: 999 }
        ]
      },
      schema,
      2
    );

    expect(result.valid).toBe(false);
    expect(result.codes).toEqual([
      MappingValidationCode.InvalidSourceIndex,
      MappingValidationCode.DuplicateTarget,
      MappingValidationCode.UnknownTarget,
      MappingValidationCode.RequiredTargetMissing
    ]);
    expect(result.errors).toBe(result.issues);
  });

  it("keeps importer transitions pure and rejects illegal moves", () => {
    const initial = createMapperState(spec);
    const uploading = transitionMapperState(initial, { type: "upload_started" });
    const unchanged = transitionMapperState(initial, { type: "import_started" });
    const analyzing = transitionMapperState(uploading, { type: "analysis_started" });
    const ready = transitionMapperState(analyzing, {
      type: "ready",
      schema
    });

    expect(initial.status).toBe(ImporterStatus.Idle);
    expect(uploading.status).toBe(ImporterStatus.Uploading);
    expect(unchanged).toBe(initial);
    expect(ready.status).toBe(ImporterStatus.Ready);
    expect(ready.schema).toBe(schema);
  });
});
