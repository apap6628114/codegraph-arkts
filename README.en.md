<div align="center">

# CodeGraph-ArkTS

### CodeGraph Fork — ArkTS / HarmonyOS Support · Synced to upstream v1.0.0

**Pre-indexed semantic code knowledge graph for ArkTS, TypeScript, and 24+ languages.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Forked from colbymchenry/codegraph](https://img.shields.io/badge/fork-colbymchenry%2Fcodegraph-blue)](https://github.com/colbymchenry/codegraph)
[![Sync: v1.0.0](https://img.shields.io/badge/sync-v1.0.0-brightgreen)](https://github.com/colbymchenry/codegraph)

[![Windows](https://img.shields.io/badge/Windows-supported-blue.svg)](#supported-languages)
[![macOS](https://img.shields.io/badge/macOS-supported-blue.svg)](#supported-languages)
[![Linux](https://img.shields.io/badge/Linux-supported-blue.svg)](#supported-languages)

[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-blueviolet.svg)](#supported-languages)
[![Cursor](https://img.shields.io/badge/Cursor-supported-blueviolet.svg)](#supported-languages)
[![Codex](https://img.shields.io/badge/Codex-supported-blueviolet.svg)](#supported-languages)
[![opencode](https://img.shields.io/badge/opencode-supported-blueviolet.svg)](#supported-languages)
[![Gemini](https://img.shields.io/badge/Gemini-supported-blueviolet.svg)](#supported-languages)
[![Kiro](https://img.shields.io/badge/Kiro-supported-blueviolet.svg)](#supported-languages)

**English** | [中文](README.md)

</div>

CodeGraph is a tree-sitter-powered knowledge graph engine that indexes every symbol, call, import, and inheritance edge in your codebase into a local SQLite database. AI coding agents query it directly instead of grep/read loops — faster and cheaper.

This fork adds **full ArkTS language support** for HarmonyOS application development, and continuously syncs upstream v1.0.0 features.

## What's Added

### ArkTS Language Support

| Feature | Status |
|---------|--------|
| `struct` declarations (`@Component`, `@Entry`) | ✅ Extracted with decorator references |
| `@State`, `@Link`, `@Prop`, `@Builder` etc. | ✅ Captured as `decorates` edges |
| ArkUI component calls (`Column()`, `Text()`, `Row()`) | ✅ Recognized as call graph edges |
| `build()` and lifecycle methods | ✅ Method extraction with signature |
| `@Extend` / `@Styles` decorators | ✅ Function extraction with decorator metadata |
| `import lazy` | ✅ Import node extraction |
| Top-level constants and variables | ✅ `const`/`let`/`var` extraction |
| Type annotations & generics | ✅ Type reference edges |
| interfaces, enums, type aliases | ✅ Full support |
| `export struct` / `export function` | ✅ Export flag and body resolution |
| Visibility modifiers | ✅ `public`/`private`/`protected` |

### Technical Changes

- **Language Extractor** — `src/extraction/languages/arkts.ts` with ArkUI-specific AST node type mappings
- **WASM Grammar** — `tree-sitter-arkts` compiled to WASM for tree-sitter parsing; rebuild via `npm run build:wasm-arkts [source-path]`
- **AST Adaptations** — Handles `function_signature` body resolution (ArkTS separates signatures from bodies in `export function`), `arkui_component_expression` call recognition, `lazy_import_statement` import extraction
- **Core Enhancements** — `extractStruct` decorator support, variable extraction language registration, type annotation language registration
- **SQLite Backend** — Added a `better-sqlite3` fallback: automatically falls back when the built-in `node:sqlite` is unavailable or lacks FTS5 (applies to some Windows Node distributions)

## Supported Languages

| Language | Extension | Status |
|----------|-----------|--------|
| **ArkTS** (HarmonyOS) | `.ets` | **Full support (this fork)** |
| TypeScript | `.ts`, `.tsx` | Full support |
| JavaScript | `.js`, `.jsx`, `.mjs` | Full support |
| Python | `.py` | Full support |
| Go | `.go` | Full support |
| Rust | `.rs` | Full support |
| Java | `.java` | Full support |
| C# | `.cs` | Full support |
| PHP | `.php` | Full support |
| Ruby | `.rb` | Full support |
| C/C++ | `.c`, `.cpp`, `.h`, `.hpp` | Full support |
| Swift | `.swift` | Full support |
| Kotlin | `.kt`, `.kts` | Full support |
| Dart | `.dart` | Full support |
| Lua / Luau | `.lua`, `.luau` | Full support |
| R | `.r` | Full support |
| Scala | `.scala`, `.sc` | Full support |
| Pascal / Delphi | `.pas`, `.dpr`, `.dpk` | Full support |
| Astro | `.astro` | Full support |
| Svelte | `.svelte` | Template + script sharding |
| Vue | `.vue` | Template + script sharding |
| ASP.NET Razor / Blazor | `.cshtml`, `.razor` | Code relationship resolution |
| Liquid | `.liquid` | Shopify templates |
| Objective-C | `.m`, `.mm` | Full support |

## Quick Start

### Prerequisites

- Node.js 22.5+ (for the built-in `node:sqlite` with FTS5), or install `better-sqlite3` as a fallback
- A HarmonyOS / ArkTS project with `.ets` files

### Install & Initialize

This fork is used from source:

```bash
# 1. Build this fork
cd codegraph-arkts
npm install
npm run build

# 2. Initialize and index in your project
node dist/bin/codegraph.js init /path/to/your/project

# 3. Install the MCP server to connect your AI coding agents
#    Auto-detects and configures Claude Code, Cursor, Codex CLI, opencode, Gemini CLI, Kiro
node dist/bin/codegraph.js install --location=local --yes

# 4. Start serving, auto-sync enabled
node dist/bin/codegraph.js serve --mcp
```

> **Auto-sync**: After running `codegraph init`, the file watcher automatically tracks source changes (native OS events with 2s debounce), keeping the graph always up-to-date — no manual re-indexing needed.

> **Upgrade**: Upstream is at v1.0.0. To update this fork, run `git pull origin main` (or merge the upstream branch), then rebuild.

### MCP Server Configuration

For Claude Code (VS Code extension), the installer creates `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/codegraph-arkts/dist/bin/codegraph.js", "serve", "--mcp"]
    }
  }
}
```

Restart Claude Code. The `codegraph_*` MCP tools will be available.

## Architecture

```
Source (.ets, .ts, .py ...)
  → tree-sitter AST
    → LanguageExtractor (per-language config)
      → Nodes (functions, structs, methods, imports)
      → Edges (calls, contains, decorates, extends)
        → SQLite knowledge graph
          → MCP tools (search, explore, node, callers, callees)
            → AI coding agent
```

### Extractor Design

Each language has a `LanguageExtractor` config object that maps tree-sitter AST node types to semantic concepts:

```typescript
export const arktsExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration', 'function_signature', 'arrow_function', ...],
  structTypes: ['struct_declaration'],
  methodTypes: ['method_definition', 'public_field_definition'],
  callTypes: ['call_expression', 'arkui_component_expression'],
  // ...signature extraction, decorator handling, import resolution
};
```

Language-specific hooks (`resolveBody`, `getVisibility`, etc.) handle ArkTS's AST peculiarities, such as the `function_signature`/body separation in `export function`, body resolution for arrow-function class fields, and `accessibility_modifier` visibility recognition.

## Project Structure

```
src/
├── extraction/
│   ├── languages/
│   │   ├── arkts.ts          ← ArkTS extractor (this fork)
│   │   ├── typescript.ts
│   │   └── ...               ← 18 other language extractors
│   ├── wasm/
│   │   └── tree-sitter-arkts.wasm  ← compiled grammar (this fork)
│   ├── grammars.ts           ← WASM loading + extension mapping
│   ├── tree-sitter.ts        ← core extraction pipeline
│   └── tree-sitter-types.ts  ← LanguageExtractor interface
├── db/
│   └── sqlite-adapter.ts     ← SQLite backend (better-sqlite3 fallback added)
└── types.ts                  ← Language type definitions
```

## Upstream

This is a fork of [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) with ArkTS support added. The ArkTS tree-sitter grammar comes from [harmony-contrib/tree-sitter-arkts](https://github.com/harmony-contrib/tree-sitter-arkts).

### Rebuilding the ArkTS WASM Grammar

When `tree-sitter-arkts` upstream updates, rebuild the WASM grammar:

```bash
# With tree-sitter-arkts cloned as a sibling directory:
npm run build:wasm-arkts

# Or point to any local copy:
npm run build:wasm-arkts -- /path/to/tree-sitter-arkts
```

Prerequisites: Node.js (for `npx tree-sitter-cli`). The script clones nothing automatically — you must have the source locally.

See the [original README](https://github.com/colbymchenry/codegraph) for full CLI reference, framework-aware routes, benchmark results (v1.0.0: ~16% cheaper, ~58% fewer tool calls vs without CodeGraph across 7 repos), and troubleshooting.

## License

MIT — see [LICENSE](LICENSE). Upstream CodeGraph by Colby Mchenry. ArkTS grammar derived from tree-sitter-typescript and tree-sitter-arkts by harmony-contrib.
