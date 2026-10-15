import type { ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";

/** Turns the model's arguments into the arguments that Pi's built-in renderer of the tool reads. */
type RenderArgs = (args: unknown) => unknown;

const RENDER_ARGS = new WeakMap<object, RenderArgs>();

/** Records how a tool's arguments map to the arguments of Pi's built-in renderer of the same name. */
export function setRenderArgs(tool: object, toInput: (args: unknown) => unknown, toPi: RenderArgs) {
  RENDER_ARGS.set(tool, (args) => {
    try {
      return toPi(toInput(args));
    } catch {
      // Arguments that stream in, or that are not valid, go to the renderer as they are.
      return args;
    }
  });
}

/** Pi's read and write renderers read path, offset, limit, and content: the canonical names. */
export function canonicalArgs(input: unknown): unknown {
  return input;
}

/**
 * Pi's edit renderer reads { path, edits: [{ oldText, newText }] }, the
 * canonical edit input. It cannot show a replace-all edit, so then it gets
 * only the path and shows the diff of the result.
 */
export function piEditArgs(input: unknown): unknown {
  const { path, edits } = input as {
    readonly path: string;
    readonly edits: readonly { oldText: string; newText: string; replaceAll?: boolean }[];
  };
  if (edits.some((edit) => edit.replaceAll === true)) return { path };
  return { path, edits: edits.map(({ oldText, newText }) => ({ oldText, newText })) };
}

/** Pi's bash renderer shows `timeout` in seconds. */
export function piBashArgs(input: unknown): unknown {
  const { command, timeoutMs } = input as { readonly command: string; readonly timeoutMs?: number };
  return timeoutMs === undefined ? { command } : { command, timeout: timeoutMs / 1_000 };
}

/**
 * A Pi tool renderer resolver for Better FS Tools. A tool named read, edit,
 * write, or bash gets Pi's built-in renderer of that name. That renderer reads
 * Pi's own argument names. This resolver gives it the arguments in those names,
 * so it draws the call for any signature: the edit preview, the read range, and
 * the bash timeout. Register it with pi.registerToolRenderer(). The extension
 * entry does this for its own tools.
 */
export function piToolRenderers(tools: Iterable<{ readonly name: string }>): ToolRendererResolver {
  const byName = new Map<string, RenderArgs>();
  for (const tool of tools) {
    const renderArgs = RENDER_ARGS.get(tool);
    if (renderArgs !== undefined) byName.set(tool.name, renderArgs);
  }
  return (toolName, next) => {
    const base = next();
    const renderArgs = byName.get(toolName);
    if (base === undefined || renderArgs === undefined) return base;
    return withArgs(base, renderArgs);
  };
}

function withArgs(base: ToolRenderers, renderArgs: RenderArgs): ToolRenderers {
  const { renderCall, renderResult } = base;
  return {
    ...base,
    ...(renderCall === undefined
      ? {}
      : {
          renderCall: (args, theme, context) =>
            renderCall(renderArgs(args), theme, { ...context, args: renderArgs(context.args) }),
        }),
    ...(renderResult === undefined
      ? {}
      : {
          renderResult: (result, options, theme, context) =>
            renderResult(result, options, theme, { ...context, args: renderArgs(context.args) }),
        }),
  };
}
