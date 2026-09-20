import { describe, expect, it } from "vitest";

import { createMapperClient } from "./index";
import type { MapperFetch, SourceAnalysis } from "./index";

const analysis: SourceAnalysis = {
  file: { id: "file-1", name: "contacts.csv", size: 12 },
  sheets: [{ name: "Sheet1", columns: ["name"], rows: 1 }]
};

describe("@mapper/client", () => {
  it("uses JSON protocol for schema, analyze by id, and import", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: MapperFetch = async (input, init) => {
      requests.push({ url: String(input), init });
      const path = new URL(String(input)).pathname;
      const body = path === "/schemas/7"
        ? { id: 7, name: "contact", fields: [] }
        : path === "/files/analyze"
          ? analysis
          : { processed: 1, succeeded: 1, failed: 0 };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const client = createMapperClient("https://mapper.test/api/", fetcher);

    await client.getSchema(7);
    await client.analyzeFileId("file-1");
    await client.import({
      file_id: "file-1",
      schema_id: 7,
      sheet: 0,
      mappings: [{ source: 0, target: 42 }]
    });

    expect(requests.map(({ url }) => url)).toEqual([
      "https://mapper.test/api/schemas/7",
      "https://mapper.test/api/files/analyze",
      "https://mapper.test/api/imports/sync"
    ]);
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({ file_id: "file-1" });
    expect(JSON.parse(String(requests[2].init?.body))).toEqual({
      file_id: "file-1",
      schema_id: 7,
      sheet: 0,
      mappings: [{ source: 0, target: 42 }]
    });
  });

  it("sends uploaded files as multipart without overriding boundary", async () => {
    let request: RequestInit | undefined;
    const fetcher: MapperFetch = async (_input, init) => {
      request = init;
      return new Response(JSON.stringify(analysis), { status: 200 });
    };
    const client = createMapperClient({ baseUrl: "https://mapper.test", fetch: fetcher });

    await client.analyzeFile(new Blob(["name\nAda\n"], { type: "text/csv" }), "contacts.csv");

    expect(request?.method).toBe("POST");
    expect(request?.body).toBeInstanceOf(FormData);
    expect((request?.headers as Record<string, string>).Accept).toBe("application/json");
    expect((request?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("decodes backend error envelopes", async () => {
    const fetcher: MapperFetch = async () =>
      new Response(JSON.stringify({ error: { code: "schema_not_found", message: "missing" } }), {
        status: 404
      });
    const client = createMapperClient("https://mapper.test", fetcher);

    await expect(client.getSchema(99)).rejects.toMatchObject({
      name: "MapperError",
      code: "schema_not_found",
      status: 404,
      message: "missing"
    });
  });
});
