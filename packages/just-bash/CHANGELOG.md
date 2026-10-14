## @better-fs-tools/just-bash@0.2.0

### Remove capability flags that only made notes

A capability flag now exists only when a tool reads it to decide what to do.

- `FileSystemCapabilities.streaming` is gone. The read core reads `bytes()` the same way for one chunk or many. `capabilities` is now `{ identity }`. The memory backend keeps its `streaming` option, because it sets how `bytes()` splits the file.
- `WriteCapabilities.atomic` and `WriteCapabilities.preserveMode` are gone. `writeCapabilities` is now `{ compareAndSwap }`. When `compareAndSwap` is false, the write tools still stat the target just before the write.
- `MutatedFile.atomic` is gone. Only the `not-atomic` note read it.
- The write tools no longer add the `not-atomic`, `no-compare-and-swap`, and `mode-not-kept` notes. The `notAtomic`, `noCompareAndSwap`, and `modeNotKept` entries are gone from the write message catalog.
- `runWritableFileSystemConformance` always runs "a replace keeps the mode". A backend whose `stat()` reports `mode: null` passes it.
- The `writeCapabilities` option of `memoryFileSystem` takes only `compareAndSwap`. The memory backend always keeps the mode of an existing file.

## @better-fs-tools/just-bash@0.1.0

### First npm release

The first public release of the Better FS Tools packages. Each package ships compiled ES modules and TypeScript declarations from `dist/`.
