// frontend/src/components/layout/Header.jsx
import { Bell, User, LogOut, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import useAuthStore from '../../store/authStore';

const Header = ({ selectedAccount, accounts, onAccountChange }) => {
  const { user, logout } = useAuthStore();
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <header className="h-16 bg-dark-300 border-b border-gray-800 flex items-center justify-between px-4 fixed top-0 left-20 lg:left-64 right-0 z-50">
      {/* Left side - Logo for mobile, Account for desktop */}
      <div className="flex items-center gap-4">
        {/* Mobile Logo */}
        <div className="flex items-center gap-2 lg:hidden">
          <img 
            src="/logo.png" 
            alt="TA" 
            className="h-8 w-8 object-contain"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <span className="font-bold text-lg">
            <span style={{ color: '#26a69a' }}>Trade</span>
            <span style={{ color: '#2962ff' }}>Axis</span>
          </span>
        </div>

        {/* Account Selector */}
        <select
          value={selectedAccount?.id || ''}
          onChange={(e) => {
            const acc = accounts.find(a => a.id === e.target.value);
            onAccountChange(acc);
          }}
          className="hidden sm:block px-4 py-2.5 bg-dark-200 border border-gray-700 rounded-lg text-white text-base focus:outline-none focus:border-green-500"
        >
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.account_number} • {acc.is_demo ? 'Demo' : 'Live'} • ₹{parseFloat(acc.balance).toLocaleString('en-IN')}
            </option>
          ))}
        </select>

        {/* Connection Status */}
        <div className="hidden md:flex items-center gap-2 text-base">
          <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></span>
          <span className="text-gray-400">Connected</span>
        </div>
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button className="p-2.5 text-gray-400 hover:text-white hover:bg-dark-200 rounded-lg transition">
          <Bell size={22} />
        </button>

        {/* User Menu */}
        <div className="relative">
          <button 
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-dark-200 rounded-lg transition"
          >
            <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-base font-bold">{user?.firstName?.[0]}{user?.lastName?.[0]}</span>
            </div>
            <span className="hidden md:block text-base font-medium">{user?.firstName}</span>
            <ChevronDown size={18} className="text-gray-400" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-2 w-56 bg-dark-200 border border-gray-700 rounded-lg shadow-xl z-50">
              <div className="p-4 border-b border-gray-700">
                <p className="font-semibold text-base">{user?.firstName} {user?.lastName}</p>
                <p className="text-sm text-gray-400 mt-1">{user?.email}</p>
              </div>
              <button
                onClick={logout}
                className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-dark-300 transition text-base"
              >
                <LogOut size={20} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;