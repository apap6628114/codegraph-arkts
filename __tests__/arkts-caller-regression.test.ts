/**
 * Regression test: ArkTS instance method call resolution — realistic scenario
 *
 * Covers the import variable → method resolution bug where
 * `appStore.autoCheckinIfNeeded()` resolved to `appStore` (the imported
 * constant) instead of `AppStore::autoCheckinIfNeeded` (the method).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';

describe('ArkTS import-facing method call resolution', () => {
  let tempDir: string;
  let cg: CodeGraph;

  async function setupProject(files: Record<string, string>) {
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(tempDir, filePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    cg = await CodeGraph.init(tempDir);
    await cg.indexAll();
  }

  afterEach(() => {
    if (cg) cg.destroy();
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-arkts-import-'));
  });

  // ---- Test 1: imported constant → method (the original bug) ----
  it('resolves obj.method() to struct method when obj is imported', async () => {
    await setupProject({
      'AppStore.ets': `
@Component
export struct AppStore {
  autoCheckinIfNeeded(): void {
    console.log('checkin');
  }

  build() {
    Column() {}
  }
}
`,
      'StoreProvider.ets': `
import { AppStore } from './AppStore';

export const appStore: AppStore = new AppStore();
`,
      'EntryAbility.ets': `
import { appStore } from './StoreProvider';

function handleCheckin(): void {
  appStore.autoCheckinIfNeeded();
}
`,
    });

    const methods = cg.searchNodes('autoCheckinIfNeeded', { kinds: ['method'] });
    const method = methods.find((m) => m.node.filePath.endsWith('AppStore.ets'));
    expect(method).toBeDefined();

    const callers = cg.getCallers(method!.node.id, 1);
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.some((c) => c.node.name === 'handleCheckin')).toBe(true);
  });

  // ---- Test 2: two structs with same-named method — disambiguation ----
  it('disambiguates obj.method() between two structs with same-named method', async () => {
    await setupProject({
      'AppStore.ets': `
@Component
export struct AppStore {
  autoCheckinIfNeeded(): void { console.log('app'); }
  build() { Column() {} }
}
`,
      'SettingsStore.ets': `
@Component
export struct SettingsStore {
  autoCheckinIfNeeded(): void { console.log('settings'); }
  build() { Column() {} }
}
`,
      'EntryAbility.ets': `
import { AppStore } from './AppStore';
let appStore = new AppStore();
function handleApp() { appStore.autoCheckinIfNeeded(); }
`,
      'MainPage.ets': `
import { SettingsStore } from './SettingsStore';
let settingsStore = new SettingsStore();
function handleSettings() { settingsStore.autoCheckinIfNeeded(); }
`,
    });

    const appMethods = cg.searchNodes('autoCheckinIfNeeded', { kinds: ['method'] });
    const appMethod = appMethods.find((m) => m.node.qualifiedName.includes('AppStore'));
    expect(appMethod).toBeDefined();
    const settingsMethod = appMethods.find((m) => m.node.qualifiedName.includes('SettingsStore'));
    expect(settingsMethod).toBeDefined();

    const appCallers = cg.getCallers(appMethod!.node.id, 1);
    expect(appCallers.some((c) => c.node.name === 'handleApp')).toBe(true);

    const settingsCallers = cg.getCallers(settingsMethod!.node.id, 1);
    expect(settingsCallers.some((c) => c.node.name === 'handleSettings')).toBe(true);
  });

  // ---- Test 3: self-call (this.method) — already worked, keep as regression ----
  it('resolves this.method() within a struct', async () => {
    await setupProject({
      'AppStore.ets': `
@Component
export struct AppStore {
  autoCheckinIfNeeded(): void { console.log('checkin'); }
  aboutToAppear() { this.autoCheckinIfNeeded(); }
  build() { Column() {} }
}
`,
    });

    const methods = cg.searchNodes('autoCheckinIfNeeded', { kinds: ['method'] });
    const method = methods.find((m) => m.node.filePath.endsWith('AppStore.ets'));
    expect(method).toBeDefined();

    const callers = cg.getCallers(method!.node.id, 1);
    expect(callers.some((c) => c.node.name === 'aboutToAppear')).toBe(true);
  });

  // ---- Test 4: namespace import should still work ----
  it('resolves ns.method() via namespace import', async () => {
    await setupProject({
      'mathUtils.ets': `
export function add(a: number, b: number): number {
  return a + b;
}
`,
      'EntryAbility.ets': `
import * as MathUtils from './mathUtils';

function compute(): void {
  MathUtils.add(1, 2);
}
`,
    });

    const funcs = cg.searchNodes('add', { kinds: ['function'] });
    const addFunc = funcs.find((f) => f.node.filePath.endsWith('mathUtils.ets'));
    expect(addFunc).toBeDefined();

    const callers = cg.getCallers(addFunc!.node.id, 1);
    expect(callers.some((c) => c.node.name === 'compute')).toBe(true);
  });
});
