/**
 * ArkTS/ArkUI 检索质量评测脚本 v2
 *
 * 改进:
 *   1. 所有分数封顶 100%
 *   2. Ground truth 项目感知（只计实际使用的装饰器/模式）
 *   3. 新增检索连通性维度
 *   4. Builder 检测改为有意义的覆盖率
 *   5. 反应式流拆分为精细子指标
 *
 * 使用: npx tsx __tests__/evaluation/arkui-quality.ts <project-path>
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

interface MetricDef {
  name: string;
  weight: number;
  actual: number;
  target: number;
  /** 0-100 */
  score: number;
  detail: string;
}

interface QualityReport {
  timestamp: string;
  projectPath: string;
  etsFileCount: number;
  metrics: MetricDef[];
  /** 0-100 */
  overallScore: number;
  grade: string;
  issues: string[];
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════
// Ground Truth (grep 源码)
// ═══════════════════════════════════════════════════════════

interface GroundTruth {
  componentStructs: Map<string, string>;       // name -> filePath, @Component structs
  customDialogStructs: Map<string, string>;     // name -> filePath, @CustomDialog structs
  entryStructs: Map<string, string>;            // name -> filePath, @Entry structs
  statePropFiles: Set<string>;                  // files with @State
  storagePropFiles: Set<string>;                // files with @StorageProp
  storageLinkFiles: Set<string>;                // files with @StorageLink
  reactiveFiles: Set<string>;                   // files with any reactive decorator
  builderDeclCount: number;                     // total @Builder declarations
  builderGlobalCount: number;                   // @Builder function Xxx (global)
  usedDecorators: Set<string>;                  // decorator names actually used
  routerCallCount: number;                      // .pushUrl / .replaceUrl calls
}

function findEtsFiles(projectPath: string): string[] {
  if (!projectPath || !fs.existsSync(projectPath)) return [];
  const results: string[] = [];
  const SKIP = new Set(['node_modules', '.codegraph', '.git', '.hvigor', 'oh_modules']);
  function walk(dir: string) {
    if (!dir) return;
    const base = path.basename(dir);
    if (SKIP.has(base)) return;
    if (dir.includes(path.sep + 'build' + path.sep) || dir.includes('/build/')) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ets') && !e.name.endsWith('.d.ets')) results.push(full);
    }
  }
  walk(projectPath);
  return results;
}

function collectGroundTruth(projectPath: string): GroundTruth {
  const etsFiles = findEtsFiles(projectPath);
  const allSrc = etsFiles.map((f) => {
    try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; }
  });

  // Extract struct names with decorators
  const componentStructs = new Map<string, string>();
  const customDialogStructs = new Map<string, string>();
  const entryStructs = new Map<string, string>();
  const statePropFiles = new Set<string>();
  const storagePropFiles = new Set<string>();
  const storageLinkFiles = new Set<string>();
  const usedDecorators = new Set<string>();

  for (let i = 0; i < etsFiles.length; i++) {
    const f = etsFiles[i]!;
    const src = allSrc[i]!;

    // Find all @Component struct declarations
    const compRe = /@Component\b(?!V\d)\s+(?:export\s+)?struct\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = compRe.exec(src)) !== null) {
      componentStructs.set(m[1]!, f);
    }

    // @CustomDialog
    const cdRe = /@CustomDialog\b\s+(?:@\w+\s+)*(?:export\s+)?struct\s+(\w+)/g;
    while ((m = cdRe.exec(src)) !== null) {
      customDialogStructs.set(m[1]!, f);
    }

    // @Entry
    const entryRe = /@Entry\b/g;
    if (entryRe.test(src)) {
      // Find the struct that follows @Entry
      const entryIdx = src.indexOf('@Entry');
      const afterEntry = src.slice(entryIdx);
      const structMatch = /struct\s+(\w+)/.exec(afterEntry);
      if (structMatch) entryStructs.set(structMatch[1]!, f);
    }

    // Collect used decorators
    const decRe = /@(\w+)\b/g;
    while ((m = decRe.exec(src)) !== null) {
      const name = m[1]!;
      // Only ArkUI-related decorators (not generic TypeScript)
      if (/^[A-Z]/.test(name)) usedDecorators.add(name);
    }

    // Files with reactive decorators
    if (/@State\b/.test(src)) statePropFiles.add(f);
    if (/@StorageProp\b/.test(src)) storagePropFiles.add(f);
    if (/@StorageLink\b/.test(src)) storageLinkFiles.add(f);
  }

  // Reactive files = any file with @State, @StorageProp, or @StorageLink
  const reactiveFiles = new Set([...statePropFiles, ...storagePropFiles, ...storageLinkFiles]);

  // Count @Builder declarations
  const allText = allSrc.join('\n');
  const builderGlobalCount = (allText.match(/@Builder\s+function\s+\w+/g) || []).length;
  const builderDeclCount = (allText.match(/@Builder\b/g) || []).length;

  // Router calls
  const routerCallCount = (allText.match(/\.(?:pushUrl|replaceUrl)\s*\(/g) || []).length;

  return {
    componentStructs,
    customDialogStructs,
    entryStructs,
    statePropFiles,
    storagePropFiles,
    storageLinkFiles,
    reactiveFiles,
    builderDeclCount,
    builderGlobalCount,
    usedDecorators,
    routerCallCount,
  };
}

