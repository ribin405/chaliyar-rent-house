import './style.css';

type Route = 'login' | 'dashboard' | 'customers' | 'equipment' | 'rentals' | 'payments' | 'reports' | 'settings';

type CustomerStatus = 'Active' | 'Blocked';
type EquipmentStatus = 'Available' | 'Reserved' | 'Rented' | 'Maintenance';

type EquipmentCategory = 'Generator' | 'Drill' | 'Welding' | 'Compressor' | 'Mixer' | 'Other';

interface Customer {
  id: number;
  fullName: string;
  phoneNumber: string;
  alternatePhone: string;
  address: string;
  registrationDate: string;
  status: CustomerStatus;
  notes: string;
}

interface Equipment {
  id: number;
  name: string;
  category: EquipmentCategory;
  dailyRent: number;
  securityDeposit: number;
  status: EquipmentStatus;
  location: string;
  notes: string;
}

interface RentalSummary {
  id: number;
  customerName: string;
  equipmentName: string;
  rentalDate: string;
  expectedReturnDate: string;
  status: 'Active' | 'Completed' | 'Overdue' | 'Cancelled';
  amount: number;
}

let currentRoute: Route = 'login';
let authenticated = false;
let searchQuery = '';
let customerFilter = 'All';
let equipmentFilter = 'All';
let editingCustomerId: number | null = null;
let editingEquipmentId: number | null = null;
let equipmentFormError = '';
let customers: Customer[] = [];
let equipment: Equipment[] = [];
let rentals: RentalSummary[] = [];
let mobileNavOpen = false;
let rentalModalOpen = false;
let editingRentalId: number | null = null;
let authToken: string | null = null;

const API_BASE_URL = 'http://localhost:5000/api';
const AUTH_STORAGE_KEY = 'rentalERP.auth';
const TOKEN_STORAGE_KEY = 'rentalERP.authToken';
const STORAGE_KEY = 'rentalERP.localData';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
};

const normalizeCustomerStatus = (status: string): CustomerStatus => {
  if (status === 'blocked' || status === 'Blocked') {
    return 'Blocked';
  }
  return 'Active';
};

const normalizeEquipmentStatus = (status: string): EquipmentStatus => {
  switch (status.toLowerCase()) {
    case 'available':
      return 'Available';
    case 'reserved':
      return 'Reserved';
    case 'rented':
      return 'Rented';
    case 'maintenance':
      return 'Maintenance';
    default:
      return 'Available';
  }
};

const normalizeRentalStatus = (status: string): RentalSummary['status'] => {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'Completed';
    case 'overdue':
      return 'Overdue';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Active';
  }
};

const mapCustomerFromApi = (item: any): Customer => ({
  id: Number(item.id),
  fullName: item.full_name ?? item.fullName ?? '',
  phoneNumber: item.phone_number ?? item.phoneNumber ?? '',
  alternatePhone: item.alternate_phone ?? item.alternatePhone ?? '',
  address: item.address ?? '',
  registrationDate: item.registration_date ?? item.registrationDate ?? '',
  status: normalizeCustomerStatus(item.status ?? 'active'),
  notes: item.notes ?? '',
});

const mapEquipmentFromApi = (item: any): Equipment => ({
  id: Number(item.id),
  name: item.name ?? '',
  category: (item.category_name ?? item.category ?? 'Other') as EquipmentCategory,
  dailyRent: Number(item.daily_rent ?? item.dailyRent ?? 0),
  securityDeposit: Number(item.security_deposit ?? item.securityDeposit ?? 0),
  status: normalizeEquipmentStatus(item.status ?? 'available'),
  location: item.location ?? '',
  notes: item.notes ?? '',
});

const mapRentalFromApi = (item: any): RentalSummary => ({
  id: Number(item.id),
  customerName: item.customer_name ?? item.customerName ?? 'Unknown',
  equipmentName: item.equipment_name ?? item.equipmentName ?? 'Unknown',
  rentalDate: item.rental_date ?? item.rentalDate ?? '',
  expectedReturnDate: item.expected_return_date ?? item.expectedReturnDate ?? '',
  status: normalizeRentalStatus(item.status ?? 'active'),
  amount: Number(item.amount ?? item.final_amount ?? 0),
});

const apiRequest = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      throw new Error(payload.message || 'Request failed');
    }

    return payload as T;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Unable to reach the server. Please verify the backend is running on port 5000.');
    }
    throw error;
  }
};

const formatDateTimeInput = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const loadLocalData = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    customers = [];
    equipment = [];
    rentals = [];
    return;
  }

  const parsed = JSON.parse(stored);
  customers = parsed.customers || [];
  equipment = parsed.equipment || [];
  rentals = parsed.rentals || [];
};

const saveLocalData = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ customers, equipment, rentals }));
};

const loadRemoteData = async () => {
  if (!authToken) {
    return;
  }

  try {
    const customerPayload = await apiRequest<ApiResponse<any[]>>('/customers');
    customers = (customerPayload.data || []).map(mapCustomerFromApi);

    const equipmentPayload = await apiRequest<ApiResponse<any[]>>('/equipment');
    equipment = (equipmentPayload.data || []).map(mapEquipmentFromApi);

    const rentalPayload = await apiRequest<ApiResponse<any[]>>('/rentals');
    rentals = (rentalPayload.data || []).map(mapRentalFromApi);

    saveLocalData();
  } catch (error) {
    console.error('Failed to load remote data', error);
  }
};

