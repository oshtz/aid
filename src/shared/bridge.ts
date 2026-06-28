import browser from 'webextension-polyfill';

type ChromeSidePanelApi = {
  open?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  setPanelBehavior?: (behavior: { openPanelOnActionClick?: boolean }) => Promise<void>;
};

type FirefoxSidebarActionApi = {
  open?: () => Promise<void>;
};

/**
 * Browser API bridge that abstracts differences between Chrome's sidePanel API
 * and Firefox's sidebarAction API
 */
class BrowserBridgeImpl {
  private getChromeSidePanel(): ChromeSidePanelApi | undefined {
    const chromeApi = globalThis.chrome as Record<string, unknown> | undefined;
    return chromeApi?.['sidePanel'] as ChromeSidePanelApi | undefined;
  }

  private getFirefoxSidebarAction(): FirefoxSidebarActionApi | undefined {
    return (browser as typeof browser & { sidebarAction?: FirefoxSidebarActionApi }).sidebarAction;
  }

  async openSidePanel(tabId?: number): Promise<void> {
    const sidePanel = this.getChromeSidePanel();
    const sidebarAction = this.getFirefoxSidebarAction();

    if (sidePanel?.open) {
      // Chrome/Edge: Use sidePanel API
      if (tabId) {
        await sidePanel.open({ tabId });
      } else {
        const currentWindow = await browser.windows.getCurrent();
        if (currentWindow.id !== undefined) {
          await sidePanel.open({ windowId: currentWindow.id });
        } else {
          throw new Error('Unable to get current window ID');
        }
      }
    } else if (sidebarAction?.open) {
      // Firefox/Zen: Use sidebarAction API
      // Note: sidebarAction.open() must be called in user gesture context
      try {
        await sidebarAction.open();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('user input handler')) {
          throw new Error('sidebarAction.open may only be called from a user input handler');
        }
        throw error;
      }
    } else {
      throw new Error('Side panel API not supported in this browser');
    }
  }

  async setPanelBehavior(behavior: { openPanelOnActionClick?: boolean }): Promise<void> {
    const sidePanel = this.getChromeSidePanel();
    if (sidePanel?.setPanelBehavior) {
      await sidePanel.setPanelBehavior(behavior);
    }
    // Firefox doesn't have equivalent API - behavior is controlled by manifest
  }
}

// Export singleton instance
export const browserBridge = new BrowserBridgeImpl();
