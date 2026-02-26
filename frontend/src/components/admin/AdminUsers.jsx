import { useEffect, useState } from 'react';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

export default function AdminUsers() {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);

  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    role: 'user',
    password: '',
    leverage: 5,
    demoBalance: 100000,
    createDemo: true,
    createLive: true,
  });

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/users?limit=200');
      setUsers(res.data?.data || []);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const createUser = async () => {
    if (!form.email || !form.firstName || !form.lastName) {
      return toast.error('Email, First name, Last name required');
    }

    try {
      const res = await api.post('/admin/users', form);
      const tempPassword = res.data?.data?.tempPassword;
      toast.success('User created');

      // Show password once to admin
      if (tempPassword) {
        window.prompt('Temporary password (copy it now):', tempPassword);
      }

      setForm({
        email: '',
        firstName: '',
        lastName: '',
        phone: '',
        role: 'user',
        password: '',
        leverage: 5,
        demoBalance: 100000,
        createDemo: true,
        createLive: true,
      });

      loadUsers();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Create user failed');
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.patch(`/admin/users/${u.id}/active`, { isActive: !u.is_active });
      toast.success('Updated');
      loadUsers();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Update failed');
    }
  };

  const resetPassword = async (u) => {
    try {
      const res = await api.post(`/admin/users/${u.id}/reset-password`, {});
      const tempPassword = res.data?.data?.tempPassword;
      toast.success('Password reset');
      if (tempPassword) window.prompt('Temporary password (copy it now):', tempPassword);
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.message || 'Reset failed');
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: '#1e222d' }}>
      <div className="p-4 border-b" style={{ borderColor: '#363a45' }}>
        <div className="text-lg font-bold" style={{ color: '#d1d4dc' }}>
          Admin • Users
        </div>
        <div className="text-xs mt-1" style={{ color: '#787b86' }}>
          Create users (no public registration)
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Create user */}
        <div className="p-4 rounded-lg mb-4" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: '#d1d4dc' }}>
            Create User
          </div>

          <div className="grid grid-cols-1 gap-2">
            <input
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="Email"
              className="px-3 py-2 rounded"
              style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.firstName}
                onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
                placeholder="First name"
                className="px-3 py-2 rounded"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
              <input
                value={form.lastName}
                onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
                placeholder="Last name"
                className="px-3 py-2 rounded"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
            </div>

            <input
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              placeholder="Phone (optional)"
              className="px-3 py-2 rounded"
              style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
            />

            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.role}
                onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                className="px-3 py-2 rounded"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>

              <input
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="Password (optional)"
                className="px-3 py-2 rounded"
                style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs" style={{ color: '#787b86' }}>
                <input
                  type="checkbox"
                  checked={form.createDemo}
                  onChange={(e) => setForm((p) => ({ ...p, createDemo: e.target.checked }))}
                />{' '}
                Create Demo
              </label>

              <label className="text-xs" style={{ color: '#787b86' }}>
                <input
                  type="checkbox"
                  checked={form.createLive}
                  onChange={(e) => setForm((p) => ({ ...p, createLive: e.target.checked }))}
                />{' '}
                Create Live
              </label>
            </div>

            <button
              onClick={createUser}
              className="py-2 rounded font-semibold"
              style={{ background: '#2962ff', color: '#fff' }}
            >
              Create User
            </button>
          </div>
        </div>

        {/* Users list */}
        <div className="text-sm font-semibold mb-2" style={{ color: '#d1d4dc' }}>
          Users ({users.length}) {loading ? '(Loading...)' : ''}
        </div>

        {users.map((u) => (
          <div
            key={u.id}
            className="p-3 rounded-lg mb-2"
            style={{ background: '#2a2e39', border: '1px solid #363a45' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div style={{ color: '#d1d4dc', fontWeight: 700 }}>
                  {u.email} <span style={{ color: '#787b86', fontWeight: 500 }}>({u.role})</span>
                </div>
                <div className="text-xs" style={{ color: '#787b86' }}>
                  {u.first_name} {u.last_name} • Active: {u.is_active ? 'Yes' : 'No'}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => toggleActive(u)}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ background: u.is_active ? '#ef535020' : '#26a69a20', color: u.is_active ? '#ef5350' : '#26a69a' }}
                >
                  {u.is_active ? 'Deactivate' : 'Activate'}
                </button>

                <button
                  onClick={() => resetPassword(u)}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
                >
                  Reset Password
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t" style={{ borderColor: '#363a45' }}>
        <button
          onClick={loadUsers}
          className="w-full py-2 rounded"
          style={{ background: '#1e222d', border: '1px solid #363a45', color: '#d1d4dc' }}
        >
          Refresh Users
        </button>
      </div>
    </div>
  );
}