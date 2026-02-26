import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useAuthStore from '../store/authStore';

const Login = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    const result = await login(formData.email, formData.password);
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
          <div>
            <label className="block text-xs mb-1.5" style={{ color: '#787b86' }}>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-3 rounded-lg border text-sm"
              style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              placeholder="Enter email"
              required
            />
          </div>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: '#787b86' }}>Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-4 py-3 rounded-lg border text-sm"
              style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              placeholder="Enter password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-lg font-semibold text-white"
            style={{ background: '#2962ff' }}
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm" style={{ color: '#787b86' }}>
          New accounts are created by Admin.
        </p>
      </div>
    </div>
  );
};

export default Login;