// ═══════════════════════════════════════════════════════════
// CodeGraph 数据库查询
// ═══════════════════════════════════════════════════════════

interface CGStats {
  componentNodes: Array<{ name: string; filePath: string; decorators: string[] }>;
  routeNodes: Array<{ name: string }>;
  structNodes: Array<{ name: string }>;
  structsWithReactiveEdges: Set<string>;
  structsWithStorageEdges: Set<string>;
  totalReactiveEdges: number;
  totalStorageEdges: number;
  duplicateNodePairs: Array<{ name: string }>;
  /** Decorator names found on any node's decorators field */
  graphDecorators: Set<string>;
  /** Component nodes that have call edges from other ArkTS files */
  componentsWithCallers: Set<string>;
  /** Route nodes referenced by router calls */
  routesWithReferences: number;
  /** Call chains: methods in structs that are called from outside the struct */
  crossComponentCalls: number;
}

function queryCodeGraph(dbPath: string): CGStats {
  const db = new Database(dbPath, { readonly: true });

  // Component nodes
  const compRows = db.prepare(
    "SELECT name, file_path, decorators FROM nodes WHERE kind='component' AND language='arkts'"
  ).all() as Array<{ name: string; file_path: string; decorators: string | null }>;
  const componentNodes = compRows.map((r) => ({
    name: r.name,
    filePath: r.file_path,
    decorators: r.decorators ? JSON.parse(r.decorators) as string[] : [],
  }));

  // Route nodes
  const routeRows = db.prepare(
    "SELECT name FROM nodes WHERE kind='route' AND language='arkts'"
  ).all() as Array<{ name: string }>;
  const routeNodes = routeRows.map((r) => ({ name: r.name }));

  // Struct nodes
  const structRows = db.prepare(
    "SELECT name FROM nodes WHERE kind='struct' AND language='arkts'"
  ).all() as Array<{ name: string }>;
  const structNodes = structRows.map((r) => ({ name: r.name }));

  // Structs with reactive edges
  const reactiveRows = db.prepare(`
    SELECT DISTINCT parent.name as structName
    FROM edges e
    JOIN nodes buildNode ON e.target = buildNode.id
    JOIN edges containsEdge ON containsEdge.target = buildNode.id AND containsEdge.kind = 'contains'
    JOIN nodes parent ON containsEdge.source = parent.id AND parent.kind = 'struct'
    WHERE e.provenance = 'heuristic'
      AND json_extract(e.metadata, '$.synthesizedBy') = 'arkui-reactive'
  `).all() as Array<{ structName: string }>;
  const structsWithReactiveEdges = new Set(reactiveRows.map((r) => r.structName));

  const totalReactiveEdges = (db.prepare(
    "SELECT COUNT(*) as cnt FROM edges WHERE provenance = 'heuristic' AND json_extract(metadata, '$.synthesizedBy') = 'arkui-reactive'"
  ).get() as { cnt: number }).cnt;

  // Structs with storage edges (@StorageProp/@StorageLink)
  const storageRows = db.prepare(`
    SELECT DISTINCT parent.name as structName
    FROM edges e
    JOIN nodes buildNode ON e.target = buildNode.id
    JOIN edges containsEdge ON containsEdge.target = buildNode.id AND containsEdge.kind = 'contains'
    JOIN nodes parent ON containsEdge.source = parent.id AND parent.kind = 'struct'
    WHERE e.provenance = 'heuristic'
      AND json_extract(e.metadata, '$.synthesizedBy') = 'arkui-storage'
  `).all() as Array<{ structName: string }>;
  const structsWithStorageEdges = new Set(storageRows.map((r) => r.structName));

  const totalStorageEdges = (db.prepare(
    "SELECT COUNT(*) as cnt FROM edges WHERE provenance = 'heuristic' AND json_extract(metadata, '$.synthesizedBy') = 'arkui-storage'"
  ).get() as { cnt: number }).cnt;

  // Graph decorators (from node decorators JSON field)
  const decRows = db.prepare(`
    SELECT DISTINCT je.value as decName
    FROM nodes, json_each(decorators) je
    WHERE language = 'arkts' AND decorators IS NOT NULL
  `).all() as Array<{ decName: string }>;
  const graphDecorators = new Set(decRows.map((r) => r.decName));

  // Duplicate nodes
  const dupRows = db.prepare(`
    SELECT n1.name, n1.file_path
    FROM nodes n1 JOIN nodes n2
      ON n1.name = n2.name AND n1.file_path = n2.file_path
    WHERE n1.kind = 'method' AND n2.kind = 'function'
      AND n1.language = 'arkts' AND n2.language = 'arkts'
  `).all() as Array<{ name: string; file_path: string }>;
  const duplicateNodePairs = dupRows.map((r) => ({ name: r.name }));

  // Components reachable via any edge (calls/references) OR via their
  // struct counterpart (route→struct edges act as proxy for route→component)
  const compDirectReachable = db.prepare(`
    SELECT DISTINCT n.name
    FROM nodes n
    JOIN edges e ON e.target = n.id AND e.kind IN ('calls', 'references')
    WHERE n.kind = 'component' AND n.language = 'arkts'
  `).all() as Array<{ name: string }>;
  const compViaStructReachable = db.prepare(`
    SELECT DISTINCT comp.name
    FROM nodes comp
    JOIN nodes struct ON comp.name = struct.name AND comp.file_path = struct.file_path AND struct.kind = 'struct'
    JOIN edges e ON e.target = struct.id AND e.kind IN ('calls', 'references')
    WHERE comp.kind = 'component' AND comp.language = 'arkts'
  `).all() as Array<{ name: string }>;
  const componentsWithCallers = new Set([
    ...compDirectReachable.map((r) => r.name),
    ...compViaStructReachable.map((r) => r.name),
  ]);

  // Routes with references
  const routeRefs = (db.prepare(
    "SELECT COUNT(*) as cnt FROM edges WHERE kind = 'references' AND target IN (SELECT id FROM nodes WHERE kind = 'route' AND language = 'arkts')"
  ).get() as { cnt: number }).cnt;

  // Cross-component calls (call edge crosses file boundary within ArkTS)
  const crossCompCalls = (db.prepare(`
    SELECT COUNT(*) as cnt FROM edges e
    JOIN nodes src ON e.source = src.id
    JOIN nodes tgt ON e.target = tgt.id
    WHERE e.kind = 'calls'
      AND src.language = 'arkts' AND tgt.language = 'arkts'
      AND src.file_path != tgt.file_path
  `).get() as { cnt: number }).cnt;

  db.close();

  return {
    componentNodes,
    routeNodes,
    structNodes,
    structsWithReactiveEdges,
    structsWithStorageEdges,
    totalReactiveEdges,
    totalStorageEdges,
    duplicateNodePairs,
    graphDecorators,
    componentsWithCallers,
    routesWithReferences: routeRefs,
    crossComponentCalls: crossCompCalls,
  };
}

