/** Pi's ToolAnnotations: MCP tool hints that permission extensions read. */
export interface PiToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** read changes nothing. */
export const PI_READ_ANNOTATIONS: Readonly<PiToolAnnotations> = Object.freeze({
  readOnlyHint: true,
});

/** edit and apply_patch can replace or remove file content, and a second run is not a no-op. */
export const PI_PATCH_ANNOTATIONS: Readonly<PiToolAnnotations> = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
});

/** write replaces a whole file. The same call twice gives the same file. */
export const PI_WRITE_ANNOTATIONS: Readonly<PiToolAnnotations> = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
});
