// frontend/src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import useAuthStore from '../store/authStore';

const Login = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    localStorage.getItem('trade_axis_remember') === 'true'
  );
  const [formData, setFormData] = useState({
    loginId: localStorage.getItem('trade_axis_saved_login_id') || '',
    password: localStorage.getItem('trade_axis_remember') === 'true'
      ? localStorage.getItem('trade_axis_saved_pass') || ''
      : '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.loginId.trim()) {
      return toast.error('Please enter your Login ID');
    }
    if (!formData.password) {
      return toast.error('Please enter your password');
    }

    setIsLoading(true);
    const result = await login(formData.loginId.trim(), formData.password);

    if (rememberMe) {
      localStorage.setItem('trade_axis_remember', 'true');
      localStorage.setItem('trade_axis_saved_login_id', formData.loginId.trim());
      localStorage.setItem('trade_axis_saved_pass', formData.password);
    } else {
      localStorage.removeItem('trade_axis_remember');
      localStorage.removeItem('trade_axis_saved_login_id');
      localStorage.removeItem('trade_axis_saved_pass');
    }

    if (result.success) {
      toast.success('Login successful!');
      navigate('/dashboard');
    } else {
      toast.error(result.message);
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#131722' }}>
      <div className="w-full max-w-sm p-6 rounded-xl border" style={{ background: '#1e222d', borderColor: '#363a45' }}>
        {/* Logo */}
        <div className="text-center mb-6">
          <img
            src="/logo.png"
            alt="Trade Axis"
            className="h-16 w-16 mx-auto mb-3 object-contain"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <h1 className="text-2xl font-bold" style={{ color: '#2962ff' }}>Trade Axis</h1>
          <p className="text-sm mt-1" style={{ color: '#787b86' }}>Indian Markets Trading</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Login ID */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: '#787b86' }}>Login ID</label>
            <input
              type="text"
              value={formData.loginId}
              onChange={(e) => setFormData({ ...formData, loginId: e.target.value.toUpperCase() })}
              className="w-full px-4 py-3 rounded-lg border text-sm font-mono"
              style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              placeholder="TA1000"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            <p className="text-xs mt-1" style={{ color: '#787b86' }}>
              Your unique ID (e.g., TA1000)
            </p>
          </div>

          {/* Password with show/hide */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: '#787b86' }}>Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-3 pr-12 rounded-lg border text-sm"
                style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
                placeholder="Enter password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff size={18} color="#787b86" />
                ) : (
                  <Eye size={18} color="#787b86" />
                )}
              </button>
            </div>
          </div>

          {/* Remember Me */}
          <label className="flex items-center gap-2 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded"
              style={{ accentColor: '#2962ff' }}
            />
            <span className="text-sm" style={{ color: '#787b86' }}>Remember me</span>
          </label>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ background: '#2962ff' }}
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm" style={{ color: '#787b86' }}>
          Don't have a Login ID?<br />
          Contact your administrator.
        </p>
      </div>
    </div>
  );
};

export default Login;