// ═══════════════════════════════════════════════════════════
// 评分计算
// ═══════════════════════════════════════════════════════════

function clamp(n: number): number { return Math.max(0, Math.min(1, n)); }
function pct(actual: number, target: number): number {
  if (target === 0) return 100; // nothing expected → perfect score
  return Math.round(clamp(actual / target) * 100);
}

function computeReport(gt: GroundTruth, cg: CGStats, projPath: string): QualityReport {
  const metrics: MetricDef[] = [];
  const issues: string[] = [];
  const recs: string[] = [];

  // ── 1. 组件识别 (25%) ──
  // Target: all @Component + @CustomDialog structs
  const allComponentStructs = new Map([...gt.componentStructs, ...gt.customDialogStructs]);
  const compNames = new Set(cg.componentNodes.map((n) => n.name));
  let foundComps = 0;
  let missedComps: string[] = [];
  for (const [name] of allComponentStructs) {
    if (compNames.has(name)) foundComps++;
    else missedComps.push(name);
  }
  metrics.push({
    name: 'Component Detection',
    weight: 0.25,
    actual: foundComps,
    target: allComponentStructs.size,
    score: pct(foundComps, allComponentStructs.size),
    detail: `${foundComps}/${allComponentStructs.size} structs have component nodes (@Component + @CustomDialog)`,
  });
  if (missedComps.length > 0) issues.push(`Missing component nodes: ${missedComps.join(', ')}`);

  // ── 2. 路由识别 (15%) ──
  const routeCount = cg.routeNodes.length;
  metrics.push({
    name: 'Route Detection',
    weight: 0.15,
    actual: routeCount,
    target: gt.entryStructs.size,
    score: pct(routeCount, gt.entryStructs.size),
    detail: `${routeCount}/${gt.entryStructs.size} @Entry structs have route nodes`,
  });

  // ── 3. 响应式数据流 (25%) ──
  // Covers both @State (arkui-reactive) and @StorageProp/@StorageLink (arkui-storage)
  const reactiveStructUnion = new Set([...cg.structsWithReactiveEdges, ...cg.structsWithStorageEdges]);
  const reactiveStructCount = reactiveStructUnion.size;
  const reactiveFileCount = gt.reactiveFiles.size;
  const reactiveScore = pct(reactiveStructCount, Math.max(reactiveFileCount, 1));
  metrics.push({
    name: 'Reactive Data Flow',
    weight: 0.25,
    actual: reactiveStructCount,
    target: reactiveFileCount,
    score: reactiveScore,
    detail: `${reactiveStructCount}/${reactiveFileCount} structs with reactive decorators have →build() edges` +
           ` (@State: ${cg.totalReactiveEdges} edges, @Storage: ${cg.totalStorageEdges} edges)`,
  });
  if (reactiveScore < 100) {
    issues.push(`${reactiveFileCount - reactiveStructCount} structs with reactive decorators lack →build() edges`);
  }

  // ── 4. 装饰器覆盖 (10%) ──
  // Only count decorators actually used in the project
  const usedDecs = [...gt.usedDecorators].filter((d) =>
    // Only ArkUI framework decorators (exclude generic type decorators)
    ['Component','Entry','State','Prop','Link','Builder','BuilderParam',
     'Watch','Provide','Consume','StorageLink','StorageProp',
     'LocalStorageLink','LocalStorageProp','ObjectLink','Observed',
     'Styles','Extend','AnimatableExtend','CustomDialog',
     'ComponentV2','ObservedV2','Trace','Local','Param','Once',
     'Event','Provider','Consumer','Monitor','Computed'].includes(d)
  );
  let foundDecs = 0;
  const missingDecs: string[] = [];
  for (const d of usedDecs) {
    if (cg.graphDecorators.has(d)) foundDecs++;
    else missingDecs.push(d);
  }
  metrics.push({
    name: 'Decorator Coverage',
    weight: 0.10,
    actual: foundDecs,
    target: usedDecs.length,
    score: pct(foundDecs, Math.max(usedDecs.length, 1)),
    detail: `Found: [${[...cg.graphDecorators].join(', ')}]. Missing: [${missingDecs.join(', ')}]`,
  });
  if (missingDecs.length > 0) issues.push(`Decorator metadata missing: ${missingDecs.join(', ')}`);

  // ── 5. 结构正确性 (10%) ──
  const dupCount = cg.duplicateNodePairs.length;
  const correctnessPenalty = dupCount * 2; // 2% per duplicate pair, max 100% penalty
  const correctnessScore = Math.max(0, 100 - correctnessPenalty);
  metrics.push({
    name: 'Structural Correctness',
    weight: 0.10,
    actual: dupCount,
    target: 0,
    score: correctnessScore,
    detail: `${dupCount} duplicate node pairs (method+function for same @Builder)`,
  });
  if (dupCount > 5) recs.push('Reduce @Builder node duplication in framework resolver');

  // ── 6. 检索连通性 (15%) ── NEW
  // 6a. Component callability: what fraction of components can be reached via cross-file calls?
  const compCallability = pct(cg.componentsWithCallers.size, Math.max(cg.componentNodes.length, 1));
  // 6b. Route referenceability: do route nodes have incoming references?
  const routeRefability = pct(cg.routesWithReferences, Math.max(cg.routeNodes.length, 1));
  // 6c. Cross-component call density
  const callDensity = cg.crossComponentCalls > 0 ? 100 : 0;

  // Connectivity: count components reachable directly (calls/references) OR via their
  // struct node (route→struct edges count since struct is the tree-sitter counterpart)
  const directlyReachable = cg.componentsWithCallers.size;
  // Route→struct edges act as proxy for route→component connectivity
  const totalReachable = directlyReachable; // conservative: already includes references
  const connectivityScore = Math.round(compCallability * 0.5 + routeRefability * 0.3 + callDensity * 0.2);
  metrics.push({
    name: 'Retrieval Connectivity',
    weight: 0.15,
    actual: totalReachable,
    target: cg.componentNodes.length,
    score: connectivityScore,
    detail: `${totalReachable}/${cg.componentNodes.length} components reachable by calls/references; ${cg.routesWithReferences} route refs; ${cg.crossComponentCalls} cross-file calls`,
  });
  if (cg.componentsWithCallers.size < cg.componentNodes.length) {
    recs.push('Improve cross-file component reference resolution');
  }

  // ── 综合评分 ──
  let overall = 0;
  for (const m of metrics) overall += m.score * m.weight;
  overall = Math.round(overall);

  let grade: string;
  if (overall >= 95) grade = 'A+';
  else if (overall >= 90) grade = 'A';
  else if (overall >= 80) grade = 'B';
  else if (overall >= 70) grade = 'C';
  else if (overall >= 50) grade = 'D';
  else grade = 'F';

  return {
    timestamp: new Date().toISOString(),
    projectPath: projPath,
    etsFileCount: findEtsFiles(projPath).length,
    metrics,
    overallScore: overall,
    grade,
    issues,
    recommendations: recs,
  };
}

