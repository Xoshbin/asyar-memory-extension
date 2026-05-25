// ─────────────────────────────────────────────────────────────────────
// view.ts — Memory Tier 2 view entry, loaded by dist/view.html.
// Mirrors sdk-playground/src/view.ts: registers the view-side Extension
// impl so `open` navigates to DefaultView, mounts the Svelte component,
// forwards ⌘K to the host.
// ─────────────────────────────────────────────────────────────────────

import 'asyar-sdk/tokens.css';
import { mount } from 'svelte';
import {
  ExtensionContext,
  extensionBridge,
  registerIconElement,
  type Extension,
  type IExtensionManager,
} from 'asyar-sdk/view';
import manifest from '../manifest.json';
import DefaultView from './views/DefaultView.svelte';

class MemoryViewExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(ctx: ExtensionContext): Promise<void> {
    this.extensionManager = ctx.getService<IExtensionManager>('extensions');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}

  async executeCommand(commandId: string): Promise<unknown> {
    if (commandId === 'open') {
      this.extensionManager?.navigateToView('org.asyar.memory/DefaultView');
      return { type: 'view', viewPath: 'org.asyar.memory/DefaultView' };
    }
    return undefined;
  }

  onUnload = (): void => {};
}

const extensionId =
  window.location.hostname === 'localhost' ||
  window.location.hostname === 'asyar-extension.localhost'
    ? window.location.pathname.split('/').filter(Boolean)[0] ||
      'org.asyar.memory'
    : window.location.hostname || 'org.asyar.memory';

const context = new ExtensionContext();
context.setExtensionId(extensionId);
registerIconElement();

const viewExtension = new MemoryViewExtension();
extensionBridge.registerManifest(
  manifest as Parameters<typeof extensionBridge.registerManifest>[0],
);
extensionBridge.registerExtensionImplementation(extensionId, viewExtension);

window.addEventListener('keydown', (event) => {
  const isCommandK = (event.metaKey || event.ctrlKey) && event.key === 'k';
  if (isCommandK) {
    event.preventDefault();
    window.parent.postMessage(
      {
        type: 'asyar:extension:keydown',
        payload: {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        },
      },
      '*',
    );
  }
});

void (async () => {
  await viewExtension.initialize(context);
  await viewExtension.activate();
})();

const viewName = new URLSearchParams(window.location.search).get('view');
const target = document.getElementById('app');
if (viewName === 'DefaultView' && target) {
  mount(DefaultView, { target, props: { context } });
}
