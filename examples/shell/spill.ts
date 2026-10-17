import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nodeCommandRunner } from "@better-fs-tools/node";
import { createBashTool, shellEnv } from "@better-fs-tools/shell";
import type { SpillSink } from "@better-fs-tools/shell";

// Save every byte to a file. The truncation line names it, so the model can
// read the part the view left out with the read tool.
const fileSpill: SpillSink = {
  id: "file",
  async open() {
    const path = join(tmpdir(), `bash-${crypto.randomUUID()}.log`);
    const file = await open(path, "w");
    return {
      write: async (bytes) => {
        await file.write(bytes);
      },
      close: async () => {
        await file.close();
        return path;
      },
    };
  },
};

export const bash = createBashTool({
  runner: nodeCommandRunner(),
  env: shellEnv(() => process.env),
  spill: fileSpill,
});
// [… 196 000 lines (1.2 MB) not shown] Full output: /tmp/bash-….log
