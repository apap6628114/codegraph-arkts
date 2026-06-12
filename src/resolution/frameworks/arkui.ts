/**
 * ArkUI Framework Resolver
 *
 * Handles ArkUI declarative UI framework patterns for HarmonyOS NEXT.
 * Extracts @Component structs as component nodes, @Entry components as
 * routes, @Builder functions, and router navigation calls.
 */

import { Node } from '../../types';
import { FrameworkResolver, UnresolvedRef, ResolvedRef, ResolutionContext } from '../types';

/** ArkUI built-in component names — never resolve these to custom components */
const ARKUI_BUILTINS = new Set([
  'Column', 'Row', 'Stack', 'Flex', 'Grid', 'List', 'Text', 'Button',
  'TextInput', 'Image', 'ForEach', 'LazyForEach', 'If', 'Else',
  'Navigation', 'NavDestination', 'Scroll', 'Divider', 'Swiper',
  'Tabs', 'TabContent', 'Refresh', 'ListItem', 'GridItem',
  'LoadingProgress', 'Progress', 'Slider', 'Checkbox', 'Radio',
  'Toggle', 'Select', 'DatePicker', 'TimePicker', 'TextArea',
  'Blank', 'RelativeContainer', 'Panel', 'SideBar',
]);

/** Preferred directory names for component resolution */
const COMPONENT_DIRS = ['/pages/', '/components/', '/views/', '/src/pages/', '/src/components/', '/src/views/', '/ets/pages/', '/ets/components/'];

