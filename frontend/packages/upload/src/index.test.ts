import { describe, expect, it, vi } from "vitest";

import { MultipartUploadAdapter } from "./index";

const analysis = {
  file: { id: "file-1", name: "contacts.csv", size: 12 },
  sheets: []
};

describe("MultipartUploadAdapter", () => {
  it("delegates file and filename to client multipart analysis", async () => {
    const analyzeFile = vi.fn().mockResolvedValue(analysis);
    const adapter = new MultipartUploadAdapter({ analyzeFile });
    const file = new Blob(["name\nAda\n"], { type: "text/csv" });

    await expect(adapter.upload(file, "contacts.csv")).resolves.toBe(analysis);
    expect(analyzeFile).toHaveBeenCalledWith(file, "contacts.csv");
  });
});
