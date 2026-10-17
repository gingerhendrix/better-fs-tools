/** Pi prompt options of every Pi tool. */
export interface PiPromptOptions {
  /** Default the first sentence of the signature description. Pi lists the tool with it. */
  readonly promptSnippet?: string;
  /** Default []. */
  readonly promptGuidelines?: readonly string[];
}

/** The prompt options of a Pi tool, with their defaults applied. */
export interface PiPrompt {
  readonly promptSnippet: string;
  readonly promptGuidelines: string[];
}

/** Applies the defaults of the prompt options for a tool with this description. */
export function piPrompt(options: PiPromptOptions, description: string): PiPrompt {
  return {
    promptSnippet: options.promptSnippet ?? signatureSnippet(description),
    promptGuidelines: [...(options.promptGuidelines ?? [])],
  };
}

/** Omit for each member of a union, so the state and digest pairing stays. */
type WithoutPrompt<T> = T extends unknown ? Omit<T, keyof PiPromptOptions> : never;

/** Splits the prompt options off a Pi tool's options. */
export function splitPrompt<T extends PiPromptOptions>(
  options: T,
): { readonly prompt: PiPromptOptions; readonly rest: WithoutPrompt<T> } {
  const { promptSnippet, promptGuidelines, ...rest } = options;
  return {
    prompt: {
      ...(promptSnippet === undefined ? {} : { promptSnippet }),
      ...(promptGuidelines === undefined ? {} : { promptGuidelines }),
    },
    rest: rest as WithoutPrompt<T>,
  };
}

/**
 * The default Pi promptSnippet of a tool: the first sentence of its signature
 * description, without the full stop. Pi lists a custom tool under "Available
 * tools" only when it has a snippet, so every Pi tool gets one. The text comes
 * from the shared signature, so each integration describes the tool the same way.
 */
export function signatureSnippet(description: string): string {
  const text = description.trim();
  const end = /\.(\s|$)/u.exec(text);
  const sentence = end === null ? text.split("\n", 1)[0]! : text.slice(0, end.index);
  return sentence.trim();
}

export function checkPiOptions(options: unknown, label: string): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${label} options must be an object`);
  }
}