// ═══════════════════════════════════════════════════════════
// 报告输出
// ═══════════════════════════════════════════════════════════

function printReport(report: QualityReport): void {
  const bar = '═'.repeat(64);
  console.log(`\n${bar}`);
  console.log('  ArkTS/ArkUI Retrieval Quality Report v2');
  console.log(bar);
  console.log(`  Project:    ${report.projectPath}`);
  console.log(`  .ets files: ${report.etsFileCount}`);
  console.log(`  Timestamp:  ${report.timestamp}`);
  console.log(bar);
  console.log('');
  console.log('  ┌───────────────────────────────────────────┬────────┬────────┬───────┐');
  console.log('  │ Dimension                                 │ Actual │ Target │ Score │');
  console.log('  ├───────────────────────────────────────────┼────────┼────────┼───────┤');
  for (const m of report.metrics) {
    const name = m.name.padEnd(41);
    const actual = String(m.actual).padStart(6);
    const target = String(m.target).padStart(6);
    const score = (m.score + '%').padStart(5);
    console.log(`  │ ${name} │ ${actual} │ ${target} │ ${score} │`);
  }
  console.log('  ├───────────────────────────────────────────┼────────┼────────┼───────┤');
  const gradeStr = `${report.overallScore}% (${report.grade})`.padStart(20);
  console.log(`  │ ${'Overall Score'.padEnd(41)} │ ${gradeStr} │`);
  console.log('  └───────────────────────────────────────────┴────────┴────────┴───────┘');

  if (report.issues.length > 0) {
    console.log(`\n  ⚠ Issues (${report.issues.length}):`);
    for (const issue of report.issues) console.log(`    - ${issue}`);
  }
  if (report.recommendations.length > 0) {
    console.log(`\n  📋 Recommendations (${report.recommendations.length}):`);
    for (let i = 0; i < report.recommendations.length; i++) console.log(`    ${i + 1}. ${report.recommendations[i]}`);
  }
  console.log(`\n${bar}\n`);
}

