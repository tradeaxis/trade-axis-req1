export default function PanelHeader({ title, right }) {
  return (
    <div className="h-9 px-3 flex items-center justify-between border-b mt5-border mt5-panel2">
      <div className="font-semibold">{title}</div>
      <div>{right}</div>
    </div>
  );
}