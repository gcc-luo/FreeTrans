# AGENTS.md

These instructions apply when Codex works in this repository.

## Project identity and boundaries

- This project is **FreeTrans**, an Electron desktop translation tool for conversations in messaging services. It is based on Ferdium, but new product descriptions and translation-related features should present FreeTrans as a translation tool.
- Keep the existing Electron architecture, user data, and compatibility behavior intact unless the task explicitly requires changing them. Treat changes to the app ID (`com.bolttool.freetrans`), user data paths, persisted formats, and update source as migration-sensitive.
- Keep changes focused. Do not reformat or rewrite unrelated upstream code, documentation, or generated files as part of a focused task.
- Do not add secrets, access tokens, signing certificates, or passwords to the repository.

## Implementation and verification

- Follow the conventions of the surrounding code and reuse existing scripts and release configuration where possible.
- Run the narrowest relevant checks for a change. Report which checks ran and their results; do not claim a check passed if it was not run.
- A Git tag matching `v*` triggers the GitHub Actions desktop release workflow. Before creating a release tag, make sure it matches `package.json`'s version and run `pnpm release:verify-version <tag>`.
- Ad-hoc macOS signing is not Developer ID signing or notarization. Describe that limitation accurately when changing or documenting macOS distribution.

## Git commit messages

- Write commit subjects and commit body text in **Simplified Chinese**.
- Use the Conventional Commits structure `type(scope): 中文摘要`; keep the conventional type in English and write the scope and summary in Chinese. Use a short, imperative summary.
- Common types: `feat` (feature), `fix` (bug fix), `docs` (documentation), `refactor` (refactoring), `test` (tests), `build` (build), `ci` (CI), and `chore` (maintenance).
- Examples:
  - `feat(翻译): 增加消息翻译入口`
  - `fix(发布): 修复 macOS 安装包签名`
  - `docs(项目): 补充本地开发说明`
- Before committing, review the staged diff and stage only files related to the task. Do not include unrelated user changes.
