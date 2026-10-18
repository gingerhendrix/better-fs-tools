import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export const Website = Cloudflare.Website.Vite("Website", {
  name: "better-fs-tools-docs",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  domain: {
    name: "betterfs.dev",
    aliases: ["www.betterfs.dev", "better-fs-tools.gandrew.com"],
  },
  dev: {
    host: "0.0.0.0",
  },
});

export default Alchemy.Stack(
  "BetterFsToolsDocs",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const website = yield* Website;

    return {
      url: website.url.as<string>(),
    };
  }),
);
