import type { MapperClient, SourceAnalysis } from "@mapper/client";

export interface UploadAdapter {
  upload(file: Blob, filename?: string): Promise<SourceAnalysis>;
}

export class MultipartUploadAdapter implements UploadAdapter {
  private readonly client: Pick<MapperClient, "analyzeFile">;

  constructor(client: Pick<MapperClient, "analyzeFile">) {
    this.client = client;
  }

  upload(file: Blob, filename?: string): Promise<SourceAnalysis> {
    return this.client.analyzeFile(file, filename);
  }
}

export function createMultipartUploadAdapter(
  client: Pick<MapperClient, "analyzeFile">
): UploadAdapter {
  return new MultipartUploadAdapter(client);
}
