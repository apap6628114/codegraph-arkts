<div align="center">

# CodeGraph-ArkTS

### CodeGraph 分支 — ArkTS / HarmonyOS 支持

**ArkTS、TypeScript 及 20+ 语言的预索引语义代码知识图谱**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Forked from colbymchenry/codegraph](https://img.shields.io/badge/fork-colbymchenry%2Fcodegraph-blue)](https://github.com/colbymchenry/codegraph)

[English](README.en.md) | **中文**

</div>

CodeGraph 是一个基于 tree-sitter 的知识图谱引擎，它将代码库中的每个符号、调用、导入和继承关系索引到本地 SQLite 数据库中。AI 编程助手（Claude Code、Cursor、Codex CLI）可直接查询它，替代 grep/read 循环——更快、更省。

此分支新增了 **ArkTS 语言完整支持**，用于鸿蒙（HarmonyOS）应用开发。

## 新增特性

### ArkTS 语言支持

| 特性 | 状态 |
|------|------|
| `struct` 声明（`@Component`、`@Entry`） | ✅ 提取结构体 + 装饰器引用 |
| `@State`、`@Link`、`@Prop`、`@Builder` 等 | ✅ 捕获为 `decorates` 边 |
| ArkUI 组件调用（`Column()`、`Text()`、`Row()`） | ✅ 识别为调用图边 |
| `build()` 及生命周期方法 | ✅ 方法提取 + 签名 |
| `@Extend` / `@Styles` 装饰器 | ✅ 函数提取 + 装饰器元数据 |
| `import lazy` | ✅ 导入节点提取 |
| 顶层常量与变量 | ✅ `const`/`let`/`var` 提取 |
| 类型注解与泛型 | ✅ 类型引用边 |
| interfaces、enums、type aliases | ✅ 完整支持 |
| `export struct` / `export function` | ✅ 导出标记 + 函数体解析 |
| 可见性修饰符 | ✅ `public`/`private`/`protected` |

### 技术变更

- **语言提取器** — `src/extraction/languages/arkts.ts`，包含 ArkUI 特定的 AST 节点类型映射
- **WASM 语法文件** — `tree-sitter-arkts` 编译为 WASM；通过 `npm run build:wasm-arkts [source-path]` 重新构建
- **AST 适配** — 处理 `function_signature` 函数体解析（ArkTS 中 `export function` 将签名与函数体分离）、`arkui_component_expression` 调用识别、`lazy_import_statement` 导入提取
- **核心增强** — `extractStruct` 装饰器支持、变量提取语言注册、类型注解语言注册

## 支持的语言

| 语言 | 扩展名 | 状态 |
|------|--------|------|
| **ArkTS**（鸿蒙） | `.ets` | **完整支持（此分支）** |
| TypeScript | `.ts`, `.tsx` | 完整支持 |
| JavaScript | `.js`, `.jsx`, `.mjs` | 完整支持 |
| Python | `.py` | 完整支持 |
| Go | `.go` | 完整支持 |
| Rust | `.rs` | 完整支持 |
| Java | `.java` | 完整支持 |
| C# | `.cs` | 完整支持 |
| PHP | `.php` | 完整支持 |
| Ruby | `.rb` | 完整支持 |
| C/C++ | `.c`, `.cpp`, `.h`, `.hpp` | 完整支持 |
| Swift | `.swift` | 完整支持 |
| Kotlin | `.kt`, `.kts` | 完整支持 |
| Dart | `.dart` | 完整支持 |
| 另加 8 种 | 见上游 CodeGraph | 完整支持 |

## 快速开始

### 前置条件

- Node.js 22.5+（需 `node:sqlite` 支持 FTS5），或安装 `better-sqlite3` 作为后备
- 一个包含 `.ets` 文件的鸿蒙/ArkTS 项目

### 安装与初始化

```bash
# 1. 构建此分支
cd codegraph-arkts
npm install
npm run build

# 2. 在你的项目中初始化
node dist/bin/codegraph.js init /path/to/your/project

# 3. 索引所有文件
node dist/bin/codegraph.js index /path/to/your/project

# 4. 安装 MCP 服务器（以 Claude Code 为例）
node dist/bin/codegraph.js install --location=local --yes
```

### MCP 服务器配置

对于 Claude Code（VS Code 扩展），安装器会在项目根目录创建 `.mcp.json`：

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

重启 Claude Code 后，`codegraph_*` MCP 工具即可使用。

## 架构

```
源码 (.ets, .ts, .py ...)
  → tree-sitter AST
    → LanguageExtractor（语言提取器配置）
      → Nodes（函数、结构体、方法、导入）
      → Edges（调用、包含、装饰、继承）
        → SQLite 知识图谱
          → MCP 工具（search、context、trace、callers、callees）
            → AI 编程助手
```

### 提取器设计

每种语言都有一个 `LanguageExtractor` 配置对象，将 tree-sitter AST 节点类型映射到语义概念：

CodeGraph can be embedded directly. The npm package re-exports its programmatic
API, so both `import` and `require` resolve the `CodeGraph` class in your own
process — handy for embedding it in an app (e.g. an Electron main process).

```typescript
export const arktsExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration', 'function_signature', 'arrow_function', ...],
  structTypes: ['struct_declaration'],
  methodTypes: ['method_definition', 'public_field_definition'],
  callTypes: ['call_expression', 'arkui_component_expression'],
  // ...签名提取、装饰器处理、导入解析
};
```

语言特定的钩子（`visitNode`、`resolveBody`、`extractImport`）处理 ArkTS 的 AST 特殊之处，如 `export function` 中 `function_signature`/函数体的分离。

```typescript
import CodeGraph from '@colbymchenry/codegraph';
// CommonJS works too:
//   const { CodeGraph } = require('@colbymchenry/codegraph');

const cg = await CodeGraph.init('/path/to/project');
// Or: const cg = await CodeGraph.open('/path/to/project');

await cg.indexAll({
  onProgress: (p) => console.log(`${p.phase}: ${p.current}/${p.total}`)
});

const results = cg.searchNodes('UserService');
const callers = cg.getCallers(results[0].node.id);
const context = await cg.buildContext('fix login bug', { maxNodes: 20, includeCode: true, format: 'markdown' });
const impact = cg.getImpactRadius(results[0].node.id, 2);

cg.watch();   // auto-sync on file changes
cg.unwatch(); // stop watching
cg.close();
```

Lower-level building blocks are exported from the same entry point for callers
that drive the graph directly: `DatabaseConnection`, `QueryBuilder`,
`getDatabasePath`, `initGrammars` / `loadGrammarsForLanguages`, and `FileLock`.

**Embedding requirements**

- Install from npm (`npm i @colbymchenry/codegraph`) so the matching
  per-platform package — which carries the compiled library and its
  dependencies — is fetched alongside the shim.
- The API runs on **your** runtime, so it needs **Node 22.5+** for the built-in
  `node:sqlite` (Electron qualifies when its bundled Node is 22.5+). The CLI and
  MCP server are unaffected — they run on the self-contained bundled runtime.
- TypeScript types ship with the package. As with any Node-targeting library,
  keep `@types/node` available and `skipLibCheck: true` (the common default).

---

## 项目结构

```
src/
├── extraction/
│   ├── languages/
│   │   ├── arkts.ts          ← ArkTS 提取器（此分支）
│   │   ├── typescript.ts
│   │   └── ...               ← 其他 18 种语言提取器
│   ├── wasm/
│   │   └── tree-sitter-arkts.wasm  ← 编译好的语法文件（此分支）
│   ├── grammars.ts           ← WASM 加载 + 扩展名映射
│   ├── tree-sitter.ts        ← 核心提取流水线
│   └── tree-sitter-types.ts  ← LanguageExtractor 接口
├── db/
│   └── sqlite-adapter.ts     ← SQLite 后端（添加了 better-sqlite3 回退）
└── types.ts                  ← 语言类型定义
```

## 上游

此分支是 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) 的一个分支，增加了 ArkTS 支持。ArkTS tree-sitter 语法来自 [harmony-contrib/tree-sitter-arkts](https://github.com/harmony-contrib/tree-sitter-arkts)。

### 重新构建 ArkTS WASM 语法

当 `tree-sitter-arkts` 上游更新时，重新构建 WASM 语法：

```bash
# tree-sitter-arkts 克隆为同级目录时：
npm run build:wasm-arkts

# 或指向任意本地副本：
npm run build:wasm-arkts -- /path/to/tree-sitter-arkts
```

前置条件：Node.js（用于 `npx tree-sitter-cli`）。该脚本不会自动克隆任何内容——你需要本地已有源码。

完整 CLI 参考、框架路由识别、基准测试结果和故障排查请参阅[上游 README](https://github.com/colbymchenry/codegraph)（英文）。

## 许可证

MIT — 参见 [LICENSE](LICENSE)。上游 CodeGraph 由 Colby Mchenry 开发。ArkTS 语法源自 tree-sitter-typescript 和 harmony-contrib 的 tree-sitter-arkts。