const initApp = async () => {
  const storedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
  const remembered = localStorage.getItem('rentalERP.remember');
  authToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (storedAuth === 'true' || remembered === 'true' || authToken) {
    authenticated = true;
    currentRoute = 'dashboard';
  }

  loadLocalData();
  if (authToken) {
    await loadRemoteData();
  }

  const hash = window.location.hash.replace('#', '') || 'dashboard';
  currentRoute = (hash as Route) || 'dashboard';
  render();

  window.addEventListener('hashchange', () => {
    const nextHash = window.location.hash.replace('#', '') || 'dashboard';
    currentRoute = (nextHash as Route) || 'dashboard';
    render();
  });
};

const render = () => {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) {
    return;
  }

  if (!authenticated) {
    app.innerHTML = renderLogin();
    bindLoginEvents();
    return;
  }

  app.innerHTML = renderShell();
  bindShellEvents();

  if (currentRoute === 'dashboard') {
    renderDashboard();
  } else if (currentRoute === 'customers') {
    renderCustomers();
  } else if (currentRoute === 'equipment') {
    renderEquipment();
  } else if (currentRoute === 'rentals') {
    renderRentals();
  } else if (currentRoute === 'payments') {
    renderPlaceholder('Payments', 'Payment collection and deposit refund controls will be added here.');
  } else if (currentRoute === 'reports') {
    renderPlaceholder('Reports', 'Revenue and operational reporting modules will be added here.');
  } else if (currentRoute === 'settings') {
    renderPlaceholder('Settings', 'Shop information, user access, and category management will be added here.');
  }
};

const bindShellEvents = () => {
  const appRoot = document.querySelector<HTMLElement>('#app');

  appRoot?.addEventListener('click', (event) => {
    const targetButton = (event.target as HTMLElement).closest<HTMLElement>('[data-nav]');
    if (targetButton) {
      event.preventDefault();
      const target = targetButton.dataset.nav as Route;
      currentRoute = target;
      mobileNavOpen = false;
      window.location.hash = `#${target}`;
      render();
      return;
    }

    const logoutButton = (event.target as HTMLElement).closest<HTMLElement>('[data-action="logout"]');
    if (logoutButton) {
      event.preventDefault();
      authenticated = false;
      authToken = null;
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem('rentalERP.remember');
      currentRoute = 'login';
      mobileNavOpen = false;
      window.location.hash = '#login';
      render();
      return;
    }

    const rentalCreateButton = (event.target as HTMLElement).closest<HTMLElement>('[data-action="open-rental-create"]');
    if (rentalCreateButton) {
      event.preventDefault();
      currentRoute = 'rentals';
      editingRentalId = null;
      rentalModalOpen = true;
      window.location.hash = '#rentals';
      render();
      return;
    }

    const editRentalButton = (event.target as HTMLElement).closest<HTMLElement>('[data-action="edit-rental"]');
    if (editRentalButton) {
      event.preventDefault();
      editingRentalId = Number(editRentalButton.dataset.id);
      currentRoute = 'rentals';
      rentalModalOpen = true;
      window.location.hash = '#rentals';
      render();
      return;
    }

    const deleteRentalButton = (event.target as HTMLElement).closest<HTMLElement>('[data-action="delete-rental"]');
    if (deleteRentalButton) {
      event.preventDefault();
      const id = Number(deleteRentalButton.dataset.id);
      const rental = rentals.find((item) => item.id === id);
      if (rental && window.confirm(`Delete rental for ${rental.customerName}?`)) {
        const index = rentals.findIndex((item) => item.id === id);
        if (index >= 0) {
          rentals.splice(index, 1);
          saveLocalData();
          render();
        }
      }
      return;
    }

    const toggleButton = (event.target as HTMLElement).closest<HTMLElement>('[data-action="toggle-mobile-nav"]');
    if (toggleButton) {
      event.preventDefault();
      mobileNavOpen = !mobileNavOpen;
      render();
      return;
    }

    const overlay = (event.target as HTMLElement).closest<HTMLElement>('#mobileNavOverlay');
    if (overlay) {
      event.preventDefault();
      mobileNavOpen = false;
      render();
    }
  });
};

const bindLoginEvents = () => {
  const form = document.querySelector<HTMLFormElement>('#loginForm');
  const usernameInput = document.querySelector<HTMLInputElement>('#username');
  const passwordInput = document.querySelector<HTMLInputElement>('#password');
  const rememberInput = document.querySelector<HTMLInputElement>('#remember');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = usernameInput?.value.trim() || '';
    const password = passwordInput?.value.trim() || '';

    try {
      const payload = await apiRequest<ApiResponse<{ token: string; user: { username: string; full_name: string; role: string } }> & { token?: string; user?: { username: string; full_name: string; role: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      const token = payload.data?.token ?? payload.token;
      if (token) {
        authenticated = true;
        authToken = token;
        currentRoute = 'dashboard';
        if (rememberInput?.checked) {
          localStorage.setItem('rentalERP.remember', 'true');
        } else {
          localStorage.removeItem('rentalERP.remember');
        }
        localStorage.setItem(AUTH_STORAGE_KEY, 'true');
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
        await loadRemoteData();
        window.location.hash = '#dashboard';
        render();
      }
    } catch (error) {
      const message = document.querySelector<HTMLElement>('#loginMessage');
      if (message) {
        message.textContent = error instanceof Error ? error.message : 'Login failed.';
      }
    }
  });
};

