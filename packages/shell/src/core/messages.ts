import type { ShellCanonicalParam, ShellMessageCatalog } from "../contract/messages.ts";

type Param = (name: ShellCanonicalParam) => string;
type Duration = (ms: number) => string;

/** "0.4 s", "12 s", "2 min 5 s". */
export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toString()} s`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** "812 B", "29.3 KB", "1.8 MB". Decimal units. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(Math.round(bytes / 100) / 10).toString()} KB`;
  return `${(Math.round(bytes / 100_000) / 10).toString()} MB`;
}

function catalogFor(param: Param, duration: Duration): ShellMessageCatalog {
  const cwdAdvice = () => {
    const name = param("cwd");
    return name === "" ? "" : ` Check the ${name} value.`;
  };
  return {
    param,
    duration,
    pathRepaired: ({ from, to }) =>
      `The requested directory ${JSON.stringify(from)} was repaired to ${JSON.stringify(to)}.`,
    denied: ({ path, detail }) =>
      `The command in ${path} was refused by policy${detail === null ? "" : ` (${detail})`}.`,

    invalidInput: ({ detail }) => `The bash input was rejected: ${detail}`,
    cwdNotFound: ({ cwd }) => `The working directory ${cwd} does not exist.${cwdAdvice()}`,
    cwdNotADirectory: ({ cwd }) => `The working directory ${cwd} is not a directory.${cwdAdvice()}`,
    refused: ({ hook }) => `The command was refused by the ${hook} check.`,
    spawnFailed: ({ detail }) =>
      `The command could not start${detail === null ? "" : ` (${detail})`}. This is a host problem, not a problem with the command.`,
    extensionFailed: ({ extension, phase }) =>
      `The ${extension} extension failed during the ${phase} phase. This is a host problem, not a problem with the command.`,
    timeoutClamped: ({ requestedMs, maxMs }) =>
      `The requested timeout of ${duration(requestedMs)} is over the maximum, so ${duration(maxMs)} was used.`,

    exited: ({ code, signal, durationMs }) => {
      const time = formatDuration(durationMs);
      if (code !== null) return `Exit code ${code} · ${time}`;
      return `Ended by ${signal ?? "an unknown signal"} · ${time}`;
    },
    timedOut: ({ timeoutMs }) =>
      `Timed out after ${formatDuration(timeoutMs)}. The process tree was stopped.`,
    aborted: ({ durationMs }) =>
      `Aborted after ${formatDuration(durationMs)}. The process tree was stopped.`,
    outputCap: ({ limit }) =>
      `The command wrote more than ${formatBytes(limit)} of output, so it was stopped. Send less output, for example with a filter, a count, or a redirect to a file.`,
    unconfirmedStop: () =>
      "The runner did not confirm that the process tree stopped. Processes may still be running.",
    abortedBeforeStart: () => "The call was aborted before the command started.",
    spillFailed: ({ sink }) =>
      `The ${sink} spill sink failed, so the full output was not saved. The command was not affected.`,
    outputIncomplete: ({ detail, skippedChunks, drainMs }) => {
      const causes = [
        ...(detail === null ? [] : [`the output stream failed (${detail})`]),
        ...(drainMs === null
          ? []
          : [`the output had not ended ${drainMs} ms after the command exited`]),
        ...(skippedChunks === 0
          ? []
          : [
              `the runner gave ${skippedChunks} malformed output ${skippedChunks === 1 ? "chunk" : "chunks"}, which ${skippedChunks === 1 ? "was" : "were"} skipped`,
            ]),
      ];
      return `The output may be incomplete: ${causes.join("; ")}. The exit status is still the command's.`;
    },
    noOutput: () => "(no output)",
    omitted: ({ lines, bytes, spill }) =>
      `[… ${lines} lines (${formatBytes(bytes)}) not shown]${spill === null ? "" : ` Full output: ${spill}`}`,
  };
}

export const defaultShellMessages: Readonly<ShellMessageCatalog> = Object.freeze(
  catalogFor((name) => name, formatDuration),
);

const MESSAGE_KEYS = Object.keys(defaultShellMessages) as (keyof ShellMessageCatalog)[];

/**
 * Merges key by key over the defaults. The default texts use the host's
 * `param` and `duration`, so they show the host's names and units. Throws
 * TypeError on an unknown key or a value that is not a function.
 */
export function resolveShellMessages(
  overrides: Partial<ShellMessageCatalog> = {},
): Readonly<ShellMessageCatalog> {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("messages must be an object");
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!MESSAGE_KEYS.includes(key as keyof ShellMessageCatalog)) {
      throw new TypeError(`Unknown shell message: ${key}`);
    }
    if (value !== undefined && typeof value !== "function") {
      throw new TypeError(`messages.${key} must be a function`);
    }
  }
  const param = overrides.param ?? defaultShellMessages.param;
  const duration = overrides.duration ?? defaultShellMessages.duration;
  const base = catalogFor(param, duration);
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[key] = value;
  }
  return Object.freeze(merged as unknown as ShellMessageCatalog);
}