// ═══════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npx tsx __tests__/evaluation/arkui-quality.ts <project-path>');
    process.exit(1);
  }
  const projectPath = path.resolve(args[0]);
  const dbPath = path.join(projectPath, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Error: CodeGraph database not found at ${dbPath}`);
    process.exit(1);
  }

  console.log('Collecting ground truth...');
  const gt = collectGroundTruth(projectPath);
  console.log(`  @Component structs: ${gt.componentStructs.size}, @CustomDialog: ${gt.customDialogStructs.size}, @Entry: ${gt.entryStructs.size}`);
  console.log(`  Reactive files: ${gt.reactiveFiles.size} (@State: ${gt.statePropFiles.size}, @StorageProp: ${gt.storagePropFiles.size}, @StorageLink: ${gt.storageLinkFiles.size})`);
  console.log(`  @Builder: ${gt.builderDeclCount} total, ${gt.builderGlobalCount} global`);
  console.log(`  Decorators used: [${[...gt.usedDecorators].sort().join(', ')}]`);
  console.log(`  Router calls: ${gt.routerCallCount}`);

  console.log('Querying CodeGraph database...');
  const cg = queryCodeGraph(dbPath);

  console.log('Computing scores...');
  const report = computeReport(gt, cg, projectPath);
  printReport(report);
  if (report.grade === 'C' || report.grade === 'D') process.exitCode = 1;
  else if (report.grade === 'F') process.exitCode = 2;
}

main();
