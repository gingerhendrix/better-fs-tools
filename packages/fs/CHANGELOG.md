## @better-fs-tools/fs@0.2.0

### Remove capability flags that only made notes

A capability flag now exists only when a tool reads it to decide what to do.

- `FileSystemCapabilities.streaming` is gone. The read core reads `bytes()` the same way for one chunk or many. `capabilities` is now `{ identity }`. The memory backend keeps its `streaming` option, because it sets how `bytes()` splits the file.
- `WriteCapabilities.atomic` and `WriteCapabilities.preserveMode` are gone. `writeCapabilities` is now `{ compareAndSwap }`. When `compareAndSwap` is false, the write tools still stat the target just before the write.
- `MutatedFile.atomic` is gone. Only the `not-atomic` note read it.
- The write tools no longer add the `not-atomic`, `no-compare-and-swap`, and `mode-not-kept` notes. The `notAtomic`, `noCompareAndSwap`, and `modeNotKept` entries are gone from the write message catalog.
- `runWritableFileSystemConformance` always runs "a replace keeps the mode". A backend whose `stat()` reports `mode: null` passes it.
- The `writeCapabilities` option of `memoryFileSystem` takes only `compareAndSwap`. The memory backend always keeps the mode of an existing file.

### The write conformance suite accepts `read-only` for a refused path

`runWritableFileSystemConformance()` checks that a write to `refusedPath` gives a policy reason. That check now also accepts `read-only`, because a mutation error can carry it. Before, a backend that refused a write with `read-only`, for example on `EROFS`, failed the check. The read suite still accepts only the read policy reasons.

## @better-fs-tools/fs@0.1.0

### First npm release

The first public release of the Better FS Tools packages. Each package ships compiled ES modules and TypeScript declarations from `dist/`.
