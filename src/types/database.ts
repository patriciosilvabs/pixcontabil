// Types for the application based on database schema

export type AppRole = "admin" | "operator";
export type ClassificationType = "cost" | "expense";
export type TransactionStatus = "pending" | "completed" | "failed" | "cancelled";
export type PixType = "key" | "copy_paste" | "qrcode";
export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";
export type ReceiptStatus = "pending" | "processing" | "completed" | "failed";

export interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  cnpj: string | null;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  payment_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: string;
  company_id: string;
  name: string;
  bank_name: string;
  agency: string | null;
  account_number: string | null;
  pix_key: string | null;
  pix_key_type: PixKeyType | null;
  balance: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  company_id: string;
  name: string;
  classification: ClassificationType;
  parent_id: string | null;
  keywords: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  company_id: string;
  bank_account_id: string | null;
  category_id: string | null;
  created_by: string;
  classified_by: string | null;
  pix_type: PixType;
  pix_key: string | null;
  pix_key_type: PixKeyType | null;
  pix_copy_paste: string | null;
  amount: number;
  description: string | null;
  beneficiary_name: string | null;
  beneficiary_document: string | null;
  status: TransactionStatus;
  external_id: string | null;
  paid_at: string | null;
  classified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Receipt {
  id: string;
  transaction_id: string;
  uploaded_by: string;
  file_url: string;
  file_type: string | null;
  file_name: string | null;
  ocr_status: ReceiptStatus;
  ocr_data: Record<string, unknown>;
  extracted_cnpj: string | null;
  extracted_date: string | null;
  extracted_value: number | null;
  extracted_access_key: string | null;
  capture_latitude: number | null;
  capture_longitude: number | null;
  capture_timestamp: string | null;
  device_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  company_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// Extended types with relations
export interface TransactionWithRelations extends Transaction {
  category?: Category;
  bank_account?: BankAccount;
  receipts?: Receipt[];
  creator?: Profile;
  classifier?: Profile;
}

export interface CompanyWithMembers extends Company {
  members?: (CompanyMember & { profile?: Profile })[];
  bank_accounts?: BankAccount[];
}

// Dashboard summary types
export interface DashboardSummary {
  totalBalance: number;
  totalCosts: number;
  totalExpenses: number;
  transactionsToday: number;
  transactionsMonth: number;
  pendingReceipts: number;
}

export interface CategorySummary {
  category: Category;
  total: number;
  count: number;
  percentage: number;
}
