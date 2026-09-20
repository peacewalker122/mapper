import { describe, expect, it } from "vitest";

import { ReactFlowAdapter } from "./index";

const spec = {
  file_id: "file-1",
  schema_id: 7,
  sheet: 0,
  mappings: [{ source: 1, target: 101 }]
};

describe("ReactFlowAdapter", () => {
  it("derives UI keys from indexes without exposing stable field IDs", () => {
    const graph = ReactFlowAdapter(
      spec,
      ["name", "email"],
      [
        { id: 101, name: "full_name", required: true },
        { id: 202, name: "address", required: false }
      ]
    );

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "source-0",
      "source-1",
      "target-0",
      "target-1"
    ]);
    expect(graph.edges).toEqual([
      {
        id: "mapping-1-0-0",
        source: "source-1",
        target: "target-0",
        data: { source_index: 1, target_index: 0 }
      }
    ]);
    expect(JSON.stringify(graph)).not.toContain("101");
    expect(JSON.stringify(graph)).not.toContain("202");
  });
});