const renderLogin = () => {
  return `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark">⚡</div>
          <div>
            <p class="eyebrow">Admin Access</p>
            <h1>Electrical Equipment Rental Management</h1>
          </div>
        </div>
        <form id="loginForm" class="auth-form">
          <label>
            <span>Username</span>
            <input id="username" name="username" type="text" placeholder="admin" required />
          </label>
          <label>
            <span>Password</span>
            <input id="password" name="password" type="password" placeholder="admin123" required />
          </label>
          <label class="checkbox-row">
            <input id="remember" type="checkbox" />
            <span>Remember me</span>
          </label>
          <button type="submit">Sign In</button>
          <p id="loginMessage" class="login-message">Secure staff access only.</p>
        </form>
      </div>
    </div>
  `;
};

const renderShell = () => {
  const navItems = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'rentals', label: 'Rentals' },
  ];

  return `
    <div class="mobile-nav-overlay ${mobileNavOpen ? 'active' : ''}" id="mobileNavOverlay"></div>
    <div class="app-shell">
      <aside class="sidebar ${mobileNavOpen ? 'mobile-open' : ''}">
        <div class="sidebar-head">
          <div class="brand-mark">⚡</div>
          <div>
            <p class="eyebrow">Rental ERP</p>
            <h2>PowerOps</h2>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${navItems.map((item) => `
            <button class="nav-item ${item.key === currentRoute ? 'active' : ''}" data-nav="${item.key}">
              ${item.label}
            </button>
          `).join('')}
        </nav>
        <div class="sidebar-footer">
          <p>Secure internal access</p>
          <button class="ghost-button" data-action="logout">Logout</button>
        </div>
      </aside>
      <main class="main-panel">
        <header class="topbar">
          <div class="topbar-title-wrap">
            <button class="mobile-nav-toggle" type="button" data-action="toggle-mobile-nav" aria-label="Toggle navigation">☰</button>
            <div>
              <p class="eyebrow">Operations Center</p>
              <h1>${formatTitle(currentRoute)}</h1>
            </div>
          </div>
          <div class="topbar-actions">
            <div class="search-pill">🔎 Search everything</div>
            <div class="user-chip">Admin • Owner</div>
          </div>
        </header>
        <section id="contentArea" class="content-area"></section>
      </main>
    </div>
  `;
};