export const arkuiResolver: FrameworkResolver = {
  name: 'arkui',
  languages: ['arkts'],

  detect(context: ResolutionContext): boolean {
    const allFiles = context.getAllFiles();
    return allFiles.some((f) => f.endsWith('.ets'));
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    // Pattern 1: PascalCase component references from ArkTS files.
    // Skip built-in component names (Column, Text, Button, etc.).
    if (
      ref.language === 'arkts' &&
      ref.referenceKind === 'calls' &&
      isPascalCase(ref.referenceName) &&
      !ARKUI_BUILTINS.has(ref.referenceName)
    ) {
      const result = resolveComponent(ref.referenceName, ref.filePath, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    // Pattern 2: @State / @Prop / @Link decorator references from ArkTS files
    // resolve to the decorator's conceptual definition (framework built-in).
    // Skip — these are framework-internal decorators with no local definition.

    // Pattern 3: router.pushUrl / router.replaceUrl path references
    if (
      ref.language === 'arkts' &&
      ref.referenceKind === 'references' &&
      ref.referenceName.startsWith('pages/')
    ) {
      const result = resolveRoute(ref.referenceName, context);
      if (result) {
        return {
          original: ref,
          targetNodeId: result,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string) {
    if (!filePath.endsWith('.ets')) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const now = Date.now();

    // ── A. @Component struct → component nodes ──
    // Matches: @Component struct Xxx { ... }
    //          @Component export struct Xxx { ... }  (common in .ets files)
    // Also handles stacked decorators: @Entry\n@Component struct Xxx { ... }
    // Word-boundary assertion prevents false match on @ComponentV2
    const componentPattern = /@Component\b(?!V\d)\s+(?:export\s+)?struct\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = componentPattern.exec(content)) !== null) {
      const [, name] = match;
      const line = content.slice(0, match.index).split('\n').length;
      // Check whether @Entry decorator appears within 80 chars before the match
      const preceding = content.slice(Math.max(0, match.index - 80), match.index);
      const hasEntry = /@Entry\b/.test(preceding);
      const isExported = /export\b/.test(preceding) || match[0].includes('export');

      nodes.push({
        id: `component:${filePath}:${name}:${line}`,
        kind: 'component',
        name: name!,
        qualifiedName: `${filePath}::${name}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'arkts',
        isExported,
        decorators: hasEntry ? ['Component', 'Entry'] : ['Component'],
        updatedAt: now,
      });
    }

    // ── A2. @CustomDialog struct → component nodes ──
    // Matches: @CustomDialog struct Xxx { ... }
    //          @CustomDialog export struct Xxx { ... }
    // @CustomDialog is a decorator that marks a struct as a custom dialog component.
    const customDialogPattern = /@CustomDialog\s+(?:@\w+\s+)*(?:export\s+)?struct\s+(\w+)/g;
    while ((match = customDialogPattern.exec(content)) !== null) {
      const [, name] = match;
      const line = content.slice(0, match.index).split('\n').length;
      const preceding = content.slice(Math.max(0, match.index - 80), match.index);
      const hasEntry = /@Entry\b/.test(preceding);
      const isExported = /export\b/.test(preceding) || match[0].includes('export');

      // If already detected as a @Component struct, merge CustomDialog into
      // its decorators instead of creating a duplicate component node.
      // Match by name+filePath (not by id, since line numbers may differ).
      const existing = nodes.find(
        (n) => n.kind === 'component' && n.name === name && n.filePath === filePath,
      );
      if (existing) {
        if (!existing.decorators?.includes('CustomDialog')) {
          (existing.decorators ??= []).push('CustomDialog');
        }
        if (hasEntry && !existing.decorators?.includes('Entry')) {
          (existing.decorators ??= []).push('Entry');
        }
        continue;
      }

      nodes.push({
        id: `component:${filePath}:${name}:${line}`,
        kind: 'component',
        name: name!,
        qualifiedName: `${filePath}::${name}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'arkts',
        isExported,
        decorators: hasEntry ? ['CustomDialog', 'Entry'] : ['CustomDialog'],
        updatedAt: now,
      });
    }

    // ── B. @Entry @Component struct → route nodes ──
    const entryPattern = /@Entry\s+@Component\b(?!V\d)\s+(?:export\s+)?struct\s+(\w+)/g;
    while ((match = entryPattern.exec(content)) !== null) {
      const [, name] = match;
      const line = content.slice(0, match.index).split('\n').length;
      const routePath = filePathToArkRoute(filePath, name!);
      const routeId = `route:${filePath}:${line}:${routePath}`;

      nodes.push({
        id: routeId,
        kind: 'route',
        name: routePath,
        qualifiedName: `${filePath}::route:${routePath}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'arkts',
        updatedAt: now,
      });

      // Link route → component so retrieval traces can follow router calls to components
      references.push({
        fromNodeId: routeId,
        referenceName: name!,
        referenceKind: 'references',
        line,
        column: 0,
        filePath,
        language: 'arkts',
      });
    }

    // ── C. @Builder function (global scope only) → function nodes ──
    // Only matches `@Builder function Xxx()` — module-level builder functions with the
    // `function` keyword.  Struct-internal `@Builder Xxx()` (without `function` keyword)
    // is skipped because tree-sitter already extracts it as a method node.
    const builderPattern = /@Builder\s+function\s+(\w+)\s*\(/g;
    while ((match = builderPattern.exec(content)) !== null) {
      const [, builderName] = match;
      const line = content.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `function:${filePath}:${builderName}:${line}`,
        kind: 'function',
        name: builderName!,
        qualifiedName: `${filePath}::${builderName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'arkts',
        updatedAt: now,
      });

      // Emit a decorates reference from the @Builder function to the Builder decorator
      references.push({
        fromNodeId: `function:${filePath}:${builderName}:${line}`,
        referenceName: 'Builder',
        referenceKind: 'decorates',
        line,
        column: 0,
        filePath,
        language: 'arkts',
      });
    }

    // ── D. @BuilderParam property → reference to Builder function ──
    const builderParamPattern = /@BuilderParam\s+(\w+)\s*:/g;
    while ((match = builderParamPattern.exec(content)) !== null) {
      const [, paramName] = match;
      const line = content.slice(0, match.index).split('\n').length;

      references.push({
        fromNodeId: `file:${filePath}`,
        referenceName: paramName!,
        referenceKind: 'references',
        line,
        column: 0,
        filePath,
        language: 'arkts',
      });
    }

    // ── E. .pushUrl / .replaceUrl → route references ──
    // Matches any receiver-variant: router.pushUrl(...), this.getRouter().pushUrl(...),
    // this.getUIContext().getRouter().replaceUrl(...), etc.
    const routerPushPattern = /\.(?:pushUrl|replaceUrl)\s*\(\s*\{[^}]*url\s*:\s*['"]([^'"]+)['"]/g;
    while ((match = routerPushPattern.exec(content)) !== null) {
      const [, url] = match;
      const line = content.slice(0, match.index).split('\n').length;

      references.push({
        fromNodeId: `file:${filePath}`,
        referenceName: url!,
        referenceKind: 'references',
        line,
        column: 0,
        filePath,
        language: 'arkts',
      });
    }

    return { nodes, references };
  },
};

/**
 * Check if string is PascalCase
 */
function isPascalCase(str: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(str);
}

/**
 * Resolve a PascalCase component name to a component node.
 * Prefers same-directory matches, then known component directories.
 */
function resolveComponent(
  name: string,
  fromFile: string,
  context: ResolutionContext,
): string | null {
  const candidates = context.getNodesByKind('component');
  if (candidates.length === 0) return null;

  const matching = candidates.filter((n) => n.name === name && n.language === 'arkts');
  if (matching.length === 0) return null;

  // Prefer same directory
  const fromDir = fromFile.substring(0, fromFile.lastIndexOf('/'));
  const sameDir = matching.filter((n) => n.filePath.startsWith(fromDir));
  if (sameDir.length > 0) return sameDir[0]!.id;

  // Prefer known component directories
  const preferred = matching.filter((n) =>
    COMPONENT_DIRS.some((d) => n.filePath.includes(d)),
  );
  if (preferred.length > 0) return preferred[0]!.id;

  // Only an unambiguous name can resolve
  return matching.length === 1 ? matching[0]!.id : null;
}

/**
 * Resolve a route path (e.g. 'pages/Detail') to a route node.
 */
function resolveRoute(
  routePath: string,
  context: ResolutionContext,
): string | null {
  const candidates = context.getNodesByKind('route');
  const matching = candidates.filter(
    (n) => n.language === 'arkts' && (n.name === routePath || n.name.endsWith(routePath)),
  );
  if (matching.length === 0) return null;
  return matching[0]!.id;
}

/**
 * Convert an ArkTS file path to a route path.
 *
 * Examples:
 *   src/main/ets/pages/Index.ets  → /pages/Index
 *   pages/Detail.ets              → /pages/Detail
 *   src/main/ets/views/Home.ets   → /views/Home
 */
function filePathToArkRoute(filePath: string, componentName: string): string {
  // Strip extension
  const withoutExt = filePath.replace(/\.ets$/, '');

  // Find the first known parent directory that indicates a page/view
  const knownDirs = ['pages', 'views', 'components'];
  for (const dir of knownDirs) {
    const idx = withoutExt.indexOf(`/${dir}/`);
    if (idx >= 0) {
      return withoutExt.slice(idx);
    }
  }

  // Fallback: use the file path segments as route
  // Remove common prefixes like 'src/main/ets/'
  const cleaned = withoutExt.replace(/^src\/main\/ets\//, '/');
  if (cleaned.startsWith('/')) return cleaned;

  return `/${componentName}`;
}
