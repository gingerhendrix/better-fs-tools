# Releasing Better FS Tools

[Tegami](https://tegami.fuma-nama.dev) versions and publishes the ten `@better-fs-tools/*` packages. All ten share one version. `scripts/tegami.mts` holds the configuration, and the package list comes from `scripts/package-check/rules.ts`.

## Add a release note

Add a release note with each user-facing change. Create one interactively:

```bash
bun run tegami
```

Or add a file such as `.tegami/fix-read-offset.md`:

```md
---
packages:
  "@better-fs-tools/read": patch
---

## Fix the read offset past the end of a file

`read` now returns an empty page when the offset is past the last line.
```

Use `patch`, `minor`, or `major`. The packages share a version, so a note for one package bumps all ten. Use `"group:better-fs-tools"` when the note is about every package.

Do not edit package versions or create release tags by hand.

## Release flow

1. A commit with a note in `.tegami/` reaches `main`.
2. The **Release** workflow (`.github/workflows/release.yml`) runs `bun run check`, then `bun run check:packages`, then `bun run tegami ci`. Tegami opens or updates the **Version Packages** pull request on the `tegami/version-packages` branch. That pull request bumps the versions, writes each package `CHANGELOG.md`, and adds `.tegami/publish-lock.yaml`.
3. Merge the Version Packages pull request.
4. The Release workflow runs again. `tegami ci` finds the publish lock and publishes each package with npm trusted publishing (OIDC). No npm token is stored in GitHub. Tegami then creates the git tag and the GitHub release.

If a publish fails, rerun the Release workflow. Tegami skips versions that npm already has.

### How a package is packed

Tegami runs `bun pm pack` and then `npm publish <tarball>`. Bun ignores `publishConfig.exports` and `publishConfig.pi`. Without them, the tarball would export `./src/*.ts`, which `files` leaves out. The `applyPublishConfig()` plugin in `scripts/release/publish-config-plugin.ts` writes the published manifest for the length of each pack and restores `package.json` after. `check:packages` uses the same `publishManifest()` function, so the check and the release ship the same manifest. The tarballs contain compiled ES modules and declarations from `dist/`.

### Limits

- A pull request that the workflow token opens does not start other workflows. CI does not run on the Version Packages pull request. The Release workflow runs the full check before it publishes.
- The repository is private, so npm does not attach provenance to the packages. npm adds provenance on its own when the repository is public.
- Tegami also bumps the private `@better-fs-tools/examples` workspace, because it depends on the packages. Tegami never publishes a private package.

## First release setup

Do these steps once, before the first Version Packages pull request merges. npm trusted publishing can only be set up for a package that exists on npm. Tegami publishes a small placeholder version to create each package.

1. Let GitHub Actions open pull requests in this repository:

   ```bash
   gh api -X PUT repos/gingerhendrix/better-fs-tools/actions/permissions/workflow \
     -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
   ```

   Or use **Settings > Actions > General > Workflow permissions > Allow GitHub Actions to create and approve pull requests**.

2. Merge the release setup to `main`. It contains `.tegami/first-npm-release.md`, a `minor` note for all packages. The Release workflow opens the Version Packages pull request for `0.1.0`.

3. Update npm and log in. `npm trust` needs npm 11.10.0 or newer, and your npm account needs two-factor authentication.

   ```bash
   npm install --global npm@latest
   npm login
   ```

4. Check out the Version Packages branch and create the packages:

   ```bash
   git fetch origin tegami/version-packages
   git worktree add version-packages origin/tegami/version-packages
   cd version-packages
   bun install
   bun run tegami npm pretrust --dry-run
   bun run tegami npm pretrust
   ```

   For each package, `pretrust` publishes `0.0.0-tegami-trusted-publish-setup` under the `temp` dist-tag. Then it runs `npm trust github <package> --repo gingerhendrix/better-fs-tools --file release.yml`. It also writes `npm:mark-latest` entries into `.tegami/publish-lock.yaml`. Commit that change to the branch and push it.

5. Merge the Version Packages pull request. The Release workflow publishes `0.1.0` of all ten packages with OIDC and moves `latest` to `0.1.0`.

6. Check the result:

   ```bash
   npm view @better-fs-tools/read dist-tags
   npm view @better-fs-tools/read@0.1.0 exports
   ```

   The exports must point at `./dist/*.js`. You can deprecate the placeholder versions with `npm deprecate @better-fs-tools/<name>@0.0.0-tegami-trusted-publish-setup "placeholder"`.

A new package added later also needs `bun run tegami npm pretrust` before its first release.