const renderDashboard = () => {
  const contentArea = document.querySelector<HTMLElement>('#contentArea');
  if (!contentArea) {
    return;
  }

  const metrics = [
    { label: 'Total Customers', value: customers.length, tone: 'blue' },
    { label: 'Available Equipment', value: equipment.filter((item) => item.status === 'Available').length, tone: 'green' },
    { label: 'Active Rentals', value: rentals.filter((item) => item.status === 'Active').length, tone: 'amber' },
    { label: 'Overdue Rentals', value: rentals.filter((item) => item.status === 'Overdue').length, tone: 'red' },
  ];

  const recentPayments = [
    { label: 'Latest rental batch', amount: `₹ ${rentals.reduce((total, item) => total + item.amount, 0).toLocaleString()}`, status: 'Live' },
  ];

  contentArea.innerHTML = `
    <div class="dashboard-grid">
      <div class="card-grid">
        ${metrics.map((metric) => `
          <article class="stat-card ${metric.tone}">
            <p>${metric.label}</p>
            <h3>${metric.value}</h3>
          </article>
        `).join('')}
      </div>

      <article class="panel-card wide-card">
        <div class="panel-title-row">
          <h3>Revenue Outlook</h3>
          <span class="pill">Updated live</span>
        </div>
        <div class="bar-chart">
          ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((month, index) => `
            <div class="bar-item">
              <div class="bar" style="height:${50 + index * 10}px"></div>
              <span>${month}</span>
            </div>
          `).join('')}
        </div>
      </article>

      <article class="panel-card">
        <div class="panel-title-row">
          <h3>Quick Actions</h3>
        </div>
        <div class="actions-stack">
          <button class="primary-button" data-action="open-rental-create">Create Rental</button>
          <p class="login-message">This single form records the customer, equipment, and rental timing automatically.</p>
        </div>
      </article>

      <article class="panel-card">
        <div class="panel-title-row">
          <h3>Recent Rentals</h3>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>Customer</th><th>Equipment</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${rentals.map((rental) => `
              <tr>
                <td>${escapeHtml(rental.customerName)}</td>
                <td>${escapeHtml(rental.equipmentName)}</td>
                <td>${escapeHtml(rental.status)}</td>
                <td>
                  <button class="text-button" data-action="edit-rental" data-id="${rental.id}">Edit</button>
                  <button class="text-button danger" data-action="delete-rental" data-id="${rental.id}">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </article>

      <article class="panel-card">
        <div class="panel-title-row">
          <h3>Recent Payments</h3>
        </div>
        <ul class="list-stack">
          ${recentPayments.map((payment) => `
            <li>
              <span>${escapeHtml(payment.label)}</span>
              <strong>${escapeHtml(payment.amount)}</strong>
              <small>${escapeHtml(payment.status)}</small>
            </li>
          `).join('')}
        </ul>
      </article>
    </div>
  `;
};

const renderCustomers = () => {
  const contentArea = document.querySelector<HTMLElement>('#contentArea');
  if (!contentArea) {
    return;
  }

  const filteredCustomers = customers.filter((customer) => {
    const matchesSearch = `${customer.id} ${customer.fullName} ${customer.phoneNumber}`.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = customerFilter === 'All' || customer.status === customerFilter;
    return matchesSearch && matchesStatus;
  });

  contentArea.innerHTML = `
    <div class="module-shell">
      <div class="module-head">
        <div>
          <p class="eyebrow">Customer Directory</p>
          <h2>Manage customer records</h2>
        </div>
        <p class="eyebrow">Create a rental to add customer details automatically</p>
      </div>

      <div class="toolbar">
        <input id="customerSearch" type="text" placeholder="Search by name, phone or ID" value="${escapeHtml(searchQuery)}" />
        <select id="customerFilter">
          <option value="All" ${customerFilter === 'All' ? 'selected' : ''}>All Status</option>
          <option value="Active" ${customerFilter === 'Active' ? 'selected' : ''}>Active</option>
          <option value="Blocked" ${customerFilter === 'Blocked' ? 'selected' : ''}>Blocked</option>
        </select>
      </div>

      <div class="panel-card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Customer ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Registration</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredCustomers.map((customer) => `
                <tr>
                  <td>${customer.id}</td>
                  <td>${escapeHtml(customer.fullName)}</td>
                  <td>${escapeHtml(customer.phoneNumber)}</td>
                  <td>${escapeHtml(customer.status)}</td>
                  <td>${escapeHtml(customer.registrationDate)}</td>
                  <td>
                    <button class="text-button" data-action="edit-customer" data-id="${customer.id}">Edit</button>
                    <button class="text-button danger" data-action="delete-customer" data-id="${customer.id}">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ${renderCustomerModal()}
  `;

  bindCustomerEvents();
};

const renderCustomerModal = () => {
  const editingCustomer = customers.find((customer) => customer.id === editingCustomerId) || null;
  const title = editingCustomer ? 'Edit Customer' : 'Add Customer';

  return `
    <div class="modal-backdrop ${editingCustomerId !== null ? 'open' : ''}">
      <div class="modal-card">
        <div class="panel-title-row">
          <h3>${title}</h3>
          <button class="text-button" id="closeCustomerModal">Close</button>
        </div>
        <form id="customerForm" class="form-grid">
          <input type="hidden" name="customerId" value="${editingCustomer?.id ?? ''}" />
          <label>
            <span>Full Name</span>
            <input name="fullName" value="${escapeHtml(editingCustomer?.fullName ?? '')}" required />
          </label>
          <label>
            <span>Phone Number</span>
            <input name="phoneNumber" value="${escapeHtml(editingCustomer?.phoneNumber ?? '')}" required />
          </label>
          <label>
            <span>Alternate Phone</span>
            <input name="alternatePhone" value="${escapeHtml(editingCustomer?.alternatePhone ?? '')}" />
          </label>
          <label>
            <span>Address</span>
            <input name="address" value="${escapeHtml(editingCustomer?.address ?? '')}" />
          </label>
          <label>
            <span>Status</span>
            <select name="status">
              <option value="Active" ${editingCustomer?.status === 'Active' ? 'selected' : ''}>Active</option>
              <option value="Blocked" ${editingCustomer?.status === 'Blocked' ? 'selected' : ''}>Blocked</option>
            </select>
          </label>
          <label>
            <span>Notes</span>
            <textarea name="notes">${escapeHtml(editingCustomer?.notes ?? '')}</textarea>
          </label>
          <div class="modal-actions">
            <button type="submit" class="primary-button">Save Customer</button>
          </div>
        </form>
      </div>
    </div>
  `;
};

const bindCustomerEvents = () => {
  const addButton = document.querySelector<HTMLButtonElement>('#addCustomerBtn');
  addButton?.addEventListener('click', () => {
    editingCustomerId = -1;
    renderCustomers();
  });

  document.querySelectorAll<HTMLElement>('[data-action="edit-customer"]').forEach((button) => {
    button.addEventListener('click', () => {
      editingCustomerId = Number(button.dataset.id);
      renderCustomers();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-action="delete-customer"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.id);
      const customer = customers.find((item) => item.id === id);
      if (customer && window.confirm(`Delete ${customer.fullName}?`)) {
        try {
          await apiRequest(`/customers/${id}`, { method: 'DELETE' });
          customers = customers.filter((item) => item.id !== id);
          saveLocalData();
          renderCustomers();
        } catch (error) {
          console.error('Failed to delete customer', error);
        }
      }
    });
  });

  const searchInput = document.querySelector<HTMLInputElement>('#customerSearch');
  searchInput?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    searchQuery = target.value;
    renderCustomers();
  });

  const filterSelect = document.querySelector<HTMLSelectElement>('#customerFilter');
  filterSelect?.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    customerFilter = target.value as CustomerStatus | 'All';
    renderCustomers();
  });

  const closeButton = document.querySelector<HTMLElement>('#closeCustomerModal');
  closeButton?.addEventListener('click', () => {
    editingCustomerId = null;
    renderCustomers();
  });

  const form = document.querySelector<HTMLFormElement>('#customerForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const fullName = String(formData.get('fullName') || '').trim();
    const phoneNumber = String(formData.get('phoneNumber') || '').trim();
    const alternatePhone = String(formData.get('alternatePhone') || '').trim();
    const address = String(formData.get('address') || '').trim();
    const status = String(formData.get('status') || 'Active') as CustomerStatus;
    const notes = String(formData.get('notes') || '').trim();

    if (!fullName || !phoneNumber) {
      return;
    }

    try {
      const existingCustomer = editingCustomerId && editingCustomerId > 0
        ? customers.find((item) => item.id === editingCustomerId)
        : null;

      if (existingCustomer) {
        const payload = await apiRequest<ApiResponse<{ id: number }>>(`/customers/${existingCustomer.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            full_name: fullName,
            phone_number: phoneNumber,
            alternate_phone: alternatePhone,
            address,
            status: status.toLowerCase(),
            notes,
          }),
        });
        if (payload.data?.id) {
          existingCustomer.fullName = fullName;
          existingCustomer.phoneNumber = phoneNumber;
          existingCustomer.alternatePhone = alternatePhone;
          existingCustomer.address = address;
          existingCustomer.status = status;
          existingCustomer.notes = notes;
        }
      } else {
        const payload = await apiRequest<ApiResponse<{ id: number }>>('/customers', {
          method: 'POST',
          body: JSON.stringify({
            full_name: fullName,
            phone_number: phoneNumber,
            alternate_phone: alternatePhone,
            address,
            status: status.toLowerCase(),
            notes,
          }),
        });
        if (payload.data?.id) {
          customers.push({
            id: payload.data.id,
            fullName,
            phoneNumber,
            alternatePhone,
            address,
            registrationDate: new Date().toISOString().slice(0, 10),
            status,
            notes,
          });
        }
      }

      await loadRemoteData();
      editingCustomerId = null;
      renderCustomers();
    } catch (error) {
      console.error('Failed to save customer', error);
    }
  });
};

