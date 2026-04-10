import * as RRP from 'react-resizable-panels';

/**
 * Some builds expose named exports, some expose them as properties on the module.
 * This makes it work in both cases.
 */
const PanelGroup = RRP.PanelGroup || RRP.ResizablePanelGroup;
const Panel = RRP.Panel || RRP.ResizablePanel;
const PanelResizeHandle = RRP.PanelResizeHandle || RRP.ResizeHandle;

export default function DesktopTerminal({ leftTop, leftBottom, centerTop, centerBottom, right }) {
  if (!PanelGroup || !Panel || !PanelResizeHandle) {
    return (
      <div className="p-4 mt5-muted">
        Resizable layout library export mismatch. Please run:
        <pre style={{ marginTop: 8, color: 'var(--mt5-text)' }}>
          npm i react-resizable-panels@latest
        </pre>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <PanelGroup direction="horizontal" className="flex-1">
        {/* LEFT */}
        <Panel defaultSize={22} minSize={16} className="mt5-panel border-r mt5-border">
          <PanelGroup direction="vertical" className="h-full">
            <Panel defaultSize={55} minSize={25} className="border-b mt5-border">
              {leftTop}
            </Panel>

            <PanelResizeHandle className="h-1 bg-transparent hover:bg-[var(--mt5-border)]" />

            <Panel defaultSize={45} minSize={20}>
              {leftBottom}
            </Panel>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="w-1 bg-transparent hover:bg-[var(--mt5-border)]" />

        {/* CENTER */}
        <Panel defaultSize={58} minSize={30} className="flex flex-col">
          <PanelGroup direction="vertical" className="h-full">
            <Panel defaultSize={72} minSize={30} className="border-b mt5-border">
              {centerTop}
            </Panel>

            <PanelResizeHandle className="h-1 bg-transparent hover:bg-[var(--mt5-border)]" />

            <Panel defaultSize={28} minSize={18} className="mt5-panel">
              {centerBottom}
            </Panel>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="w-1 bg-transparent hover:bg-[var(--mt5-border)]" />

        {/* RIGHT */}
        <Panel defaultSize={20} minSize={16} className="mt5-panel border-l mt5-border">
          {right}
        </Panel>
      </PanelGroup>
    </div>
  );
}