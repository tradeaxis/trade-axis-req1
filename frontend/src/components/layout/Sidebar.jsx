// frontend/src/components/layout/Sidebar.jsx
import { 
  LayoutDashboard, 
  LineChart, 
  Wallet, 
  History, 
  Settings, 
  HelpCircle,
  TrendingUp,
  List
} from 'lucide-react';

const Sidebar = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'trade', icon: LineChart, label: 'Trade' },
    { id: 'markets', icon: TrendingUp, label: 'Markets' },
    { id: 'positions', icon: List, label: 'Positions' },
    { id: 'history', icon: History, label: 'History' },
    { id: 'wallet', icon: Wallet, label: 'Wallet' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="w-20 lg:w-64 bg-dark-300 border-r border-gray-800 flex flex-col h-screen fixed left-0 top-0">
      {/* ✅ Logo - Clean display for transparent PNG */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          {/* Logo image */}
          <div className="shrink-0">
            <img 
              src="/logo.png" 
              alt="Trade Axis" 
              className="h-12 w-12 lg:h-14 lg:w-14 object-contain"
              onError={(e) => {
                // Fallback to text logo
                e.target.parentElement.innerHTML = `
                  <div class="h-12 w-12 lg:h-14 lg:w-14 rounded-xl flex items-center justify-center" style="background: linear-gradient(135deg, #26a69a 0%, #2962ff 100%)">
                    <span class="text-xl lg:text-2xl font-bold text-white">TA</span>
                  </div>
                `;
              }}
            />
          </div>
          
          {/* App name - desktop only */}
          <div className="hidden lg:block">
            <div className="flex items-center">
              <span className="text-2xl font-bold" style={{ color: '#26a69a' }}>Trade</span>
              <span className="text-2xl font-bold" style={{ color: '#2962ff' }}>Axis</span>
            </div>
            <p className="text-xs -mt-0.5" style={{ color: '#787b86' }}>Indian Markets</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 p-3">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl mb-2 transition ${
              activeTab === item.id
                ? 'bg-green-600 text-white'
                : 'text-gray-400 hover:bg-dark-200 hover:text-white'
            }`}
          >
            <item.icon size={22} />
            <span className="hidden lg:block text-base font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Help */}
      <div className="p-3 border-t border-gray-800">
        <button className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-gray-400 hover:bg-dark-200 hover:text-white transition">
          <HelpCircle size={22} />
          <span className="hidden lg:block text-base font-medium">Help</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;