const renderEquipment = () => {
  const contentArea = document.querySelector<HTMLElement>('#contentArea');
  if (!contentArea) {
    return;
  }

  const filteredEquipment = equipment.filter((item) => {
    const matchesSearch = `${item.id} ${item.name} ${item.category}`.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = equipmentFilter === 'All' || item.status === equipmentFilter;
    return matchesSearch && matchesStatus;
  });

  const totalEquipment = equipment.length;
  const availableEquipment = equipment.filter((item) => item.status === 'Available').length;
  const unavailableEquipment = totalEquipment - availableEquipment;

  contentArea.innerHTML = `
    <div class="module-shell">
      <div class="module-head">
        <div>
          <p class="eyebrow">Equipment Inventory</p>
          <h2>Track equipment and availability</h2>
        </div>
        <button class="primary-button" id="addEquipmentBtn">Add Equipment</button>
      </div>

      <div class="panel-card summary-card">
        <div class="summary-pill">Total: ${totalEquipment}</div>
        <div class="summary-pill success">Available: ${availableEquipment}</div>
        <div class="summary-pill warning">Unavailable: ${unavailableEquipment}</div>
      </div>

      <div class="toolbar">
        <input id="equipmentSearch" type="text" placeholder="Search by name or category" value="${escapeHtml(searchQuery)}" />
        <select id="equipmentFilter">
          <option value="All" ${equipmentFilter === 'All' ? 'selected' : ''}>All Status</option>
          <option value="Available" ${equipmentFilter === 'Available' ? 'selected' : ''}>Available</option>
          <option value="Reserved" ${equipmentFilter === 'Reserved' ? 'selected' : ''}>Reserved</option>
          <option value="Rented" ${equipmentFilter === 'Rented' ? 'selected' : ''}>Rented</option>
          <option value="Maintenance" ${equipmentFilter === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
        </select>
      </div>

      <div class="panel-card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Category</th>
                <th>Daily Rent</th>
                <th>Status</th>
                <th>Location</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filteredEquipment.map((item) => `
                <tr>
                  <td>${item.id}</td>
                  <td>${escapeHtml(item.name)}</td>
                  <td>${escapeHtml(item.category)}</td>
                  <td>₹ ${item.dailyRent}</td>
                  <td><span class="status-badge ${item.status === 'Available' ? 'available' : item.status === 'Rented' ? 'rented' : item.status === 'Reserved' ? 'reserved' : 'maintenance'}">${escapeHtml(item.status)}</span></td>
                  <td>${escapeHtml(item.location)}</td>
                  <td>
                    <button class="text-button" data-action="toggle-availability" data-id="${item.id}">${item.status === 'Available' ? 'Mark Unavailable' : 'Mark Available'}</button>
                    <button class="text-button" data-action="edit-equipment" data-id="${item.id}">Edit</button>
                    <button class="text-button danger" data-action="delete-equipment" data-id="${item.id}">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ${renderEquipmentModal()}
  `;

  bindEquipmentEvents();
};

const renderEquipmentModal = () => {
  const editingItem = equipment.find((item) => item.id === editingEquipmentId) || null;
  const title = editingItem ? 'Edit Equipment' : 'Add Equipment';

  return `
    <div class="modal-backdrop ${editingEquipmentId !== null ? 'open' : ''}">
      <div class="modal-card">
        <div class="panel-title-row">
          <h3>${title}</h3>
          <button class="text-button" id="closeEquipmentModal">Close</button>
        </div>
        <form id="equipmentForm" class="form-grid">
          <input type="hidden" name="equipmentId" value="${editingItem?.id ?? ''}" />
          <label>
            <span>Name</span>
            <input name="name" value="${escapeHtml(editingItem?.name ?? '')}" required />
          </label>
          <label>
            <span>Category</span>
            <select name="category">
              ${['Generator', 'Drill', 'Welding', 'Compressor', 'Mixer', 'Other'].map((category) => `
                <option value="${category}" ${editingItem?.category === category ? 'selected' : ''}>${category}</option>
              `).join('')}
            </select>
          </label>
          <label>
            <span>Daily Rent</span>
            <input name="dailyRent" type="number" min="0" step="0.01" value="${editingItem?.dailyRent ?? ''}" required />
          </label>
          <label>
            <span>Security Deposit</span>
            <input name="securityDeposit" type="number" min="0" step="0.01" value="${editingItem?.securityDeposit ?? ''}" required />
          </label>
          <label>
            <span>Status</span>
            <select name="status">
              <option value="Available" ${editingItem?.status === 'Available' ? 'selected' : ''}>Available</option>
              <option value="Reserved" ${editingItem?.status === 'Reserved' ? 'selected' : ''}>Reserved</option>
              <option value="Rented" ${editingItem?.status === 'Rented' ? 'selected' : ''}>Rented</option>
              <option value="Maintenance" ${editingItem?.status === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
            </select>
          </label>
          <label>
            <span>Location</span>
            <input name="location" value="${escapeHtml(editingItem?.location ?? '')}" />
          </label>
          <label>
            <span>Notes</span>
            <textarea name="notes">${escapeHtml(editingItem?.notes ?? '')}</textarea>
          </label>
          <div class="modal-actions">
            ${equipmentFormError ? `<p class="form-error" role="alert">${escapeHtml(equipmentFormError)}</p>` : ''}
            <button type="submit" class="primary-button">Save Equipment</button>
          </div>
        </form>
      </div>
    </div>
  `;
};

const bindEquipmentEvents = () => {
  const addButton = document.querySelector<HTMLButtonElement>('#addEquipmentBtn');
  addButton?.addEventListener('click', () => {
    equipmentFormError = '';
    editingEquipmentId = -1;
    renderEquipment();
  });

  document.querySelectorAll<HTMLElement>('[data-action="toggle-availability"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.id);
      const item = equipment.find((entry) => entry.id === id);
      if (item) {
        const nextStatus: EquipmentStatus = item.status === 'Available' ? 'Maintenance' : 'Available';
        try {
          await apiRequest(`/equipment/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: item.name,
              category: item.category,
              daily_rent: item.dailyRent,
              security_deposit: item.securityDeposit,
              status: nextStatus.toLowerCase(),
              location: item.location,
              notes: item.notes,
            }),
          });
          item.status = nextStatus;
          await loadRemoteData();
          renderEquipment();
        } catch (error) {
          console.error('Failed to update equipment status', error);
        }
      }
    });
  });

  document.querySelectorAll<HTMLElement>('[data-action="edit-equipment"]').forEach((button) => {
    button.addEventListener('click', () => {
      equipmentFormError = '';
      editingEquipmentId = Number(button.dataset.id);
      renderEquipment();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-action="delete-equipment"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.id);
      const item = equipment.find((entry) => entry.id === id);
      if (item && window.confirm(`Delete ${item.name}?`)) {
        try {
          await apiRequest(`/equipment/${id}`, { method: 'DELETE' });
          equipment = equipment.filter((entry) => entry.id !== id);
          saveLocalData();
          renderEquipment();
        } catch (error) {
          console.error('Failed to delete equipment', error);
        }
      }
    });
  });

  const searchInput = document.querySelector<HTMLInputElement>('#equipmentSearch');
  searchInput?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    searchQuery = target.value;
    renderEquipment();
  });

  const filterSelect = document.querySelector<HTMLSelectElement>('#equipmentFilter');
  filterSelect?.addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    equipmentFilter = target.value as EquipmentStatus | 'All';
    renderEquipment();
  });

  const closeButton = document.querySelector<HTMLElement>('#closeEquipmentModal');
  closeButton?.addEventListener('click', () => {
    equipmentFormError = '';
    editingEquipmentId = null;
    renderEquipment();
  });

  const form = document.querySelector<HTMLFormElement>('#equipmentForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const dailyRent = Number(formData.get('dailyRent') || 0);
    const securityDeposit = Number(formData.get('securityDeposit') || 0);
    const status = String(formData.get('status') || 'Available') as EquipmentStatus;
    const location = String(formData.get('location') || '').trim();
    const notes = String(formData.get('notes') || '').trim();

    if (!name || !Number.isFinite(dailyRent) || dailyRent < 0 || !Number.isFinite(securityDeposit) || securityDeposit < 0) {
      equipmentFormError = 'Enter an equipment name and valid non-negative rent and deposit amounts.';
      renderEquipment();
      return;
    }

    try {
      const existingEquipment = editingEquipmentId && editingEquipmentId > 0
        ? equipment.find((item) => item.id === editingEquipmentId)
        : null;

      if (existingEquipment) {
        await apiRequest(`/equipment/${existingEquipment.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name,
            category: String(formData.get('category') || 'Other'),
            daily_rent: dailyRent,
            security_deposit: securityDeposit,
            status: status.toLowerCase(),
            location,
            notes,
          }),
        });
        existingEquipment.name = name;
        existingEquipment.category = String(formData.get('category') || 'Other') as EquipmentCategory;
        existingEquipment.dailyRent = dailyRent;
        existingEquipment.securityDeposit = securityDeposit;
        existingEquipment.status = status;
        existingEquipment.location = location;
        existingEquipment.notes = notes;
      } else {
        const payload = await apiRequest<ApiResponse<{ id: number }>>('/equipment', {
          method: 'POST',
          body: JSON.stringify({
            name,
            category: String(formData.get('category') || 'Other'),
            daily_rent: dailyRent,
            security_deposit: securityDeposit,
            status: status.toLowerCase(),
            location,
            notes,
          }),
        });
        if (payload.data?.id) {
          equipment.push({
            id: payload.data.id,
            name,
            category: String(formData.get('category') || 'Other') as EquipmentCategory,
            dailyRent,
            securityDeposit,
            status,
            location,
            notes,
          });
        }
      }

      await loadRemoteData();
      equipmentFormError = '';
      editingEquipmentId = null;
      renderEquipment();
    } catch (error) {
      console.error('Failed to save equipment', error);
      equipmentFormError = error instanceof Error ? error.message : 'Unable to save equipment. Please try again.';
      renderEquipment();
    }
  });
};

const renderRentals = () => {
  const contentArea = document.querySelector<HTMLElement>('#contentArea');
  if (!contentArea) {
    return;
  }

  contentArea.innerHTML = `
    <div class="module-shell">
      <div class="module-head">
        <div>
          <p class="eyebrow">Rental Operations</p>
          <h2>Create and monitor rentals</h2>
        </div>
        <button class="primary-button" id="createRentalBtn">Create Rental</button>
      </div>
      <div class="panel-card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr><th>ID</th><th>Customer</th><th>Equipment</th><th>Expected Return</th><th>Status</th><th>Amount</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${rentals.map((rental) => `
                <tr>
                  <td>${rental.id}</td>
                  <td>${escapeHtml(rental.customerName)}</td>
                  <td>${escapeHtml(rental.equipmentName)}</td>
                  <td>${escapeHtml(rental.expectedReturnDate)}</td>
                  <td>${escapeHtml(rental.status)}</td>
                  <td>₹ ${rental.amount.toLocaleString()}</td>
                  <td>
                    <button class="text-button" data-action="edit-rental" data-id="${rental.id}">Edit</button>
                    <button class="text-button danger" data-action="delete-rental" data-id="${rental.id}">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ${renderRentalModal()}
  `;

  bindRentalEvents();
};

const renderRentalModal = () => {
  const editingRental = rentals.find((item) => item.id === editingRentalId) || null;
  const title = editingRental ? 'Edit Rental' : 'Create Rental';
  const startValue = editingRental
    ? editingRental.rentalDate
    : formatDateTimeInput(new Date());
  const returnValue = editingRental
    ? editingRental.expectedReturnDate
    : formatDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const customer = customers.find((item) => item.fullName === editingRental?.customerName);
  const equipmentItem = equipment.find((item) => item.name === editingRental?.equipmentName);
  const availableEquipment = equipment.filter((item) => item.status === 'Available');

  return `
    <div class="modal-backdrop ${rentalModalOpen ? 'open' : ''}">
      <div class="modal-card">
        <div class="panel-title-row">
          <h3>${title}</h3>
          <button class="text-button" id="closeRentalModal">Close</button>
        </div>
        <form id="rentalForm" class="form-grid">
          <label>
            <span>Customer Name</span>
            <input name="customerName" value="${escapeHtml(editingRental?.customerName ?? '')}" required />
          </label>
          <label>
            <span>Customer Phone</span>
            <input name="customerPhone" value="${escapeHtml(customer?.phoneNumber ?? '')}" />
          </label>
          <label style="grid-column: 1 / -1;">
            <span>Customer Address</span>
            <input name="customerAddress" value="${escapeHtml(customer?.address ?? '')}" />
          </label>
          <label>
            <span>Equipment</span>
            <select name="equipmentName" required>
              <option value="" ${!editingRental ? 'selected' : ''}>Select available equipment</option>
              ${availableEquipment.map((item) => `<option value="${escapeHtml(item.name)}" ${editingRental?.equipmentName === item.name ? 'selected' : ''}>${escapeHtml(item.name)} • ${escapeHtml(item.category)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Equipment Category</span>
            <select name="equipmentCategory">
              ${['Generator', 'Drill', 'Welding', 'Compressor', 'Mixer', 'Other'].map((category) => `<option value="${category}" ${equipmentItem?.category === category ? 'selected' : ''}>${category}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Daily Rent</span>
            <input id="dailyRentInput" name="dailyRent" type="number" min="0" value="${editingRental?.amount ?? equipmentItem?.dailyRent ?? 0}" required />
          </label>
          <label>
            <span>Security Deposit</span>
            <input id="securityDepositInput" name="securityDeposit" type="number" min="0" value="${equipmentItem?.securityDeposit ?? 0}" required />
          </label>
          <label>
            <span>Rental Start</span>
            <input name="rentalDate" type="datetime-local" value="${escapeHtml(startValue)}" required />
          </label>
          <label>
            <span>Expected Return</span>
            <input name="expectedReturnDate" type="datetime-local" value="${escapeHtml(returnValue)}" required />
          </label>
          <div class="modal-actions">
            <button type="submit" class="primary-button">Save Rental</button>
          </div>
        </form>
      </div>
    </div>
  `;
};

const bindRentalEvents = () => {
  const createButton = document.querySelector<HTMLButtonElement>('#createRentalBtn');
  const closeButton = document.querySelector<HTMLElement>('#closeRentalModal');
  const backdrop = document.querySelector<HTMLElement>('.modal-backdrop');

  createButton?.addEventListener('click', () => {
    editingRentalId = null;
    rentalModalOpen = true;
    renderRentals();
  });

  closeButton?.addEventListener('click', () => {
    editingRentalId = null;
    rentalModalOpen = false;
    renderRentals();
  });

  backdrop?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      editingRentalId = null;
      rentalModalOpen = false;
      renderRentals();
    }
  });

  const equipmentSelect = document.querySelector<HTMLSelectElement>('#rentalForm select[name="equipmentName"]');
  const dailyRentInput = document.querySelector<HTMLInputElement>('#dailyRentInput');
  const securityDepositInput = document.querySelector<HTMLInputElement>('#securityDepositInput');

  equipmentSelect?.addEventListener('change', () => {
    const selectedName = equipmentSelect.value;
    const selectedItem = equipment.find((item) => item.name === selectedName);
    if (selectedItem) {
      if (dailyRentInput) {
        dailyRentInput.value = String(selectedItem.dailyRent);
      }
      if (securityDepositInput) {
        securityDepositInput.value = String(selectedItem.securityDeposit);
      }
    }
  });

  const form = document.querySelector<HTMLFormElement>('#rentalForm');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const customerName = String(formData.get('customerName') || '').trim();
    const customerPhone = String(formData.get('customerPhone') || '').trim();
    const customerAddress = String(formData.get('customerAddress') || '').trim();
    const equipmentName = String(formData.get('equipmentName') || '').trim();
    const selectedEquipment = equipment.find((item) => item.name === equipmentName);
    const equipmentCategory = String(formData.get('equipmentCategory') || 'Other') as EquipmentCategory;
    const dailyRent = Number(formData.get('dailyRent') || 0);
    const securityDeposit = Number(formData.get('securityDeposit') || 0);
    const rentalDate = String(formData.get('rentalDate') || '');
    const expectedReturnDate = String(formData.get('expectedReturnDate') || '');

    if (!customerName || !equipmentName || !selectedEquipment || selectedEquipment.status !== 'Available') {
      return;
    }

    try {
      const existingRental = editingRentalId !== null
        ? rentals.find((item) => item.id === editingRentalId)
        : null;

      if (existingRental) {
        await apiRequest(`/rentals/${existingRental.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            customer_id: customers.find((item) => item.fullName === customerName)?.id || 0,
            equipment_id: selectedEquipment.id,
            rental_date: rentalDate,
            expected_return_date: expectedReturnDate,
            daily_rate: dailyRent,
            deposit: securityDeposit,
            rental_days: 1,
          }),
        });
        existingRental.customerName = customerName;
        existingRental.equipmentName = equipmentName;
        existingRental.rentalDate = rentalDate;
        existingRental.expectedReturnDate = expectedReturnDate;
        existingRental.amount = dailyRent;
      } else {
        const customerPayload = await apiRequest<ApiResponse<{ id: number }>>('/customers', {
          method: 'POST',
          body: JSON.stringify({
            full_name: customerName,
            phone_number: customerPhone,
            alternate_phone: '',
            address: customerAddress,
            status: 'active',
            notes: 'Created from rental flow',
          }),
        });

        const rentalPayload = await apiRequest<ApiResponse<{ id: number; invoice_number: string }>>('/rentals', {
          method: 'POST',
          body: JSON.stringify({
            customer_id: customerPayload.data?.id,
            equipment_id: selectedEquipment.id,
            rental_date: rentalDate,
            expected_return_date: expectedReturnDate,
            daily_rate: dailyRent,
            deposit: securityDeposit,
            rental_days: 1,
          }),
        });

        selectedEquipment.status = 'Rented';
        selectedEquipment.category = equipmentCategory;
        selectedEquipment.dailyRent = dailyRent;
        selectedEquipment.securityDeposit = securityDeposit;
        selectedEquipment.location = 'Current rental';
        selectedEquipment.notes = 'Created from rental flow';

        rentals.push({
          id: rentalPayload.data?.id || Date.now(),
          customerName,
          equipmentName,
          rentalDate,
          expectedReturnDate,
          status: 'Active',
          amount: dailyRent,
        });
      }

      await loadRemoteData();
      editingRentalId = null;
      rentalModalOpen = false;
      renderRentals();
    } catch (error) {
      console.error('Failed to save rental', error);
    }
  });
};

const renderPlaceholder = (title: string, hint: string) => {
  const contentArea = document.querySelector<HTMLElement>('#contentArea');
  if (!contentArea) {
    return;
  }

  contentArea.innerHTML = `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(hint)}</p>
      <button class="primary-button" data-nav="dashboard">Return to dashboard</button>
    </div>
  `;
};

const formatTitle = (route: Route) => {
  switch (route) {
    case 'dashboard':
      return 'Dashboard';
    case 'customers':
      return 'Customers';
    case 'equipment':
      return 'Equipment';
    case 'rentals':
      return 'Rentals';
    case 'payments':
      return 'Payments';
    case 'reports':
      return 'Reports';
    case 'settings':
      return 'Settings';
    default:
      return 'Access';
  }
};

const escapeHtml = (value: string) => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

void initApp();
