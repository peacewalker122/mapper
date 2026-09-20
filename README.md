# mapper

Language-neutral schema compiler + Go backend mapping runtime.

Author a model once in YAML, generate a stable-identity Go model with a
runtime schema descriptor, then map CSV/XLSX source files into typed records
through a streaming import pipeline exposed over plain `net/http`.

```text
schema.yaml → mapper-gen → model + Schema → Service → typed Records
```

## Status

- Phase 1: schema compiler (YAML → Go model + descriptor + lock file)
- Phases 2–5: backend SDK (registry, source adapters, import runtime, HTTP)
- Upload extension: TUS resumable uploads yielding `FileID`

## Quickstart

Prerequisites: Go 1.26+.

```bash
go build -o mapper-gen ./cmd/mapper-gen

# Validate a schema (exit 0 = valid)
./mapper-gen validate schema/subscriber.yaml

# Generate model + lock file (idempotent)
./mapper-gen generate \
  --input schema/subscriber.yaml \
  --output generated/subscriber.gen.go \
  --package generated
```

Schema example:

```yaml
version: 1

model:
  name: subscriber
  fields:
    - name: msisdn
      type: string
      required: true
    - name: status
      type: string
      required: true
```

Field IDs are generated once (crypto-random, ≤ 2⁵³−1) and pinned in
`subscriber.lock.yaml`. Removed fields stay `removed` and are never recycled;
re-adding a name restores its original ID.

## Backend SDK

```go
store := tempfile.New("") // local FileStore (S3/GCS swappable)
defer store.Close()

svc := mapper.New(
    mapper.WithFileStore(store),
    mapper.WithSourceAdapter(csv.New()),
    mapper.WithImporter(executor.NewImportExecutor(registry, store, csv.New(), processor)),
)
_ = svc.RegisterSchema(generated.SubscriberSchema)

handler := mapperhttp.New(svc, store)
mux := http.NewServeMux()
mux.Handle("/mapper/", http.StripPrefix("/mapper", handler))
```

HTTP protocol (`net/http` only, no framework):

| Method | Route            | Purpose                              |
| ------ | ---------------- | ------------------------------------ |
| GET    | `/schemas/{id}`  | target shape for the mapping UI      |
| POST   | `/files/analyze` | JSON `{file_id}` or multipart `file` |
| POST   | `/imports/sync`  | run mapping → `ImportProcessor`      |

TUS resumable uploads mount as an extension:

```go
tusExt := tus.New(tus.WithFileWriter(store))
handler := mapperhttp.New(svc, store, tusExt) // serves /uploads/tus/*
```

## Testing

```bash
go vet ./...
go test ./...
```

`e2e/e2e_test.go` proves the full loop: YAML → compiler → registry →
`httptest` server → CSV upload → analyze → schema → mapping → import →
typed records and `ImportResult`.

## Layout

```text
compiler/      YAML parse, validate, lockfile, ID resolver, Compile API
ir/            language-independent schema representation
codegen/       Go generator (go/ast + go/printer)
cmd/           mapper-gen CLI (generate / validate)
mapper/        Service, registry, files, mapping, records, processor
source/        CSV + XLSX adapters (streaming RowReader)
executor/      ExecutionPlan, type conversion, row validation
filestore/     tempfile FileStore
upload/        HTTPUploadExtension + TUS adapter
mapperhttp/    net/http handlers + error envelope
e2e/           full-system test
```

## License

Apache-2.0. See [LICENSE](LICENSE).
