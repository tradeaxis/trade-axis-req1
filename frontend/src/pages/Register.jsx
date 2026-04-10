import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useAuthStore from '../store/authStore';

const Register = () => {
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (!/^[6-9]\d{9}$/.test(formData.phone)) {
      toast.error('Enter valid Indian phone number');
      return;
    }
    setIsLoading(true);
    const result = await register({
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      password: formData.password,
    });
    if (result.success) {
      toast.success('Registration successful!');
      navigate('/dashboard');
    } else {
      toast.error(result.message);
    }
    setIsLoading(false);
  };

  const inputStyle = { background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#131722' }}>
      <div className="w-full max-w-sm p-6 rounded-xl border" style={{ background: '#1e222d', borderColor: '#363a45' }}>
        {/* Logo */}
        <div className="text-center mb-4">
          <img 
            src="/logo.png" 
            alt="Trade Axis" 
            className="h-12 w-12 mx-auto mb-2 object-contain"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <h1 className="text-xl font-bold" style={{ color: '#2962ff' }}>Create Account</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: '#787b86' }}>First Name</label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border text-sm"
                style={inputStyle}
                required
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Last Name</label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border text-sm"
                style={inputStyle}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={inputStyle}
              required
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={inputStyle}
              placeholder="9876543210"
              required
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={inputStyle}
              minLength={8}
              required
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Confirm Password</label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={inputStyle}
              required
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-lg font-semibold text-white mt-2"
            style={{ background: '#2962ff' }}
          >
            {isLoading ? 'Creating...' : 'Register'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm" style={{ color: '#787b86' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#2962ff' }}>Login</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;