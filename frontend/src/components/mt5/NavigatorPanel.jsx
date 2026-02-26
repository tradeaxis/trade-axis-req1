import PanelHeader from './PanelHeader';

export default function NavigatorPanel({ accounts, selectedAccount, onSelectAccount }) {
  return (
    <div className="h-full w-full flex flex-col">
      <PanelHeader title="Navigator" />
      <div className="flex-1 overflow-auto p-2 text-xs">
        <div className="mt5-muted mb-2">Accounts</div>
        {(accounts || []).map((a) => {
          const active = a.id === selectedAccount?.id;
          return (
            <div
              key={a.id}
              onClick={() => onSelectAccount(a)}
              className="px-2 py-2 rounded cursor-pointer"
              style={{
                background: active ? '#2a3150' : 'transparent',
                border: '1px solid transparent',
              }}
            >
              <div className="font-semibold">
                {a.account_number} {a.is_demo ? '(Demo)' : '(Live)'}
              </div>
              <div className="mt5-muted">
                Bal ₹{parseFloat(a.balance || 0).toFixed(2)} • Lev 1:{a.leverage}
              </div>
            </div>
          );
        })}

        <div className="mt5-muted mt-4 mb-2">Expert Advisors</div>
        <div className="mt5-muted">Coming soon…</div>

        <div className="mt5-muted mt-4 mb-2">Indicators</div>
        <div className="mt5-muted">Coming soon…</div>
      </div>
    </div>
  );
}