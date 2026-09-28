import type { JsonObject } from "@better-fs-tools/read";

import type { BashInput } from "../contract/input.ts";
import type { ShellLimits } from "../contract/limits.ts";
import type { ShellCanonicalParam, ShellMessageCatalog } from "../contract/messages.ts";
import { resolveShellLimits } from "../core/limits.ts";
import { formatDuration } from "../core/messages.ts";

/** Adapter level. The core never sees it. */
export interface BashSignature {
  /** Pi name and label. AI SDK ToolSet key. */
  readonly name: string;
  readonly description: string;
  /** Plain JSON Schema with a description on each parameter. */
  readonly schema: JsonObject;
  /** Validates model input and maps it to canonical input. Pure. Throws TypeError that names host parameters. */
  toInput(input: unknown): BashInput;
  /** Host name for a canonical parameter. An empty string means the signature has no such parameter. */
  param(name: ShellCanonicalParam): string;
  /** A duration in the unit of the timeout parameter, for messages. */
  duration(ms: number): string;
}

type Param = "command" | "timeout" | "cwd";

export interface BashSignatureOptions {
  readonly name?: string;
  readonly description?: string;
  readonly describe?: Partial<Record<Param, string>>;
  /** Unit of the timeout parameter. Default "ms" (S2). */
  readonly timeoutUnit?: "ms" | "s";
  /** Add the cwd parameter. Default true. */
  readonly cwd?: boolean;
  /** Put the runner id in the description, for example "just-bash (emulated)". */
  readonly runner?: string;
  /** The tool's limits, so the description names the right timeouts. Default the core defaults. */
  readonly limits?: Partial<ShellLimits>;
}

/**
 * bash({ command, timeout?, cwd? }). The timeout unit is milliseconds unless
 * `timeoutUnit` is "s". Pi's own bash takes seconds and no cwd.
 */
export function defaultBashSignature(options: BashSignatureOptions = {}): BashSignature {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("defaultBashSignature options must be an object");
  }
  const { name = "bash", describe = {}, timeoutUnit = "ms", cwd: withCwd = true, runner } = options;
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("defaultBashSignature name must be a non-blank string");
  }
  if (timeoutUnit !== "ms" && timeoutUnit !== "s") {
    throw new TypeError('defaultBashSignature timeoutUnit must be "ms" or "s"');
  }
  if (typeof withCwd !== "boolean")
    throw new TypeError("defaultBashSignature cwd must be a boolean");
  if (runner !== undefined && typeof runner !== "string") {
    throw new TypeError("defaultBashSignature runner must be a string");
  }
  if (options.description !== undefined && typeof options.description !== "string") {
    throw new TypeError("defaultBashSignature description must be a string");
  }
  const params: readonly Param[] = withCwd ? ["command", "timeout", "cwd"] : ["command", "timeout"];
  if (describe === null || typeof describe !== "object" || Array.isArray(describe)) {
    throw new TypeError("defaultBashSignature describe must be an object");
  }
  for (const [key, value] of Object.entries(describe)) {
    if (!(params as readonly string[]).includes(key)) {
      throw new TypeError(`Unknown parameter in describe: ${key}. Expected ${params.join(", ")}`);
    }
    if (typeof value !== "string") throw new TypeError(`describe.${key} must be a string`);
  }
  const limits = resolveShellLimits(options.limits);
  const scale = timeoutUnit === "s" ? 1_000 : 1;
  const unitWord = timeoutUnit === "s" ? "seconds" : "milliseconds";
  const inUnit = (ms: number) => `${ms / scale} ${unitWord}`;

  const properties: [string, JsonObject][] = [
    [
      "command",
      {
        type: "string",
        minLength: 1,
        description: describe.command ?? "The shell command to run with bash -c.",
      },
    ],
    [
      "timeout",
      {
        type: "number",
        exclusiveMinimum: 0,
        description:
          describe.timeout ??
          `Timeout in ${unitWord}. Default ${inUnit(limits.defaultTimeoutMs)}, maximum ${inUnit(limits.maxTimeoutMs)}.`,
      },
    ],
  ];
  if (withCwd) {
    properties.push([
      "cwd",
      {
        type: "string",
        minLength: 1,
        description:
          describe.cwd ??
          "Working directory for this command, relative to the default directory or absolute. Use it instead of cd.",
      },
    ]);
  }
  const schema = deepFreeze({
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(properties),
    required: ["command"],
  });

  const description =
    options.description ??
    [
      "Run a shell command with bash -c and return its exit code and output.",
      "Each call starts a new shell: a cd, an export, or a variable does not carry to the next call.",
      "stdin is closed, so a command that waits for input gets end of file. Do not start interactive programs.",
      `The command stops after ${formatDuration(limits.defaultTimeoutMs)} unless you set a timeout. The whole process tree is stopped at the timeout.`,
      `stdout and stderr are merged. Long output keeps the first and the last lines, up to ${limits.maxOutputLines} lines or ${limits.maxOutputBytes} bytes.`,
      "Prefer the read, edit, and write tools for files.",
      ...(runner === undefined ? [] : [`Commands run in: ${runner}.`]),
    ].join(" ");

  const names: Record<ShellCanonicalParam, string> = {
    command: "command",
    timeoutMs: "timeout",
    cwd: withCwd ? "cwd" : "",
  };

  return Object.freeze<BashSignature>({
    name,
    description,
    schema,
    toInput(input): BashInput {
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError(`bash input must be an object with ${params.join(", ")}`);
      }
      const record = input as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (!(params as readonly string[]).includes(key)) {
          throw new TypeError(`Unknown bash input key: ${key}. Expected ${params.join(", ")}`);
        }
      }
      const { command, timeout, cwd } = record;
      if (typeof command !== "string" || command.trim() === "") {
        throw new TypeError("command must be a non-blank string");
      }
      if (
        timeout !== undefined &&
        (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0)
      ) {
        throw new TypeError("timeout must be a positive number");
      }
      if (cwd !== undefined && (typeof cwd !== "string" || cwd.trim() === "")) {
        throw new TypeError("cwd must be a non-blank string");
      }
      return {
        command,
        ...(timeout === undefined ? {} : { timeoutMs: (timeout as number) * scale }),
        ...(cwd === undefined ? {} : { cwd: cwd as string }),
      };
    },
    param: (canonical) => names[canonical],
    duration: inUnit,
  });
}

/** The parts of the message catalog a signature owns: parameter names and the timeout unit. */
export function bashSignatureMessages(
  signature: BashSignature,
): Pick<ShellMessageCatalog, "param" | "duration"> {
  return { param: signature.param, duration: signature.duration };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
