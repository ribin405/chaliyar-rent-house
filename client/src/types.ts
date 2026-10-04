export interface User {
  id: number;
  username: string;
  full_name: string;
  role: 'owner' | 'staff';
  is_active?: number;
  created_at?: string;
}

export interface Customer {
  id: number;
  full_name: string;
  phone_number: string;
  alternate_phone: string;
  address: string;
  registration_date: string;
  status: 'active' | 'blocked';
  notes: string;
  // Equipment still out with this customer (from GET /customers).
  open_count?: number;
  overdue_count?: number;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  is_active: number;
}

export interface Equipment {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  daily_rent: number;
  security_deposit: number;
  status: 'available' | 'reserved' | 'rented' | 'maintenance';
  location: string;
  notes: string;
  // Identical units held, how many are out on rent, and how many can still go out.
  stock_quantity: number;
  units_out: number;
  available_quantity: number;
}

export type RentalStatus = 'active' | 'overdue' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'partial' | 'paid';

export interface Rental {
  id: number;
  invoice_number: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  equipment_id: number;
  equipment_name: string;
  quantity: number;
  rental_date: string;
  rental_time: string;
  expected_return_date: string;
  expected_return_time: string;
  actual_return_date: string | null;
  actual_return_time: string | null;
  rental_days: number;
  daily_rate: number;
  deposit: number;
  total_rent: number;
  late_fee: number;
  damage_charge: number;
  refund_amount: number;
  final_amount: number;
  amount: number;
  payment_status: PaymentStatus;
  status: RentalStatus;
  return_notes: string | null;
}

export interface Payment {
  id: number;
  invoice_number: string;
  customer_name: string;
  amount: number;
  discount: number;
  payment_method: string;
  payment_type: 'rent' | 'deposit' | 'refund';
  payment_date: string;
  notes: string;
}

export interface DashboardOpenItem {
  id: number;
  invoice_number: string;
  customer_name: string;
  customer_phone: string;
  equipment_id: number;
  equipment_name: string;
  quantity: number;
  rental_date: string;
  expected_return_date: string;
  expected_return_time: string;
  status: RentalStatus;
}

export interface DashboardUnpaidInvoice {
  invoice_number: string;
  customer_name: string;
  customer_phone: string;
  rental_date: string;
  total: number;
  paid: number;
  balance: number;
  item_count: number;
  open_count: number;
  payment_status: PaymentStatus;
}

export interface DashboardRecentCustomer {
  id: number;
  full_name: string;
  phone_number: string;
  last_rental_date: string;
  last_invoice: string;
  open_count: number;
  overdue_count: number;
  open_invoices: string[];
}

export interface DashboardToday {
  today: string;
  openItems: DashboardOpenItem[];
  unpaidInvoices: DashboardUnpaidInvoice[];
  todayPayments: Array<{ id: number; invoice_number: string; customer_name: string; amount: number; payment_type: Payment['payment_type']; payment_method: string }>;
  recentCustomers: DashboardRecentCustomer[];
  summary: { rentalsStarted: number; itemsReturned: number; collected: number; refunded: number };
}

export interface ShopSettings {
  shop_name: string;
  shop_address: string;
  shop_phone: string;
  shop_email: string | null;
  invoice_prefix: string;
  currency_symbol: string;
}

export interface SearchResults {
  customers: Array<Pick<Customer, 'id' | 'full_name' | 'phone_number' | 'alternate_phone' | 'status'>>;
  equipment: Array<Pick<Equipment, 'id' | 'name' | 'category_name' | 'status' | 'location'>>;
  rentals: Array<Pick<Rental, 'id' | 'invoice_number' | 'customer_name' | 'customer_phone' | 'equipment_name' | 'status'>>;
}
