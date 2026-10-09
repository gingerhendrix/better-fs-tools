---
packages:
  "@better-fs-tools/pi": minor
  "@better-fs-tools/ai-sdk": minor
---

## The Pi and AI SDK read tools return images

`createPiReadTool()`, `createPiFsTools()`, the Pi extension entry, `createAiSdkReadTool()`, and `createAiSdkFsTools()` now add `imageConverter()` when you pass no `converters`. An image read gives a Pi `image` part, or an AI SDK `file` part. Before, the read refused the image as `unsupported`. Pi's own `read` returns images, so the Pi extension no longer takes that away.

The read core still has no converters by default. A `converters` list you pass replaces the default, so `converters: []` turns images off. In the bundles the option goes under `read`, for example `read: { converters: [] }`. A list without `imageConverter()` also refuses images.
