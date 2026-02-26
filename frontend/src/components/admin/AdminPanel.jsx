import { useState } from 'react';
import AdminUsers from './AdminUsers';
import AdminWithdrawals from './AdminWithdrawals';

export default function AdminPanel() {
  const [tab, setTab] = useState('users'); // users | withdrawals

  return (
    <div className="h-full flex flex-col" style={{ background: '#1e222d' }}>
      <div className="flex border-b" style={{ borderColor: '#363a45' }}>
        {[
          { id: 'users', label: 'Users' },
          { id: 'withdrawals', label: 'Withdrawals' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-3 text-sm font-medium border-b-2"
            style={{
              borderColor: tab === t.id ? '#2962ff' : 'transparent',
              color: tab === t.id ? '#d1d4dc' : '#787b86',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'users' && <AdminUsers />}
        {tab === 'withdrawals' && <AdminWithdrawals />}
      </div>
    </div>
  );
}