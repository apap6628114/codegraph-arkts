/**
 * 在 MCP `initialize` 响应中发送的服务级指令。
 *
 * MCP 客户端（Claude Code、Cursor、opencode、LangChain、OpenAI Agent
 * SDK 等）会自动将此文本注入到 AI 助手的系统提示词中，
 * 让助手在查看具体工具描述之前，先对 codegraph 工具集有一个高阶的使用指南。
 *
 * 编辑此文件时的目标：
 *   - 按意图选择工具（哪个问题用哪个工具）
 *   - 常见工作链（重构规划 = 先 X 后 Y）
 *   - 反模式（不要用 grep 做 codegraph_search 更快能做的事）
 *
 * 保持简洁。助手每个会话都会读到这些内容——太长的指令会浪费 token。
 * 只引用 `main` 分支上已有的工具；未来如果有条件性工具，请用 feature check 控制。
 */
export const SERVER_INSTRUCTIONS = `# Codegraph —— 基于索引知识图谱的代码智能

Codegraph 是一个 SQLite 知识图谱，存储了工作区中每个符号、边和文件的信息。
读取速度毫秒级；索引通过文件监视器滞后写入约一秒。请在**编写或编辑代码之前**查阅它，而非之后。

## 直接回答 —— 不要委托给探索

对于"X 是如何工作的"、架构、追踪或"X 在哪里"这类问题，
请**直接**回答 —— 通常只需要一次 \`codegraph_explore\` 调用。
\`codegraph_explore\` 接受一个自然语言问题或一组符号/文件名，
返回按文件分组的相关符号的完整源代码，因此它等价于 Read，并且大多数情况下
是你唯一需要的 codegraph 调用。Codegraph **就是**预先构建好的搜索索引 ——
所以把查找委托给一个单独的文件读取子任务/子代理，或者自己写 grep + read 循环，
都是在重复 codegraph 已经做过的工作，并且为了得到相同的答案花费更多成本。
只有在确认 codegraph 未覆盖的某个具体细节时，才使用原始的 Read/Grep。
一个直接的 codegraph 答案通常只需要一到几次调用；而 grep/read 探索则需要几十次。

## 查询语言规则

所有 codegraph 查询参数（query、symbol 等）**仅接受英文输入**。中文或其他语言的文本无法匹配代码中的英文符号名，请勿传入。

## 按意图选择工具

- **几乎所有问题 —— "X 如何工作"、架构、bug、"X 是什么/在哪里"、或调查某个领域** → \`codegraph_explore\`（**首选** —— 优先调用；单次有上限的调用就会返回按文件分组的相关符号的完整源代码；大多数情况下是你唯一需要的调用）
- **"X 如何到达/变成 Y？/ 流程 / 从 X 到 Y 的路径"** → \`codegraph_explore\`，传入跨越该流程的符号名（例如 \`mutateElement renderScene\`）—— 它会展示这些符号之间的调用路径，包括 grep 无法追踪的动态分发跳转（回调、React 重新渲染、JSX 子组件）
- **"名为 X 的符号在哪里？"（仅位置）** → \`codegraph_search\`
- **"谁调用了这个？" / "这个调用了什么？" / "修改这个会破坏什么？"** → \`codegraph_callers\` / \`codegraph_callees\` / \`codegraph_impact\`
- **某个特定符号的完整源代码（尤其是被 \`codegraph_explore\` 截断的函数体），或一个**重载的符号名** → \`codegraph_node\`（带上 \`includeCode\`）：对于有歧义的名称，它会在一次调用中返回**所有**匹配定义的函数体，所以你永远不需要 Read 文件来找到正确的重载
- **"X 目录里有什么？"** → \`codegraph_files\`
- **"索引准备好了吗？ / 它有多大？"** → \`codegraph_status\`

## 常见工作链

- **流程 / "X 如何到达 Y"**：一次 \`codegraph_explore\`，传入跨越流程的符号名 —— 它会展示它们之间的调用路径（利用动态分发跳转）**同时**返回它们的源代码。无需用 \`codegraph_search\` + \`codegraph_callers\` 重建路径。
- **上手 / 理解任何领域**：一次 \`codegraph_explore\` 通常就是全部答案。只有当仍有不清楚的地方时，才跟进 —— 对某个特定符号使用 \`codegraph_node\`。
- **重构规划**：\`codegraph_search\` → \`codegraph_callers\` → \`codegraph_impact\`。影响范围的答案来自 impact，而非手动遍历 callers。
- **调试回归**：对被怀疑的符号使用 \`codegraph_callers\`；如果出现了意外的调用，用 \`codegraph_impact\` 扩大范围。

## 反模式

- **相信 codegraph 的结果 —— 不要用 grep 重新验证它们。** 它们来自完整的 AST 解析；用 grep 重新检查速度更慢、准确度更低，而且浪费上下文。
- **不要先用 grep** 查找符号名 —— \`codegraph_search\` 更快，并且会返回种类 + 位置 + 签名。
- **不要链式调用 \`codegraph_search\` + \`codegraph_node\`** 来理解某个领域 —— 一次 \`codegraph_explore\` 就能在一次往返中返回相关符号的源代码。
- **不要对多个符号循环调用 \`codegraph_node\`** —— 一次 \`codegraph_explore\` 调用就能按文件分组返回所有符号，而每次单独的 \`codegraph_node\` 调用都会重新读取整个上下文，成本高出很多。\`codegraph_node\` 用于单个符号。
- **编辑后，检查过时标记。** 当工具响应以 "⚠️ 以下引用的某些文件自上次索引同步以来已被编辑…" 开头时，列出的文件正在等待重新索引 —— 请 Read 这些特定文件以获取准确内容。**不**在该标记中的每个文件都是最新的，所以仍可信任 codegraph。\`codegraph_status\` 也会在 "Pending sync" 下列出待处理的文件。

## 局限性

- 如果某个工具报告项目未初始化，说明 \`.codegraph/\` 尚不存在 —— 建议运行 \`codegraph init -i\` 来构建索引。
- 索引滞后于文件写入约 1 秒。
- 跨文件解析是尽力而为的名称匹配；有歧义的调用可能返回多个候选项。
- 没有实时的正确性验证 —— 这仍然是 TypeScript 编译器 / 测试套件 / linter 的职责。Codegraph 用这些工具所不具备的结构性上下文来补充它们。
`;
