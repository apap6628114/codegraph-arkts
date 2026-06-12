import { getNodeText, getChildByField } from '../tree-sitter-helpers';
import type { LanguageExtractor } from '../tree-sitter-types';
import { classifyTsClassMember } from './typescript';

export const arktsExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration', 'function_signature', 'arrow_function', 'function_expression'],
  classTypes: ['class_declaration', 'abstract_class_declaration'],
  methodTypes: ['method_definition', 'public_field_definition'],
  classifyMethodNode: classifyTsClassMember,
  interfaceTypes: ['interface_declaration'],
  structTypes: ['struct_declaration'],
  enumTypes: ['enum_declaration'],
  enumMemberTypes: ['property_identifier', 'enum_assignment'],
  typeAliasTypes: ['type_alias_declaration'],
  importTypes: ['import_statement'],
  callTypes: ['call_expression', 'arkui_component_expression'],
  variableTypes: ['lexical_declaration', 'variable_declaration'],
  nameField: 'name',
  bodyField: 'body',
  resolveBody: (node, bodyField) => {
    // ArkTS `export function` is parsed as `export_statement → function_signature`
    // with the body (statement_block) as a *sibling* of export_statement at the
    // program level. Walk up to find it.
    if (node.type === 'function_signature') {
      const parent = node.parent;
      if (parent) {
        const sibling = parent.nextNamedSibling;
        if (sibling?.type === 'statement_block') return sibling;
      }
      return null;
    }
    // public_field_definition (arrow function class fields) nest the body inside
    // an arrow_function or function_expression child:
    //   public_field_definition → arrow_function → body (statement_block)
    // Also handles wrapper patterns like: field = withBatchedUpdates((e) => { ... })
    //   public_field_definition → call_expression → arguments → arrow_function → body
    if (node.type === 'public_field_definition') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (child.type === 'arrow_function' || child.type === 'function_expression') {
          return getChildByField(child, bodyField);
        }
        if (child.type === 'call_expression') {
          const args = getChildByField(child, 'arguments');
          if (args) {
            for (let j = 0; j < args.namedChildCount; j++) {
              const arg = args.namedChild(j);
              if (arg && (arg.type === 'arrow_function' || arg.type === 'function_expression')) {
                return getChildByField(arg, bodyField);
              }
            }
          }
        }
      }
    }
    return null;
  },
  paramsField: 'parameters',
  returnField: 'return_type',
  getSignature: (node, source) => {
    const params = getChildByField(node, 'parameters');
    const returnType = getChildByField(node, 'return_type');
    if (!params) return undefined;
    let sig = getNodeText(params, source);
    if (returnType) {
      sig += ': ' + getNodeText(returnType, source).replace(/^:\s*/, '');
    }
    return sig;
  },
  getVisibility: (node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'accessibility_modifier') {
        const text = child.text;
        if (text === 'public') return 'public';
        if (text === 'private') return 'private';
        if (text === 'protected') return 'protected';
      }
    }
    return undefined;
  },
  isExported: (node, _source) => {
    let current = node.parent;
    while (current) {
      if (current.type === 'export_statement') return true;
      current = current.parent;
    }
    return false;
  },
  isAsync: (node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'async') return true;
    }
    return false;
  },
  isStatic: (node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'static') return true;
    }
    return false;
  },
  isConst: (node) => {
    if (node.type === 'lexical_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'const') return true;
      }
    }
    return false;
  },
  /**
   * Extract ArkUI decorator names from decorator nodes applied to structs,
   * methods, and properties. Handles three decorator forms:
   *
   *   - Simple: `@Component` → decorator → identifier("Component")
   *   - Call: `@Watch('callback')` → decorator → call_expression → identifier("Watch")
   *   - Member: `@AnimatorExtend.AnimatorExtend` → decorator → member_expression
   *
   * Decorators may be direct named children of the declaration (methods,
   * properties) or preceding siblings (struct-level decorators).
   */
  extractModifiers: (node) => {
    const mods: string[] = [];

    /** Extract the decorator's simple name from a decorator AST node. */
    const getName = (dec: typeof node): string | undefined => {
      for (let i = 0; i < dec.namedChildCount; i++) {
        const child = dec.namedChild(i);
        if (!child) continue;
        if (child.type === 'call_expression') {
          const fn = getChildByField(child, 'function') ?? child.namedChild(0);
          if (fn && fn.text) {
            const text = fn.text.trim();
            if (text) return text;
          }
        }
        if (child.type === 'identifier') {
          return child.text;
        }
        if (child.type === 'member_expression') {
          // Take the last identifier for dotted decorators
          for (let j = child.namedChildCount - 1; j >= 0; j--) {
            const c = child.namedChild(j);
            if (c && c.type === 'identifier') return c.text;
          }
        }
      }
      return undefined;
    };

    // 1. Direct decorator children of the node (methods, properties)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child?.type !== 'decorator') continue;
      const name = getName(child);
      if (name) mods.push(name);
    }

    // 2. Preceding decorator siblings within the parent (struct-level)
    const parent = node.parent;
    if (parent) {
      const nodeStart = node.startIndex;
      let nodeIdx = -1;
      for (let i = 0; i < parent.namedChildCount; i++) {
        const sibling = parent.namedChild(i);
        if (sibling && sibling.startIndex === nodeStart) {
          nodeIdx = i;
          break;
        }
      }
      if (nodeIdx > 0) {
        const preceding: string[] = [];
        for (let j = nodeIdx - 1; j >= 0; j--) {
          const sibling = parent.namedChild(j);
          if (!sibling) continue;
          if (sibling.type !== 'decorator') break;
          const name = getName(sibling);
          if (name) preceding.unshift(name);
        }
        mods.unshift(...preceding);
      }
    }

    return mods.length > 0 ? mods : undefined;
  },
  extractImport: (node, source) => {
    // Regular import: source field is directly on import_statement
    let srcNode = node.childForFieldName('source');
    // `import lazy`: source field lives inside lazy_import_statement child
    if (!srcNode) {
      const lazy = node.namedChildren.find(c => c.type === 'lazy_import_statement');
      if (lazy) srcNode = lazy.childForFieldName('source');
    }
    if (srcNode) {
      const moduleName = source.substring(srcNode.startIndex, srcNode.endIndex).replace(/['"]/g, '');
      if (moduleName) {
        return { moduleName, signature: source.substring(node.startIndex, node.endIndex).trim() };
      }
    }
    return null;
  },
};
