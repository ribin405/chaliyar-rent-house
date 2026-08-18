import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { Modal } from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import type { ShopSettings, User } from '../types';

const EMPTY_SHOP: ShopSettings = {
  shop_name: '', shop_address: '', shop_phone: '', shop_email: '', invoice_prefix: 'INV', currency_symbol: '₹',
};

const EMPTY_USER_FORM = { username: '', password: '', full_name: '', role: 'staff' as User['role'] };

export function Settings() {
  const { user: currentUser } = useAuth();
  const [shop, setShop] = useState<ShopSettings>(EMPTY_SHOP);
  const [shopSaving, setShopSaving] = useState(false);
  const [shopMessage, setShopMessage] = useState('');
  const [shopError, setShopError] = useState('');

  const [users, setUsers] = useState<User[]>([]);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userForm, setUserForm] = useState(EMPTY_USER_FORM);
  const [userError, setUserError] = useState('');
  const [userSaving, setUserSaving] = useState(false);

  const loadShop = () => {
    apiRequest<ShopSettings>('/settings')
      .then((data) => setShop({ ...EMPTY_SHOP, ...data, shop_email: data.shop_email ?? '' }))
      .catch(() => {});
  };
  const loadUsers = () => {
    apiRequest<User[]>('/users').then(setUsers).catch(() => {});
  };

  useEffect(() => {
    loadShop();
    loadUsers();
  }, []);

  const handleShopSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setShopSaving(true);
    setShopError('');
    setShopMessage('');
    try {
      await apiRequest('/settings', { method: 'PUT', body: JSON.stringify(shop) });
      setShopMessage('Shop settings updated.');
    } catch (err) {
      setShopError(err instanceof Error ? err.message : 'Failed to update settings.');
    } finally {
      setShopSaving(false);
    }
  };

  const openUserCreate = () => {
    setUserForm(EMPTY_USER_FORM);
    setUserError('');
    setUserModalOpen(true);
  };

  const handleUserSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!userForm.username.trim() || userForm.password.length < 6 || !userForm.full_name.trim()) {
      setUserError('Username, full name, and a password of at least 6 characters are required.');
      return;
    }
    setUserSaving(true);
    setUserError('');
    try {
      await apiRequest('/users', { method: 'POST', body: JSON.stringify(userForm) });
      setUserModalOpen(false);
      loadUsers();
    } catch (err) {
      setUserError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setUserSaving(false);
    }
  };

  const toggleUserActive = async (targetUser: User) => {
    try {
      if (targetUser.is_active) {
        await apiRequest(`/users/${targetUser.id}`, { method: 'DELETE' });
      } else {
        await apiRequest(`/users/${targetUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({ full_name: targetUser.full_name, role: targetUser.role, is_active: true }),
        });
      }
      loadUsers();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to update user.');
    }
  };

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Shop information and staff access</h2>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-title-row"><h3>Shop Information</h3></div>
        <form className="form-grid" onSubmit={handleShopSubmit}>
          <label>
            <span>Shop Name</span>
            <input value={shop.shop_name} onChange={(event) => setShop({ ...shop, shop_name: event.target.value })} required />
          </label>
          <label>
            <span>Shop Phone</span>
            <input value={shop.shop_phone} onChange={(event) => setShop({ ...shop, shop_phone: event.target.value })} required />
          </label>
          <label>
            <span>Shop Address</span>
            <input value={shop.shop_address} onChange={(event) => setShop({ ...shop, shop_address: event.target.value })} required />
          </label>
          <label className="half">
            <span>Shop Email</span>
            <input type="email" value={shop.shop_email ?? ''} onChange={(event) => setShop({ ...shop, shop_email: event.target.value })} />
          </label>
          <label className="half">
            <span>Invoice Prefix</span>
            <input value={shop.invoice_prefix} onChange={(event) => setShop({ ...shop, invoice_prefix: event.target.value })} />
          </label>
          <label className="half">
            <span>Currency Symbol</span>
            <input value={shop.currency_symbol} onChange={(event) => setShop({ ...shop, currency_symbol: event.target.value })} />
          </label>
          <div className="modal-actions">
            {shopError && <p className="form-error">{shopError}</p>}
            {shopMessage && <p className="login-message">{shopMessage}</p>}
            <button type="submit" className="primary-button" disabled={shopSaving}>{shopSaving ? 'Saving…' : 'Save Settings'}</button>
          </div>
        </form>
      </div>

      <div className="panel-card">
        <div className="panel-title-row">
          <h3>Staff Accounts</h3>
          <button type="button" className="primary-button" onClick={openUserCreate}>Add User</button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.full_name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{user.role}</td>
                  <td><span className={`status-badge ${user.is_active ? 'available' : 'maintenance'}`}>{user.is_active ? 'active' : 'inactive'}</span></td>
                  <td>
                    {user.id !== currentUser?.id && (
                      <button type="button" className="text-button" onClick={() => toggleUserActive(user)}>
                        {user.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={userModalOpen} title="Add Staff User" onClose={() => setUserModalOpen(false)}>
        <form className="form-grid" onSubmit={handleUserSubmit}>
          <label>
            <span>Username</span>
            <input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} required />
          </label>
          <label>
            <span>Full Name</span>
            <input value={userForm.full_name} onChange={(event) => setUserForm({ ...userForm, full_name: event.target.value })} required />
          </label>
          <label className="half">
            <span>Password</span>
            <input type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required />
          </label>
          <label className="half">
            <span>Role</span>
            <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as User['role'] })}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <div className="modal-actions">
            {userError && <p className="form-error">{userError}</p>}
            <button type="submit" className="primary-button" disabled={userSaving}>{userSaving ? 'Saving…' : 'Create User'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
