import React, { useState, useEffect } from 'react';

// ==========================================
// ENVIRONMENT CONFIG (Auto-Sanitized)
// ==========================================
const rawUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
// Strip trailing slash if it exists to prevent 404 double-slash errors
const API_BASE_URL = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;

// ==========================================
// 1. GLOBAL FORMATTERS & STYLES
// ==========================================

const formatMDY = (dateStr: string) => {
  if (!dateStr) return 'MM/DD/YYYY';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) return `${parts[1]}/${parts[2]}/${parts[0]}`; 
  return dateStr;
};

const formatMonthYear = (ym: string) => {
  if (!ym) return 'MM/YYYY';
  const [y, m] = ym.split('-');
  return `${m}/${y}`;
};

const format12Hour = (time24: string) => {
  if (!time24) return '';
  if (!time24.includes(':')) return time24; 
  const [h, m] = time24.split(':');
  let hours = parseInt(h, 10);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours.toString().padStart(2, '0')}:${m} ${ampm}`;
};

// Formats as Money, returns just a dash "-" if value is 0 or empty
const formatMoney = (val: number) => {
  if (!val || val === 0) return '-';
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Formats Decimal Hours (0.50) into Human Readable Minutes (30m) purely for display
const formatDecToHM = (decimalHours: number) => {
  if (!decimalHours || decimalHours <= 0) return '0m';
  const h = Math.floor(decimalHours);
  const m = Math.round((decimalHours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

// ==========================================
// 2. REUSABLE UI COMPONENTS
// ==========================================

// Custom 12-Hour Time Picker (Bypasses Mobile OS Overrides)
const TimePicker12h = ({ value, onChange, disabled = false, compact = false }: any) => {
  const initialHours24 = value ? parseInt(value.split(':')[0]) : 9;
  const initialMinutes = value ? value.split(':')[1] : '00';
  let initialHours12 = initialHours24 % 12 || 12;
  const initialPeriod = initialHours24 >= 12 ? 'PM' : 'AM';

  const [hour, setHour] = useState(String(initialHours12).padStart(2, '0'));
  const [minute, setMinute] = useState(initialMinutes);
  const [period, setPeriod] = useState(initialPeriod);

  useEffect(() => {
    if(value) {
        const h24 = parseInt(value.split(':')[0]);
        const m = value.split(':')[1];
        setHour(String(h24 % 12 || 12).padStart(2, '0'));
        setMinute(m);
        setPeriod(h24 >= 12 ? 'PM' : 'AM');
    }
  }, [value]);

  const syncTimeChange = (h: string, m: string, p: string) => {
    let finalHour = parseInt(h);
    if (p === 'PM' && finalHour < 12) finalHour += 12;
    if (p === 'AM' && finalHour === 12) finalHour = 0;
    onChange(`${String(finalHour).padStart(2, '0')}:${m}`);
  };

  return (
    <div className={`flex items-center gap-1 bg-white border border-slate-300 rounded-lg ${compact ? 'p-1.5' : 'p-2.5'} focus-within:ring-2 focus-within:ring-indigo-500 shadow-sm w-full ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <select value={hour} onChange={(e) => { setHour(e.target.value); syncTimeChange(e.target.value, minute, period); }} className="bg-transparent p-1 focus:outline-none w-full text-center text-slate-800 font-bold appearance-none cursor-pointer text-sm sm:text-base">
        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(h => (<option key={h} value={h}>{h}</option>))}
      </select>
      <span className="text-slate-400 font-bold">:</span>
      <select value={minute} onChange={(e) => { setMinute(e.target.value); syncTimeChange(hour, e.target.value, period); }} className="bg-transparent p-1 focus:outline-none w-full text-center text-slate-800 font-bold appearance-none cursor-pointer text-sm sm:text-base">
        {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(m => (<option key={m} value={m}>{m}</option>))}
      </select>
      <select value={period} onChange={(e) => { setPeriod(e.target.value); syncTimeChange(hour, minute, e.target.value); }} className="bg-slate-100 border-l border-slate-200 px-2 py-1.5 rounded font-bold text-xs sm:text-sm text-indigo-600 focus:outline-none cursor-pointer appearance-none ml-1">
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
};

const InputField = ({ label, required = false, type = "text", placeholder = "", value, onChange, step, disabled = false }: any) => {
  const renderInput = () => {
    if (type === 'date') {
      return (
        <div className="relative w-full">
          <div className={`w-full px-4 py-2.5 border rounded-lg text-sm shadow-sm flex items-center justify-between pointer-events-none ${disabled ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-white border-slate-300 text-slate-800'}`}>
            <span>{value ? formatMDY(value) : 'MM/DD/YYYY'}</span>
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <input 
            required={required} 
            type="date" 
            value={value} 
            onChange={onChange} 
            disabled={disabled} 
            onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
          />
        </div>
      );
    }

    return (
      <input 
        required={required}
        type={type}
        step={step}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none transition-all text-sm shadow-sm placeholder:text-slate-400 text-slate-800 ${disabled ? 'bg-slate-100 border-slate-200 cursor-not-allowed text-slate-500' : 'bg-white border-slate-300 focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600'}`}
      />
    );
  };

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <label className="text-sm font-medium text-slate-600">
        {label} {required && <span className="text-blue-600">*</span>}
      </label>
      {renderInput()}
    </div>
  );
};

const EmployeeFormFields = ({ formData, handleChange }: any) => (
  <>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
      <InputField required label="First Name" value={formData.firstName} onChange={handleChange('firstName', 'standard')} />
      <InputField label="Middle Name" placeholder="Optional" value={formData.middleName} onChange={handleChange('middleName', 'standard')} />
      <InputField required label="Last Name" value={formData.lastName} onChange={handleChange('lastName', 'standard')} />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
      <InputField required type="date" label="Birth Date" value={formData.dateOfBirth} onChange={handleChange('dateOfBirth', 'standard')} />
      <div className="flex flex-col gap-1.5 w-full">
        <label className="text-sm font-medium text-slate-600">Civil Status <span className="text-blue-600">*</span></label>
        <div className="relative">
          <select required value={formData.civilStatus} onChange={handleChange('civilStatus', 'standard')} className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 focus:outline-none transition-all text-sm shadow-sm text-slate-800 appearance-none cursor-pointer">
            <option value="Single">Single</option>
            <option value="Married">Married</option>
            <option value="Widowed">Widowed</option>
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6"/></svg>
          </div>
        </div>
      </div>
    </div>

    <div className="mt-4 sm:mt-6">
      <InputField required label="Complete Address" value={formData.address} onChange={handleChange('address', 'standard')} />
    </div>
    
    <hr className="border-t border-slate-200 my-4" />

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
      <InputField required type="number" step="0.01" label="Base Salary per Cutoff (₱)" placeholder="0.00" value={formData.baseRate} onChange={handleChange('baseRate', 'standard')} />
      <div className="flex flex-col gap-1.5 w-full">
        <label className="text-sm font-medium text-slate-600">Employment Status <span className="text-blue-600">*</span></label>
        <div className="relative">
          <select required value={formData.employmentStatus} onChange={handleChange('employmentStatus', 'standard')} className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 focus:outline-none transition-all text-sm shadow-sm text-slate-800 appearance-none cursor-pointer">
            <option value="Probationary">Probationary</option>
            <option value="Regular">Regular</option>
            <option value="Contractual">Contractual</option>
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6"/></svg>
          </div>
        </div>
      </div>
      <InputField label="Bank Account No." placeholder="Optional (Numbers only)" value={formData.bankAccount} onChange={handleChange('bankAccount', 'bank')} />
    </div>

    <hr className="border-t border-slate-200 my-4" />
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
      <InputField type="number" step="0.01" label="Total Cash Advance Balance (₱)" placeholder="0.00" value={formData.cashAdvanceBalance} onChange={handleChange('cashAdvanceBalance', 'standard')} />
      <InputField type="number" step="0.01" label="Standard Deduction per Cutoff (₱)" placeholder="0.00" value={formData.cashAdvanceInstallment} onChange={handleChange('cashAdvanceInstallment', 'standard')} />
    </div>

    <hr className="border-t border-slate-200 my-4" />

    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      <InputField label="TIN" placeholder="000-000-000-000" value={formData.tin} onChange={handleChange('tin', 'tin')} />
      <InputField label="SSS Number" placeholder="00-0000000-0" value={formData.sssNumber} onChange={handleChange('sssNumber', 'sss')} />
      <InputField label="PhilHealth" placeholder="0000-0000-0000" value={formData.philhealth} onChange={handleChange('philhealth', 'philhealth')} />
      <InputField label="Pag-IBIG" placeholder="0000-0000-0000" value={formData.pagIbig} onChange={handleChange('pagIbig', 'pagibig')} />
    </div>
  </>
);

// ==========================================
// 3. INTERFACES 
// ==========================================

interface Employee {
  id: number;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  address: string;
  civilStatus: string;
  baseRate: number;
  employmentStatus: string;
  tin: string;
  sssNumber: string;
  philhealth: string;
  pagIbig: string;
  bankAccount: string;
  cashAdvanceBalance: number;
  cashAdvanceInstallment: number;
}

interface AttendanceRecord {
  id: number;
  employeeId: number;
  date: string;
  timeIn: string;
  timeOut: string;
  hours: number;
  reason?: string; 
  shiftStart?: string; 
  shiftEnd?: string;
}

interface PayrollRecord {
  id: number;
  employeeId: number;
  daysWorked: number;
  totalHours: number;
  cashAdvance: number;
  sssDeduction: number;
  pagIbigDeduct: number;
  philhealthDeduct: number;
  tax: number;
  grossPay: number;
  netPay: number;
  createdAt: string;
  pagIbigLoan: number;        // <-- Added
  pagIbigHousingLoan: number; // <-- Added
}

interface SummaryReportRow {
  emp: Employee;
  totalHours: number;
  totalDays: number;
  otHours: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  count: number;
}

// ==========================================
// 4. MAIN APP COMPONENT
// ==========================================

export default function App() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
  
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'list' | 'add' | 'attendance' | 'payroll' | 'tax' | 'report' | 'users'>('dashboard');
  
// State for Managing Users (We leave the hardcoded admin OUT of this state)
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  // --- SUPER ADMIN CAPABILITIES STATE ---
const currentUser = adminUsers.find(u => u.username.toLowerCase() === loginUsername.trim().toLowerCase());
  const isCurrentUserSuperAdmin = currentUser?.role === 'Super Admin';
  
  const [editingPasswordId, setEditingPasswordId] = useState<number | null>(null);
  const [newResetPassword, setNewResetPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [attendanceSearchQuery, setAttendanceSearchQuery] = useState(''); 
  
  // Payroll Compute Tab States
  const [payrollComputeMonth, setPayrollComputeMonth] = useState(new Date().toISOString().slice(0, 7));
  const [payrollActiveSearchQuery, setPayrollActiveSearchQuery] = useState('');
  const [payrollHistorySearchQuery, setPayrollHistorySearchQuery] = useState('');

  // Modals & Status
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  
  // Edit, Payslip & Month View Modals State
  const [selectedPayslip, setSelectedPayslip] = useState<{ record: PayrollRecord, emp: Employee } | null>(null);
  const [editingLog, setEditingLog] = useState<AttendanceRecord | null>(null);
  const [editLogForm, setEditLogForm] = useState({ date: '', timeIn: '', timeOut: '', type: 'regular', reason: '' });
  
  // State for showing detailed month logs modal
  const [monthLogsModalEmp, setMonthLogsModalEmp] = useState<Employee | null>(null);

  // State for Summary Report feature
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');
  const [reportSelectedEmp, setReportSelectedEmp] = useState('all');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  const [activeEmployee, setActiveEmployee] = useState<Employee | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  
  // Attendance & Shifts
  const [tempShiftStart, setTempShiftStart] = useState('08:00');
  const [tempShiftEnd, setTempShiftEnd] = useState('17:00');
  const [shiftStart, setShiftStart] = useState('08:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');

  const [attendanceFilter, setAttendanceFilter] = useState<'day' | 'month'>('day');
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceMonth, setAttendanceMonth] = useState(new Date().toISOString().slice(0, 7)); 
  
  const [dailyTimeLogs, setDailyTimeLogs] = useState<Record<number, { timeIn: string, timeOut: string, type: string, reason: string }>>({});

  const initialFormState = {
    firstName: '', middleName: '', lastName: '', dateOfBirth: '', 
    civilStatus: 'Single', address: '', employmentStatus: 'Probationary', 
    baseRate: '', bankAccount: '', tin: '', sssNumber: '', philhealth: '', pagIbig: '',
    cashAdvanceBalance: '', cashAdvanceInstallment: ''
  };
  const [formData, setFormData] = useState(initialFormState);

const [payrollData, setPayrollData] = useState({
    daysWorked: '13', cashAdvance: '', sss: '', pagIbig: '', philhealth: '', isDeclared: false,
    pagIbigLoan: '0',        // <-- Added
    pagIbigHousingLoan: '0'  // <-- Added
  });

  // --- DYNAMIC TAX MATRIX STATE ---
  const [isEditingTax, setIsEditingTax] = useState(false);
  const [taxBrackets, setTaxBrackets] = useState([
    { id: 1, min: 0, baseTax: 0, rate: 0, excessOver: 0 },
    { id: 2, min: 10417, baseTax: 0, rate: 0.15, excessOver: 10417 },
    { id: 3, min: 16667, baseTax: 937.5, rate: 0.20, excessOver: 16667 },
    { id: 4, min: 33333, baseTax: 4270.7, rate: 0.25, excessOver: 33333 },
    { id: 5, min: 83333, baseTax: 16770.7, rate: 0.30, excessOver: 83333 },
    { id: 6, min: 333333, baseTax: 91770.7, rate: 0.35, excessOver: 333333 },
  ]);

  // Helper function: Finds the correct bracket and computes the exact tax
  const calculateDynamicTax = (taxableIncome: number, brackets: any[]) => {
    if (taxableIncome <= 0) return { tax: 0, bracketMin: 0, rate: 0, minTax: 0, taxBase: 0 };
    // Sort highest to lowest to catch the top bracket they fall into
    const sorted = [...brackets].sort((a, b) => b.min - a.min);
    const applicable = sorted.find(b => taxableIncome >= b.min) || sorted[sorted.length - 1];
    
    const taxBase = taxableIncome - applicable.excessOver;
    const computedTax = applicable.baseTax + (taxBase * applicable.rate);
    
    return { 
      tax: computedTax, 
      bracketMin: applicable.min, 
      rate: applicable.rate, 
      minTax: applicable.baseTax, 
      taxBase: Math.max(0, taxBase) 
    };
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => { setToast(null); }, 3500);
  };

  // --- AUTHENTICATION LOGIC ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');
    try {
      const cleanUsername = loginUsername.trim().toLowerCase();
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUsername, password: loginPassword })
      });
      if (response.ok) {
        setIsAuthenticated(true);
        setActiveTab('dashboard');
      } else {
        setLoginError('Access Denied: Invalid credentials.');
      }
    } catch (error) {
      setLoginError('Network Error: Could not connect to backend.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => { 
    setIsAuthenticated(false); 
    setLoginUsername(''); 
    setLoginPassword(''); 
    setActiveTab('dashboard'); 
  };

// --- DATA FETCHING (Only runs after login) ---
  useEffect(() => {
    if (isAuthenticated) {
      fetchEmployees();
      fetchAttendances();
      fetchPayrolls();
      fetchSettings();
      fetchAdmins();
    }
  }, [isAuthenticated]);

  // --- DATA FETCHING ---
  const fetchAdmins = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/admins`);
      if (response.ok) {
        const data = await response.json();
        setAdminUsers(data);
      }
    } catch (error) { 
      console.error("Could not fetch admins"); 
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/settings`);
      if (response.ok) {
        const data = await response.json();
        const settingsObj = Array.isArray(data) ? data[0] : data;
        
        if (settingsObj && settingsObj.shiftStart && settingsObj.shiftEnd) {
          setShiftStart(settingsObj.shiftStart);
          setShiftEnd(settingsObj.shiftEnd);
          setTempShiftStart(settingsObj.shiftStart);
          setTempShiftEnd(settingsObj.shiftEnd);
        }
      }
    } catch (error) {
      console.warn("Could not connect to /settings backend endpoint. Using defaults.");
    }
  };

  const fetchEmployees = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees`);
      if (!response.ok) throw new Error("Failed to fetch employees");
      const data = await response.json();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      showToast("Could not fetch employees. Is backend running?", "error");
    }
  };

  const fetchAttendances = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance/all`);
      if (!response.ok) throw new Error("Failed to fetch attendances");
      const data = await response.json();
      setAttendances(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchPayrolls = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/payroll/all`);
      if (!response.ok) throw new Error("Failed to fetch payrolls");
      const data = await response.json();
      setPayrolls(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
    }
  };

  // --- EMPLOYEE CRUD ---
  const handleFormattedChange = (field: string, type: 'tin' | 'sss' | 'philhealth' | 'pagibig' | 'bank' | 'standard') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    let val = e.target.value;
    if (type !== 'standard') {
      let digits = val.replace(/\D/g, ''); 
      if (type === 'tin') {
        digits = digits.slice(0, 12); 
        const m = digits.match(/^(\d{0,3})(\d{0,3})(\d{0,3})(\d{0,3})$/);
        val = m ? `${m[1]}${m[2] ? '-' + m[2] : ''}${m[3] ? '-' + m[3] : ''}${m[4] ? '-' + m[4] : ''}` : digits;
      } else if (type === 'sss') {
        digits = digits.slice(0, 10); 
        const m = digits.match(/^(\d{0,2})(\d{0,7})(\d{0,1})$/);
        val = m ? `${m[1]}${m[2] ? '-' + m[2] : ''}${m[3] ? '-' + m[3] : ''}` : digits;
      } else if (type === 'philhealth' || type === 'pagibig') {
        digits = digits.slice(0, 12); 
        const m = digits.match(/^(\d{0,4})(\d{0,4})(\d{0,4})$/);
        val = m ? `${m[1]}${m[2] ? '-' + m[2] : ''}${m[3] ? '-' + m[3] : ''}` : digits;
      } else if (type === 'bank') { digits = digits.slice(0, 20); val = digits; }
    }
    setFormData(prev => ({ ...prev, [field]: val }));
  };

  const handleSubmitEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstName.trim() || !formData.lastName.trim() || !formData.dateOfBirth || !formData.address.trim() || !formData.baseRate) {
      showToast("All core employee details must be filled out.", "error"); return;
    }

    setIsSaving(true);
    const payload = {
      ...formData, baseRate: parseFloat(formData.baseRate), dateOfBirth: new Date(formData.dateOfBirth).toISOString(),
      middleName: formData.middleName || null, bankAccount: formData.bankAccount || '', tin: formData.tin || null,
      sssNumber: formData.sssNumber || null, philhealth: formData.philhealth || null, pagIbig: formData.pagIbig || null,
      cashAdvanceBalance: parseFloat(formData.cashAdvanceBalance) || 0,
      cashAdvanceInstallment: parseFloat(formData.cashAdvanceInstallment) || 0,
    };
    
    const url = editingId ? `${API_BASE_URL}/employees/${editingId}` : `${API_BASE_URL}/employees`;
    const method = editingId ? 'PATCH' : 'POST';

    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) { showToast("Failed to save. Government ID might already exist.", "error"); setIsSaving(false); return; }
      
      await fetchEmployees();
      setIsEditModalOpen(false);
      showToast(editingId ? "Successfully updated employee!" : "Successfully registered employee!", "success");
      if (!editingId) { setFormData(initialFormState); setActiveTab('list'); }
    } catch (error) { showToast("Network Error. Cannot connect to backend.", "error"); } finally { setIsSaving(false); }
  };

  const deleteEmployee = async (id: number) => {
    if (!window.confirm("Are you sure you want to permanently delete this employee?")) return;
    try {
      const response = await fetch(`${API_BASE_URL}/employees/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error("Failed to delete employee");
      await fetchEmployees();
      showToast("Employee deleted successfully.", "success");
    } catch (error) { showToast("Failed to delete employee.", "error"); }
  };

  const openEditModal = (emp: Employee) => {
    setFormData({
      firstName: emp.firstName, middleName: emp.middleName || '', lastName: emp.lastName,
      dateOfBirth: emp.dateOfBirth ? emp.dateOfBirth.split('T')[0] : '', civilStatus: emp.civilStatus,
      address: emp.address, employmentStatus: emp.employmentStatus, baseRate: emp.baseRate.toString(),
      bankAccount: emp.bankAccount || '', tin: emp.tin || '', sssNumber: emp.sssNumber || '',
      philhealth: emp.philhealth || '', pagIbig: emp.pagIbig || '',
      cashAdvanceBalance: emp.cashAdvanceBalance ? emp.cashAdvanceBalance.toString() : '',
      cashAdvanceInstallment: emp.cashAdvanceInstallment ? emp.cashAdvanceInstallment.toString() : ''
    });
    setEditingId(emp.id); setIsEditModalOpen(true); 
  };

  // --- ATTENDANCE & SHIFT LOGIC ---
  const applyShiftSettings = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftStart: tempShiftStart, shiftEnd: tempShiftEnd })
      });
      
      if (!response.ok) throw new Error("Failed to push setting to database.");
      
      setShiftStart(tempShiftStart);
      setShiftEnd(tempShiftEnd);
      showToast("Shift updated permanently in database!", "success");
    } catch (error) {
      console.warn(error);
      showToast("Failed to save shift to database. Ensure /settings backend is ready.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const calculateShiftHours = (tInStr: string, tOutStr: string, sInStr: string = shiftStart, sOutStr: string = shiftEnd) => {
    if (!tInStr || !tOutStr || !tInStr.includes(':')) return { reg: 0, ot: 0, earlyOt: 0, lateOt: 0, total: 0 };
    const timeToFloat = (t: string) => { const [h, m] = t.split(':').map(Number); return h + m / 60; };

    let tIn = timeToFloat(tInStr);
    let tOut = timeToFloat(tOutStr);
    let sIn = timeToFloat(sInStr);
    let sOut = timeToFloat(sOutStr);

    if (tOut < tIn) tOut += 24; 
    if (sOut < sIn) sOut += 24;

    // Detect and align logs mapped to the following/previous day 
    if (tIn < sIn && (sIn - tIn) >= 12) {
      tIn += 24;
      tOut += 24;
    } else if (tIn > sOut && (tIn - sOut) >= 12) {
      tIn -= 24;
      tOut -= 24;
    }

    const regStart = Math.max(tIn, sIn);
    const regEnd = Math.min(tOut, sOut);
    let regHrs = Math.max(0, regEnd - regStart);

    // Auto-deduct 1-hour unpaid lunch break if the regular shift covers 5 hours or more
    if (regHrs >= 5) {
      regHrs -= 1;
    }

    const earlyOt = Math.max(0, Math.min(tOut, sIn) - tIn);
    const lateOt = Math.max(0, tOut - Math.max(tIn, sOut));
    const totalOt = earlyOt + lateOt;

    return { reg: regHrs, ot: totalOt, earlyOt, lateOt, total: regHrs + totalOt };
  };

  const handleTimeChange = (empId: number, field: 'timeIn' | 'timeOut' | 'type' | 'reason', value: string) => {
    setDailyTimeLogs((prev) => {
      const existingLog = prev[empId] ? prev[empId] : { timeIn: shiftStart, timeOut: shiftEnd, type: 'regular', reason: '' };
      return { ...prev, [empId]: { ...existingLog, [field]: value } };
    });
  };

  const saveInlineAttendance = async (empId: number) => {
    const log = dailyTimeLogs[empId] || { type: 'regular', timeIn: shiftStart, timeOut: shiftEnd, reason: '' };
    let payload;

    if (log.type === 'paid_leave') {
      payload = { employeeId: empId, date: attendanceDate, timeIn: 'LEAVE', timeOut: 'PAID', hours: 8, reason: log.reason || null };
    } else if (log.type === 'unpaid_leave') {
      payload = { employeeId: empId, date: attendanceDate, timeIn: 'LEAVE', timeOut: 'UNPAID', hours: 0, reason: log.reason || null };
    } else {
      if (!log.timeIn || !log.timeOut) { showToast("Please enter both Time In and Time Out.", "error"); return; }
      const calculated = calculateShiftHours(log.timeIn, log.timeOut, shiftStart, shiftEnd);
      payload = { 
        employeeId: empId, 
        date: attendanceDate, 
        timeIn: log.timeIn, 
        timeOut: log.timeOut, 
        hours: calculated.total, 
        reason: null,
        shiftStart: shiftStart,
        shiftEnd: shiftEnd
      };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });
      if (!response.ok) throw new Error("Backend rejected the save request");
      
      await fetchAttendances();
      setDailyTimeLogs(prev => {
        const newState = { ...prev };
        delete newState[empId];
        return newState;
      });
      showToast("Log saved successfully!", "success");
    } catch (error) { 
      console.error(error);
      showToast("Failed to save attendance log to backend.", "error"); 
    }
  };

  const openEditLogModal = (log: AttendanceRecord) => {
    const isLeave = !log.timeIn.includes(':');
    let type = 'regular';
    if (isLeave) type = log.timeOut === 'PAID' ? 'paid_leave' : 'unpaid_leave';

    setEditLogForm({
      date: log.date ? log.date.split('T')[0] : '',
      timeIn: isLeave ? '' : log.timeIn,
      timeOut: isLeave ? '' : log.timeOut,
      type,
      reason: log.reason || ''
    });
    setEditingLog(log);
  };

  const submitEditLog = async () => {
    if (!editingLog) return;
    setIsSaving(true);
    let payload;

    if (editLogForm.type === 'paid_leave') {
      payload = { date: editLogForm.date, timeIn: 'LEAVE', timeOut: 'PAID', hours: 8, reason: editLogForm.reason || null };
    } else if (editLogForm.type === 'unpaid_leave') {
      payload = { date: editLogForm.date, timeIn: 'LEAVE', timeOut: 'UNPAID', hours: 0, reason: editLogForm.reason || null };
    } else {
      if (!editLogForm.timeIn || !editLogForm.timeOut) {
        showToast("Please enter both Time In and Time Out.", "error");
        setIsSaving(false); return;
      }
      const appliedStart = editingLog.shiftStart || shiftStart;
      const appliedEnd = editingLog.shiftEnd || shiftEnd;
      const calculated = calculateShiftHours(editLogForm.timeIn, editLogForm.timeOut, appliedStart, appliedEnd);
      payload = { 
        date: editLogForm.date, 
        timeIn: editLogForm.timeIn, 
        timeOut: editLogForm.timeOut, 
        hours: calculated.total, 
        reason: null,
        shiftStart: appliedStart,
        shiftEnd: appliedEnd
      };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance/${editingLog.id}`, { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });
      if (!response.ok) throw new Error("Failed to update log in backend");
      
      await fetchAttendances();
      setEditingLog(null);
      showToast("Log updated successfully!", "success");
    } catch (error) { 
      console.error(error);
      showToast("Failed to update log.", "error"); 
    } finally { 
      setIsSaving(false); 
    }
  };

  const deleteAttendance = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error("Failed to delete log from backend");
      await fetchAttendances();
      showToast("Log removed successfully.", "success");
    } catch (error) { showToast("Failed to delete log.", "error"); }
  };

  // --- PAYROLL LOGIC ---
  const openPayrollModal = (emp: Employee) => {
    setActiveEmployee(emp);
    
    // Calculate actual days present in the selected month to auto-fill the cutoff days
    const empLogs = attendances.filter(a => Number(a.employeeId) === emp.id && a.date && a.date.split('T')[0].startsWith(payrollComputeMonth));
    const actualDays = new Set(empLogs.map(l => l.date && l.date.split('T')[0])).size;
    const defaultDays = actualDays > 0 ? actualDays.toString() : '13';

    // Auto-fill deduction safely (never exceed remaining balance)
    const safeDeduction = (emp.cashAdvanceBalance || 0) > 0 ? Math.min((emp.cashAdvanceInstallment || 0), emp.cashAdvanceBalance) : 0;

    setPayrollData({ 
      daysWorked: defaultDays, 
      cashAdvance: safeDeduction.toString(), 
      sss: '0', 
      pagIbig: '0', 
      philhealth: '0', 
      isDeclared: false,
      pagIbigLoan: '0',        // <-- Added
      pagIbigHousingLoan: '0'  // <-- Added
    });
    setIsPayrollModalOpen(true);
  };

  const calculatePayroll = () => {
    if (!activeEmployee) return null;
    
    // Explicitly filter logs by the active employee AND the currently selected computation month
    const empLogs = attendances.filter(a => 
      Number(a.employeeId) === activeEmployee.id && 
      a.date && 
      a.date.split('T')[0].startsWith(payrollComputeMonth)
    );
    
    // Calculate explicit daily OT rather than aggregating the month
    let totalHoursWorked = 0;
    let otHrs = 0;

    empLogs.forEach(log => {
        if (!log.timeIn || !log.timeIn.includes(':')) {
            totalHoursWorked += log.hours;
        } else {
            const shiftCalc = calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd);
            totalHoursWorked += shiftCalc.total;
            otHrs += shiftCalc.ot; // Protects earned OT from being erased by undertime on other days
        }
    });

    const basicSalary = activeEmployee.baseRate;
    const days = parseFloat(payrollData.daysWorked) || 0;
    
    const ratePerDay = days > 0 ? basicSalary / days : 0;
    const ratePerHour = ratePerDay / 8;
    const requiredHrs = days * 8; // Keep this for undertime deduction
    const otPay = otHrs * (ratePerHour * 1.25); 

    const regularHoursWorked = totalHoursWorked - otHrs;
    let undertimeDeduction = 0;
    
    if (regularHoursWorked < requiredHrs) {
      undertimeDeduction = (requiredHrs - regularHoursWorked) * ratePerHour;
    }

    const grossPay = (basicSalary + otPay) - undertimeDeduction;
    
    const sssDed = parseFloat(payrollData.sss) || 0;
    const pagIbigDed = parseFloat(payrollData.pagIbig) || 0;
    const philhealthDed = parseFloat(payrollData.philhealth) || 0;
    const pagIbigLoanDed = parseFloat(payrollData.pagIbigLoan) || 0;               // <-- Added
    const pagIbigHousingLoanDed = parseFloat(payrollData.pagIbigHousingLoan) || 0; // <-- Added
    
    let cashAdvanceDed = parseFloat(payrollData.cashAdvance) || 0;
    // Prevent manual edits from dropping balance below 0
    if (activeEmployee && cashAdvanceDed > (activeEmployee.cashAdvanceBalance || 0)) {
        cashAdvanceDed = activeEmployee.cashAdvanceBalance || 0;
    }

    const taxableIncome = grossPay - sssDed - pagIbigDed - philhealthDed;
    let autoTax = 0;

    if (payrollData.isDeclared && taxableIncome > 0) {
      // Look ma, no hardcoded if/else! It uses the live UI state now.
      const taxResult = calculateDynamicTax(taxableIncome, taxBrackets);
      autoTax = taxResult.tax;
    }

    const totalDeductions = cashAdvanceDed + sssDed + pagIbigDed + philhealthDed + autoTax + pagIbigLoanDed + pagIbigHousingLoanDed;
    const netPay = grossPay - totalDeductions;

    return { 
      totalHoursWorked, ratePerDay, ratePerHour, requiredHrs, otHrs, otPay, undertimeDeduction, 
      grossPay, autoTax, totalDeductions, netPay, cashAdvanceDed,
      pagIbigLoanDed, pagIbigHousingLoanDed // <-- Added
    };
  };

  const computed = calculatePayroll();

  const savePayrollToDatabase = async () => {
    if (!activeEmployee || !computed) return;
    setIsSaving(true);
    const payload = {
      employeeId: activeEmployee.id,
      daysWorked: parseFloat(payrollData.daysWorked) || 0,
      totalHours: computed.totalHoursWorked,
      cashAdvance: computed.cashAdvanceDed,
      sssDeduction: parseFloat(payrollData.sss) || 0,
      pagIbigDeduct: parseFloat(payrollData.pagIbig) || 0,
      philhealthDeduct: parseFloat(payrollData.philhealth) || 0,
      tax: computed.autoTax,
      grossPay: computed.grossPay,
      netPay: computed.netPay,
      pagIbigLoan: computed.pagIbigLoanDed,               // <-- Added
      pagIbigHousingLoan: computed.pagIbigHousingLoanDed  // <-- Added
    };

    try {
      const response = await fetch(`${API_BASE_URL}/employees/payroll`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });
      if (!response.ok) throw new Error("Failed to save payroll to backend");
      
      // Auto-deduct from employee's total advance balance
      if (computed.cashAdvanceDed > 0) {
        const newBalance = Math.max(0, activeEmployee.cashAdvanceBalance - computed.cashAdvanceDed);
        await fetch(`${API_BASE_URL}/employees/${activeEmployee.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cashAdvanceBalance: newBalance })
        });
      }

      await fetchPayrolls(); 
      await fetchEmployees(); // Refresh employees so the directory shows the new balance
      showToast("Payroll finalized and saved to database!", "success");
      setIsPayrollModalOpen(false);
    } catch (error) { 
      console.error(error);
      showToast("Failed to save payroll.", "error"); 
    } finally { setIsSaving(false); }
  };

  const deletePayroll = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/payroll/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error("Failed to delete payroll");
      await fetchPayrolls();
      showToast("Saved payroll record successfully removed.", "success");
    } catch (error) { showToast("Failed to remove payroll record.", "error"); }
  };

  // --- REPORT GENERATION LOGIC ---
  const getFilteredReportData = (): SummaryReportRow[] => {
    const filteredPayrolls = payrolls.filter(pr => {
      const prDate = new Date(pr.createdAt);
      const from = reportFromDate ? new Date(reportFromDate) : null;
      const to = reportToDate ? new Date(reportToDate) : null;

      if (from) {
        from.setHours(0, 0, 0, 0);
        if (prDate < from) return false;
      }
      if (to) {
        to.setHours(23, 59, 59, 999);
        if (prDate > to) return false;
      }
      if (reportSelectedEmp !== 'all' && pr.employeeId.toString() !== reportSelectedEmp) return false;
      return true;
    });

    return employees.map(emp => {
      const empPayrolls = filteredPayrolls.filter(pr => pr.employeeId === emp.id);
      if (empPayrolls.length === 0) return null;

      const totalHours = empPayrolls.reduce((sum, pr) => sum + pr.totalHours, 0);
      const totalDays = empPayrolls.reduce((sum, pr) => sum + pr.daysWorked, 0);
      const totalGross = empPayrolls.reduce((sum, pr) => sum + pr.grossPay, 0);
      const totalDeductions = empPayrolls.reduce((sum, pr) => sum + (pr.cashAdvance + pr.sssDeduction + pr.pagIbigDeduct + pr.philhealthDeduct + pr.tax), 0);
      const totalNet = empPayrolls.reduce((sum, pr) => sum + pr.netPay, 0);
      
      const requiredHrs = totalDays * 8;
      const otHours = Math.max(0, totalHours - requiredHrs);

      return { emp, totalHours, totalDays, otHours, totalGross, totalDeductions, totalNet, count: empPayrolls.length };
    }).filter(Boolean) as SummaryReportRow[];
  };

  const handleGenerateReport = () => {
    setIsReportModalOpen(true);
  };

  // --- UI HELPERS ---
  const getStatusStyle = (status: string) => {
    switch(status) {
      case 'Regular': return 'bg-blue-50 text-blue-700 ring-blue-600/20';
      case 'Contractual': return 'bg-slate-100 text-slate-700 ring-slate-600/20';
      case 'Probationary': return 'bg-sky-50 text-sky-700 ring-sky-600/20';
      default: return 'bg-slate-50 text-slate-700 ring-slate-600/20';
    }
  };

  const filteredEmployees = employees.filter(emp => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const fullName = `${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}`.toLowerCase();
    return fullName.includes(query) || emp.employmentStatus.toLowerCase().includes(query) || (emp.bankAccount && emp.bankAccount.includes(query));
  });

  const filteredAttendanceEmployees = employees.filter(emp => {
    if (!attendanceSearchQuery) return true;
    const query = attendanceSearchQuery.toLowerCase();
    const fullName = `${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}`.toLowerCase();
    return fullName.includes(query);
  });

  // Specifically filter Active Employees for the Compute Salary list
  const filteredActiveEmployees = employees.filter(emp => {
    if (!payrollActiveSearchQuery) return true;
    const query = payrollActiveSearchQuery.toLowerCase();
    const fullName = `${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}`.toLowerCase();
    return fullName.includes(query);
  });

  // Specifically filter Saved Payroll History
  const filteredSavedPayrolls = payrolls.filter(pr => {
    if (!payrollHistorySearchQuery) return true;
    const query = payrollHistorySearchQuery.toLowerCase();
    const emp = employees.find(e => e.id === Number(pr.employeeId));
    const fullName = emp ? `${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}`.toLowerCase() : '';
    const dateStr = formatMDY(pr.createdAt).toLowerCase();
    return fullName.includes(query) || dateStr.includes(query);
  });

  const getPageTitle = () => {
    switch(activeTab) {
      case 'dashboard': return 'System Overview';
      case 'list': return 'Personnel Directory';
      case 'add': return 'Register Employee';
      case 'attendance': return 'Attendance Logs';
      case 'payroll': return 'Payroll Engine';
      case 'tax': return 'Tax Reports';
      case 'report': return 'Summary Reports';
      case 'users': return 'Manage System Users';
      default: return 'Admin Panel';
    }
  };

const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminUsername || !newAdminPassword) return;
    setIsSaving(true);
    
    try {
      const response = await fetch(`${API_BASE_URL}/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newAdminUsername.trim(), password: newAdminPassword })
      });
      
      if (!response.ok) throw new Error("Username already exists");
      
      await fetchAdmins(); // Refresh the list from the database
      setNewAdminUsername('');
      setNewAdminPassword('');
      showToast("New administrator added successfully!", "success");
    } catch (error) {
      showToast("Failed to add admin. Username might exist.", "error");
    } finally {
      setIsSaving(false);
    }
  };

const handleDeleteAdmin = async (id: number, role: string) => {
    if (role === 'Super Admin') {
      const superAdminCount = adminUsers.filter(u => u.role === 'Super Admin').length;
      if (superAdminCount <= 1) {
        showToast("Action Denied: Cannot delete the last Super Admin.", "error");
        return;
      }
    }
    
    if (window.confirm("Are you sure you want to permanently remove this user from the database?")) {
      try {
        const response = await fetch(`${API_BASE_URL}/admins/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error();
        await fetchAdmins(); 
        showToast("Administrator removed successfully.", "success");
      } catch (error) {
        showToast("Failed to delete administrator.", "error");
      }
    }
  };

const handleUpdateRole = async (id: number, newRole: string) => {
    const user = adminUsers.find(u => u.id === id);
    if (user?.role === 'Super Admin' && newRole !== 'Super Admin') {
      const superAdminCount = adminUsers.filter(u => u.role === 'Super Admin').length;
      if (superAdminCount <= 1) {
        showToast("Action Denied: System requires at least one Super Admin.", "error");
        return;
      }
    }

    // Optimistic UI update
    setAdminUsers(adminUsers.map(u => u.id === id ? { ...u, role: newRole } : u));
    
    try {
      await fetch(`${API_BASE_URL}/admins/${id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      showToast(`User role changed to ${newRole}`, "success");
    } catch (e) {
      showToast("Failed to update role.", "error");
      fetchAdmins(); // Revert if failed
    }
  };

const handleResetPassword = async (id: number) => {
    if (!newResetPassword) {
      showToast("Please type a new password first.", "error");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/admins/${id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newResetPassword })
      });

      if (!response.ok) throw new Error("Failed to reset password in database.");

      showToast("User's password has been securely reset!", "success");
      setEditingPasswordId(null);
      setNewResetPassword('');
    } catch (error) {
      showToast("Failed to reset password.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // --- LOGIN SCREEN RENDER ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4 selection:bg-blue-100 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="p-8 text-center bg-blue-700 border-b border-slate-200">
            <h1 className="text-2xl font-extrabold text-white tracking-wider uppercase">Olten Trading Corp.</h1>
            <p className="text-blue-200 font-medium text-sm mt-2">Secure Payroll Engine v2.0</p>
          </div>
          
          <div className="p-8">
            <form onSubmit={handleLogin} className="flex flex-col gap-5">
              {loginError && (
                <div className="bg-rose-50 text-rose-600 text-sm font-bold p-3 rounded-lg border border-rose-200 text-center">
                  {loginError}
                </div>
              )}
              
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wide">Database Username</label>
                <input 
                  type="text" 
                  required 
                  value={loginUsername} 
                  onChange={(e) => setLoginUsername(e.target.value)} 
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none transition-all text-slate-800 focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 font-medium shadow-sm"
                  placeholder="Enter administrator ID"
                />
              </div>

              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wide">Secure Password</label>
                <input 
                  type="password" 
                  required 
                  value={loginPassword} 
                  onChange={(e) => setLoginPassword(e.target.value)} 
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none transition-all text-slate-800 focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 font-medium shadow-sm"
                  placeholder="••••••••"
                />
              </div>

              <button 
                type="submit" 
                disabled={isLoggingIn} 
                className="mt-4 w-full py-3.5 px-4 rounded-xl font-bold text-white bg-blue-700 hover:bg-blue-800 transition-colors shadow-md disabled:opacity-50 tracking-wide uppercase text-sm"
              >
                {isLoggingIn ? 'Authenticating...' : 'Access Database'}
              </button>
            </form>
          </div>
          <div className="bg-slate-50 p-4 text-center border-t border-slate-200">
            <p className="text-xs text-slate-400 font-medium">Session is strictly memory-bound. Refreshing will require re-authentication.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden print:h-auto print:block selection:bg-blue-100">
      
      {/* --- FOOLPROOF SINGLE-PAGE PRINT CSS --- */}
      <style>{`
        @media print {
          @page { size: auto; margin: 10mm; }
          html, body, #root { 
            height: 100% !important; 
            max-height: 100vh !important;
            overflow: hidden !important; 
            background: white !important; 
            margin: 0 !important; 
            padding: 0 !important; 
          }
          ::-webkit-scrollbar { display: none; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-hidden {
            display: none !important;
            height: 0 !important;
            width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            position: absolute !important;
          }
          .print-modal-release {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            background: transparent !important;
            padding: 0 !important;
            display: block !important;
            z-index: 1 !important;
            height: auto !important;
            width: 100% !important;
          }
          .print-modal-box {
            box-shadow: none !important;
            max-width: none !important;
            max-height: none !important;
            border: none !important;
            border-radius: 0 !important;
            display: block !important;
            overflow: visible !important;
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-modal-content {
            padding: 0 !important;
            background: transparent !important;
            display: block !important;
            overflow: visible !important;
            width: 100% !important;
          }
          #payslip-print-area, #report-print-area {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
            width: 100% !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* --- TOAST --- */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-right-8 slide-in-from-bottom-2 fade-in duration-300 ease-out border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'} print-hidden`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
          {toast.message}
        </div>
      )}

      {/* --- EDIT EMPLOYEE MODAL --- */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm print-hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-200 bg-slate-50/50 shrink-0">
              <div><h2 className="text-xl font-bold text-blue-950">Edit Employee Record</h2></div>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2">✕</button>
            </div>
            <div className="overflow-y-auto p-6">
              <form onSubmit={handleSubmitEmployee} className="flex flex-col gap-6">
                <EmployeeFormFields formData={formData} handleChange={handleFormattedChange} />
                <div className="flex gap-3 mt-6 pt-6 border-t border-slate-200 shrink-0">
                  <button type="submit" disabled={isSaving} className="flex-1 py-3 bg-blue-700 text-white rounded-xl font-semibold shadow-sm">{isSaving ? "Saving..." : "Save Changes"}</button>
                  <button type="button" onClick={() => setIsEditModalOpen(false)} className="py-3 px-8 bg-white border border-slate-300 text-slate-700 rounded-xl font-semibold hover:bg-slate-50">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MONTHLY LOGS MODAL --- */}
      {monthLogsModalEmp && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print-hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-200 bg-indigo-50/50 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-indigo-950">
                  Monthly Logs: {monthLogsModalEmp.firstName} {monthLogsModalEmp.lastName}
                </h2>
                <p className="text-sm text-indigo-700 font-medium mt-1">
                  {formatMonthYear(attendanceMonth)}
                </p>
              </div>
              <button onClick={() => setMonthLogsModalEmp(null)} className="text-slate-400 hover:text-slate-600 p-2">✕</button>
            </div>
            <div className="overflow-y-auto p-6 bg-slate-50 flex flex-col gap-3">
              {(() => {
                const monthLogs = attendances
                  .filter(a => Number(a.employeeId) === monthLogsModalEmp.id && a.date && a.date.split('T')[0].startsWith(attendanceMonth))
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                if (monthLogs.length === 0) {
                  return <div className="text-center py-8 text-slate-500 italic">No logs found for this month.</div>;
                }

                return monthLogs.map(log => {
                  const isLeave = !log.timeIn.includes(':');
                  const shiftDetails = !isLeave ? calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd) : { reg: 0, ot: 0, earlyOt: 0, lateOt: 0, total: 0 };
                  
                  return (
                    <div key={log.id} className="flex items-center justify-between gap-3 text-sm border border-slate-200 bg-white rounded-xl px-5 py-3.5 shadow-sm w-full group/log whitespace-nowrap hover:border-indigo-300 transition-colors">
                      <span className="font-bold text-slate-700 w-[95px]">{formatMDY(log.date)}</span>
                      <span className="text-slate-200">|</span>
                      <span className="font-mono font-bold text-indigo-900 min-w-[150px]">
                        {isLeave 
                          ? `${log.timeIn} (${log.timeOut})${log.reason ? ` - ${log.reason}` : ''}` 
                          : `${format12Hour(log.timeIn)} - ${format12Hour(log.timeOut)}`}
                      </span>
                      <span className="text-slate-200">|</span>
                      
                      <span className="font-bold text-indigo-600 w-[70px]">Reg: {formatDecToHM(shiftDetails.reg)}</span>
                      <span className="text-slate-200">|</span>
                      {shiftDetails.earlyOt > 0 ? (
                        <span className="font-bold text-amber-600 w-[70px]" title="Early Hours">Early: {formatDecToHM(shiftDetails.earlyOt)}</span>
                      ) : (
                        <span className="font-medium text-slate-400 w-[70px]">Early: --</span>
                      )}
                      <span className="text-slate-200">|</span>
                      {shiftDetails.lateOt > 0 ? (
                        <span className="font-bold text-amber-600 w-[75px]" title="Late Overtime">Late OT: {formatDecToHM(shiftDetails.lateOt)}</span>
                      ) : (
                        <span className="font-medium text-slate-400 w-[75px]">Late OT: --</span>
                      )}
                      <span className="text-slate-200">|</span>

                      <span className={`font-bold w-[75px] text-right ${shiftDetails.total > 0 || log.hours > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isLeave ? log.hours.toFixed(2) : shiftDetails.total.toFixed(2)} hrs
                      </span>
                      <div className="flex items-center ml-2 border-l border-slate-200 pl-4">
                        <button onClick={() => { openEditLogModal(log); }} className="text-indigo-500 hover:text-indigo-700 font-bold transition-colors mr-4 text-xs uppercase bg-indigo-50 px-3 py-1.5 rounded-lg" title="Edit Log">Edit</button>
                        <button onClick={() => deleteAttendance(log.id)} className="text-slate-400 hover:text-red-600 font-bold transition-colors text-lg" title="Remove Log">✕</button>
                      </div>
                    </div>
                  )
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* --- EDIT ATTENDANCE MODAL --- */}
      {editingLog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm print-hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="flex justify-between items-center p-5 border-b border-slate-200 bg-indigo-50/50 shrink-0">
              <h2 className="text-lg font-bold text-indigo-950">Edit Log for {formatMDY(editingLog.date)}</h2>
              <button onClick={() => setEditingLog(null)} className="text-slate-400 hover:text-slate-600 p-1">✕</button>
            </div>
            <div className="p-6 flex flex-col gap-5">
              
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-medium text-slate-600">Shift Date</label>
                <div className="relative w-full">
                  <div className="px-4 py-2.5 border rounded-lg text-sm bg-white flex items-center justify-between border-slate-300 text-slate-800 shadow-sm pointer-events-none">
                    <span>{formatMDY(editLogForm.date)}</span>
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </div>
                  <input type="date" value={editLogForm.date} onChange={(e) => setEditLogForm({...editLogForm, date: e.target.value})} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-medium text-slate-600">Log Type</label>
                <select value={editLogForm.type} onChange={(e) => setEditLogForm({...editLogForm, type: e.target.value})} className="px-4 py-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 shadow-sm">
                  <option value="regular">Standard Office Shift</option>
                  <option value="paid_leave">Paid Leave (8 hrs)</option>
                  <option value="unpaid_leave">Unpaid Leave (0 hrs)</option>
                </select>
              </div>

              {editLogForm.type === 'regular' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5 w-full">
                    <label className="text-sm font-medium text-slate-600">Time In</label>
                    <TimePicker12h value={editLogForm.timeIn} onChange={(val: string) => setEditLogForm({...editLogForm, timeIn: val})} />
                  </div>
                  <div className="flex flex-col gap-1.5 w-full">
                    <label className="text-sm font-medium text-slate-600">Time Out</label>
                    <TimePicker12h value={editLogForm.timeOut} onChange={(val: string) => setEditLogForm({...editLogForm, timeOut: val})} />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 w-full">
                  <label className="text-sm font-medium text-slate-600">Reason (Optional)</label>
                  <input type="text" placeholder="e.g. Sick Leave" value={editLogForm.reason} onChange={(e) => setEditLogForm({...editLogForm, reason: e.target.value})} className="px-4 py-2.5 border rounded-lg text-sm bg-white outline-none focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 shadow-sm" />
                </div>
              )}

              <button onClick={submitEditLog} disabled={isSaving} className="mt-2 w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 shrink-0">
                {isSaving ? "Updating..." : "Update Attendance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- GENERATE PAYSLIP MODAL (APP-THEMED EXCEL TEMPLATE & PRINT READY) --- */}
      {selectedPayslip && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print-modal-release">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col overflow-hidden relative print-modal-box">
            
            {/* Top Bar - Hidden on Print */}
            <div className="flex justify-between items-center p-4 border-b border-slate-200 bg-slate-50 z-10 sticky top-0 no-print shrink-0">
              <h2 className="font-bold text-slate-800">Generated Payslip</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm font-bold text-sm hover:bg-blue-700 flex items-center gap-2 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  Print Slip
                </button>
                <button onClick={() => setSelectedPayslip(null)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg shadow-sm font-bold text-sm hover:bg-slate-300 transition-colors">Close</button>
              </div>
            </div>

            {/* Scrolling Printable Canvas */}
            <div className="overflow-y-auto p-4 sm:p-10 bg-gray-50 flex justify-center items-start print-modal-content">
              
              {/* --- ACTUAL PAYSLIP TEMPLATE --- */}
              <div id="payslip-print-area" className="bg-white w-full max-w-4xl font-sans text-black">
                {(() => {
                  const rec = selectedPayslip.record;
                  const emp = selectedPayslip.emp;
                  
               // Use ONLY the saved snapshot data from the database. 
                  // Do not fetch live attendances so historical slips never change!
                  const baseSalary = emp.baseRate;
                  const days = rec.daysWorked || 0;
                  const ratePerDay = days > 0 ? baseSalary / days : 0;
                  const ratePerHour = ratePerDay / 8;
                  const requiredHrs = days * 8;
                  
                  // Calculate OT strictly based on the saved total hours snapshot
                  const otHours = Math.max(0, rec.totalHours - requiredHrs);
                  const otPay = otHours * (ratePerHour * 1.25); 

                  const regularHoursWorked = rec.totalHours - otHours;
                  let undertimeDeduction = 0;
                  if (regularHoursWorked < requiredHrs) {
                    undertimeDeduction = (requiredHrs - regularHoursWorked) * ratePerHour;
                  }

                  const regularPay = baseSalary - undertimeDeduction;
                  const totalEarnings = regularPay + otPay; 
                  const totalDeductionsCalc = rec.cashAdvance + rec.sssDeduction + rec.pagIbigDeduct + rec.philhealthDeduct + rec.tax;

                  return (
                    <table className="w-full text-left border-collapse border border-slate-300 text-[11px] sm:text-xs text-slate-700 bg-white shadow-sm print:shadow-none">
                      <colgroup>
                        <col className="w-[18%]" />
                        <col className="w-[18%]" />
                        <col className="w-[4%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                      </colgroup>
                      <tbody>
                        <tr>
                          <td colSpan={5} className="border border-slate-300 bg-indigo-600 text-white font-bold text-center py-2.5 text-xs uppercase tracking-widest">Olten TRADING CORP.</td>
                          <td colSpan={4} className="border border-slate-300 border-l-0 bg-white"></td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="border border-slate-300 bg-slate-100 font-bold px-3 py-2 uppercase text-slate-800">
                            <span className="text-[10px] text-slate-500">Employee's Name :</span> <span className="ml-2 font-bold text-sm text-slate-900">{emp.lastName}, {emp.firstName}</span>
                          </td>
                          <td colSpan={4} className="border border-slate-300 bg-slate-100 font-bold px-3 py-2 text-center uppercase text-slate-800">
                            Date: {formatMDY(rec.createdAt)} ({rec.daysWorked} WORKING DAYS)
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="border border-slate-300 text-center font-bold py-1.5 bg-slate-50 uppercase text-slate-600 tracking-wider">Earnings</td>
                          <td colSpan={4} className="border border-slate-300 px-3 py-1.5 font-bold bg-slate-50 text-slate-600">
                            NO. OF DAYS PRESENT: <span className="font-bold text-indigo-700 ml-1">{rec.daysWorked}</span>
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium text-slate-800">BASIC SALARY</td>
                          <td className="border border-slate-300 px-1 text-center font-medium text-slate-400">₱</td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{formatMoney(baseSalary)}</td>
                          <td colSpan={4} rowSpan={11} className="border border-slate-300 bg-white"></td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE PER HOUR</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatMoney(ratePerHour)}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE PER DAY</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatMoney(ratePerDay)}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">TOTAL HOURS</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatDecToHM(rec.totalHours)}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">REQUIRED NO.OF HOURS</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatDecToHM(requiredHrs)}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-bold text-slate-800">REGULAR PAY</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{formatMoney(regularPay)}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">OT HOURS</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{otHours > 0 ? formatDecToHM(otHours) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE FOR OT</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{otHours > 0 ? formatMoney(ratePerHour * 1.25) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-bold text-slate-800">OT PAY</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{otPay > 0 ? formatMoney(otPay) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">HOLIDAY</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">SUNDAY</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="border border-slate-300 bg-white border-t-0"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1.5 text-right font-bold text-slate-800 bg-slate-50 uppercase text-[10px] tracking-wider border-l-0">Total Earnings:</td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono font-bold text-emerald-700 bg-emerald-50 border-b-2 border-slate-400 text-sm">{formatMoney(totalEarnings)}</td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="border border-slate-300 text-center font-bold py-1.5 bg-slate-50 text-slate-600 uppercase tracking-wider">Deductions</td>
                          <td colSpan={4} rowSpan={9} className="border border-slate-300 bg-white"></td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">Advances</td>
                          <td className="border border-slate-300 px-1 text-center font-medium text-slate-400">₱</td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{rec.cashAdvance > 0 ? formatMoney(rec.cashAdvance) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">SSS</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{rec.sssDeduction > 0 ? formatMoney(rec.sssDeduction) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">SSS PROVIDENT FUND</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">Philhealth</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{rec.philhealthDeduct > 0 ? formatMoney(rec.philhealthDeduct) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">Pag-IBIG</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{rec.pagIbigDeduct > 0 ? formatMoney(rec.pagIbigDeduct) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">Pag-IBIG MP Loan</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{rec.pagIbigLoan > 0 ? formatMoney(rec.pagIbigLoan) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">Pag-IBIG Housing Loan</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{rec.pagIbigHousingLoan > 0 ? formatMoney(rec.pagIbigHousingLoan) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium uppercase">Tax</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{rec.tax > 0 ? formatMoney(rec.tax) : '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">Provident Cont.</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">Provident Loan</td>
                          <td className="border border-slate-300"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="border border-slate-300 bg-white border-t-0"></td>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1.5 text-right font-bold text-slate-800 bg-slate-50 uppercase text-[10px] tracking-wider border-l-0">Total Deductions:</td>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1.5 text-right font-mono font-bold text-rose-700 bg-rose-50 border-b-2 border-slate-400 text-sm">{formatMoney(totalDeductionsCalc)}</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 font-bold text-slate-600 bg-slate-50">Outstanding:</td>
                          <td colSpan={3} className="border border-slate-300 bg-slate-50"></td>
                          <td colSpan={4} rowSpan={3} className="border border-slate-300 bg-white"></td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 pl-6 font-medium">Cash Advances</td>
                          <td colSpan={3} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td>
                        </tr>
                        <tr>
                          <td colSpan={2} className="border border-slate-300 px-3 py-1 pl-6 font-medium">Provident Loan</td>
                          <td colSpan={3} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="border border-slate-300 px-3 py-3 text-slate-600">Prepared by: <span className="ml-2 uppercase font-bold text-slate-800 text-[10px]">SYSTEM ADMIN</span></td>
                          <td colSpan={2} className="border border-slate-300 font-bold text-right px-3 text-emerald-800 bg-emerald-50 text-[10px] uppercase">Net Earnings:</td>
                          <td colSpan={4} className="border-4 border-emerald-500 px-3 text-right font-mono font-black text-[15px] bg-emerald-50 text-emerald-900 shadow-inner">{formatMoney(rec.netPay)}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="border border-slate-300 px-3 py-2 text-slate-600">Checked by: <span className="ml-2 uppercase font-bold text-slate-800 text-[10px]">{emp.firstName} {emp.lastName}</span></td>
                          <td colSpan={2} className="border-b border-slate-300 text-right px-3 py-1 text-sm font-bold text-slate-800 bg-slate-50">{formatMoney(rec.netPay)}</td>
                          <td colSpan={4} className="border border-slate-300 border-t-0 bg-white px-4 pb-2 text-center align-bottom h-16">
                            <div className="w-48 mx-auto border-b border-slate-800 mb-1 mt-6"></div>
                            <div className="text-[10px] font-bold text-slate-600 uppercase">Received By (Signature)</div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- SUMMARY REPORT MODAL (PRINT READY) --- */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print-modal-release">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[95vh] flex flex-col overflow-hidden relative print-modal-box">
            
            <div className="flex justify-between items-center p-4 border-b border-slate-200 bg-slate-50 z-10 sticky top-0 no-print shrink-0">
              <h2 className="font-bold text-slate-800">Summary Report Output</h2>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-amber-600 text-white px-4 py-2 rounded-lg shadow-sm font-bold text-sm hover:bg-amber-700 flex items-center gap-2 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  Print Report
                </button>
                <button onClick={() => setIsReportModalOpen(false)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg shadow-sm font-bold text-sm hover:bg-slate-300 transition-colors">Close</button>
              </div>
            </div>

            <div className="overflow-y-auto p-4 sm:p-10 bg-white flex justify-center items-start print-modal-content">
              <div id="report-print-area" className="bg-white w-full max-w-6xl font-sans text-black">
                {(() => {
                  const reportData = getFilteredReportData();
                  
                  const grandGross = reportData.reduce((s, r) => s + r.totalGross, 0);
                  const grandDed = reportData.reduce((s, r) => s + r.totalDeductions, 0);
                  const grandNet = reportData.reduce((s, r) => s + r.totalNet, 0);

                  return (
                    <div className="w-full">
                      <div className="text-center mb-6">
                        <h1 className="text-xl font-bold uppercase tracking-wider text-slate-900">Olten TRADING CORP.</h1>
                        <h2 className="text-md font-semibold text-slate-700 mt-1">PAYROLL SUMMARY REPORT</h2>
                        <p className="text-sm text-slate-500 mt-2">
                          Date Range: <span className="font-bold text-slate-800">{reportFromDate ? formatMDY(reportFromDate) : 'Beginning'}</span> to <span className="font-bold text-slate-800">{reportToDate ? formatMDY(reportToDate) : 'Latest'}</span>
                        </p>
                      </div>

                      {reportData.length === 0 ? (
                        <div className="py-12 text-center text-slate-500 font-medium border border-slate-200 bg-slate-50">No payroll records found for the selected criteria.</div>
                      ) : (
                        <table className="w-full text-left border-collapse border border-slate-400 text-xs sm:text-sm text-slate-800">
                          <thead className="bg-slate-100 border-b-2 border-slate-400">
                            <tr>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase">Emp ID</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase">Employee Name</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-center">Cutoffs</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-right">Days Wkd</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-right">Logged Hrs</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-right">OT Hrs</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-right text-emerald-800 bg-emerald-50">Gross Pay</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-right text-rose-800 bg-rose-50">Total Ded.</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-right text-indigo-900 bg-indigo-50">Net Pay</th>
                              <th className="py-2.5 px-3 border border-slate-300 font-bold uppercase text-right text-amber-900 bg-amber-50">Advance Bal.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.map((row) => (
                              <tr key={row.emp.id} className="hover:bg-slate-50">
                                <td className="py-2 px-3 border border-slate-300 font-mono text-slate-500">{row.emp.id.toString().padStart(4, '0')}</td>
                                <td className="py-2 px-3 border border-slate-300 font-bold uppercase text-slate-700">{row.emp.lastName}, {row.emp.firstName}</td>
                                <td className="py-2 px-3 border border-slate-300 text-center font-medium">{row.count}</td>
                                <td className="py-2 px-3 border border-slate-300 text-right font-mono">{formatMoney(row.totalDays)}</td>
                                <td className="py-2 px-3 border border-slate-300 text-right font-mono">{formatDecToHM(row.totalHours)}</td>
                                <td className="py-2 px-3 border border-slate-300 text-right font-mono">{formatDecToHM(row.otHours)}</td>
                                <td className="py-2 px-3 border border-slate-300 text-right font-mono font-semibold text-emerald-700 bg-emerald-50/50">{formatMoney(row.totalGross)}</td>
                                <td className="py-2 px-3 border border-slate-300 text-right font-mono font-semibold text-rose-700 bg-rose-50/50">{formatMoney(row.totalDeductions)}</td>
                                <td className="py-2 px-3 border border-slate-300 text-right font-mono font-bold text-indigo-900 bg-indigo-50/50">{formatMoney(row.totalNet)}</td>
                                <td className="py-2 px-3 border border-slate-300 text-right font-mono font-bold text-amber-700 bg-amber-50/50">{(row.emp.cashAdvanceBalance || 0) > 0 ? formatMoney(row.emp.cashAdvanceBalance) : '--'}</td>
                              </tr>
                            ))}
                            {/* Grand Totals */}
                            <tr className="bg-slate-200 border-t-2 border-slate-500 font-bold">
                              <td colSpan={6} className="py-3 px-3 border border-slate-400 text-right uppercase tracking-wider text-slate-800">Grand Total:</td>
                              <td className="py-3 px-3 border border-slate-400 text-right font-mono text-emerald-800 text-sm">{formatMoney(grandGross)}</td>
                              <td className="py-3 px-3 border border-slate-400 text-right font-mono text-rose-800 text-sm">{formatMoney(grandDed)}</td>
                              <td className="py-3 px-3 border border-slate-400 text-right font-mono font-black text-indigo-950 text-[15px]">{formatMoney(grandNet)}</td>
                              <td className="py-3 px-3 border border-slate-400 bg-slate-200"></td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- PAYROLL MODAL (COMPUTE) --- */}
      {isPayrollModalOpen && activeEmployee && computed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm print-hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-200 bg-emerald-50/50 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-emerald-950">Compute Payroll: {activeEmployee.firstName} {activeEmployee.lastName}</h2>
                <p className="text-sm text-emerald-700 font-mono mt-1">Basic Salary: ₱{activeEmployee.baseRate.toLocaleString()} / Cutoff</p>
              </div>
              <button onClick={() => setIsPayrollModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2">✕</button>
            </div>
            
            <div className="overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              <div className="space-y-6">
                <h3 className="font-bold text-slate-800 border-b pb-2">Time & Attendance Settings</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <InputField type="number" step="0.1" label="Days in Cutoff" value={payrollData.daysWorked} onChange={(e: any) => setPayrollData({...payrollData, daysWorked: e.target.value})} />
                  <InputField type="text" disabled label="Total Logged Hours" value={formatDecToHM(computed.totalHoursWorked)} />
                  <InputField type="text" disabled label="Total OT Hours" value={formatDecToHM(computed.otHrs)} />
                </div>
                
                <h3 className="font-bold text-slate-800 border-b pb-2 mt-6">Deductions</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col w-full">
                    <InputField type="number" step="0.01" label="Cash Adv. Deduction" value={payrollData.cashAdvance} onChange={(e: any) => setPayrollData({...payrollData, cashAdvance: e.target.value})} />
                    {(activeEmployee?.cashAdvanceBalance || 0) > 0 && (
                      <span className="text-[11px] font-bold text-amber-600 mt-1.5 ml-1">
                        Rem. Bal: ₱{formatMoney(Math.max(0, (activeEmployee!.cashAdvanceBalance || 0) - (parseFloat(payrollData.cashAdvance) || 0)))}
                      </span>
                    )}
                  </div>
                  <InputField type="number" step="0.01" label="SSS" value={payrollData.sss} onChange={(e: any) => setPayrollData({...payrollData, sss: e.target.value})} />
                  <InputField type="number" step="0.01" label="Pag-IBIG" value={payrollData.pagIbig} onChange={(e: any) => setPayrollData({...payrollData, pagIbig: e.target.value})} />
                  <InputField type="number" step="0.01" label="PhilHealth" value={payrollData.philhealth} onChange={(e: any) => setPayrollData({...payrollData, philhealth: e.target.value})} />
                  <InputField type="number" step="0.01" label="PhilHealth" value={payrollData.philhealth} onChange={(e: any) => setPayrollData({...payrollData, philhealth: e.target.value})} />
                  <InputField type="number" step="0.01" label="Pag-IBIG MP Loan" value={payrollData.pagIbigLoan} onChange={(e: any) => setPayrollData({...payrollData, pagIbigLoan: e.target.value})} />
                  <InputField type="number" step="0.01" label="Pag-IBIG Housing Loan" value={payrollData.pagIbigHousingLoan} onChange={(e: any) => setPayrollData({...payrollData, pagIbigHousingLoan: e.target.value})} />
                  <div className="col-span-2 mt-2 p-4 border border-indigo-100 bg-white rounded-xl shadow-sm">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={payrollData.isDeclared} onChange={(e) => setPayrollData({...payrollData, isDeclared: e.target.checked})} className="w-5 h-5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-600"/>
                      <div>
                        <span className="text-sm font-bold text-slate-800 block">Officially Declared Salary</span>
                        <span className="text-xs text-slate-500">Automatically computes BIR withholding tax based on semi-monthly brackets.</span>
                      </div>
                    </label>
                    {payrollData.isDeclared && (
                      <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
                        <span className="text-sm font-semibold text-slate-600">Calculated Withholding Tax:</span>
                        <span className="text-sm font-mono font-bold text-rose-600">₱{computed.autoTax.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 flex flex-col">
                <h3 className="font-bold text-slate-800 border-b pb-2 mb-4">Calculation Breakdown</h3>
                <div className="space-y-3 text-sm flex-1">
                  <div className="flex justify-between"><span className="text-slate-500">Rate per Day:</span> <span className="font-mono">₱{computed.ratePerDay.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Rate per Hour:</span> <span className="font-mono">₱{computed.ratePerHour.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Required Hours:</span> <span className="font-mono">{formatDecToHM(computed.requiredHrs)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Valid Logged Hours:</span> <span className="font-mono">{formatDecToHM(computed.totalHoursWorked)}</span></div>
                  
                  {computed.otHrs > 0 && (
                    <div className="flex justify-between font-medium text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-100 mt-2 mb-2">
                      <span>Total Overtime ({formatDecToHM(computed.otHrs)} @ 125%):</span> 
                      <span className="font-mono">+ ₱{computed.otPay.toFixed(2)}</span>
                    </div>
                  )}

                  {computed.undertimeDeduction > 0 && (
                    <div className="flex justify-between font-medium text-rose-700 bg-rose-50 p-2 rounded">
                      <span>Lates/Undertime Deduction:</span> 
                      <span className="font-mono">- ₱{computed.undertimeDeduction.toFixed(2)}</span>
                    </div>
                  )}

                  <hr className="my-2" />
                  <div className="flex justify-between font-bold text-slate-800"><span>Gross Pay:</span> <span className="font-mono text-base sm:text-lg">₱{computed.grossPay.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                  
                  {computed.autoTax > 0 && (
                    <div className="flex justify-between font-medium text-rose-700 bg-rose-50 p-2 rounded border border-rose-100">
                      <span>Withholding Tax (Auto):</span> 
                      <span className="font-mono">- ₱{computed.autoTax.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-rose-600"><span>Total Deductions:</span> <span className="font-mono">- ₱{computed.totalDeductions.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                </div>

                <div className="mt-6 p-4 bg-emerald-950 text-white rounded-xl shadow-inner text-center overflow-hidden shrink-0">
                  <p className="text-emerald-200 text-sm font-semibold uppercase tracking-wider mb-1">Final Net Pay</p>
                  <p className="text-4xl font-mono font-bold break-all">₱{computed.netPay.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>

                <button onClick={savePayrollToDatabase} disabled={isSaving} className="mt-4 w-full py-3 sm:py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white rounded-xl font-bold shadow-sm transition-colors text-sm sm:text-base shrink-0">
                  {isSaving ? "Saving to Database..." : "Close & Save Payroll"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

{/* ========================================================= */}
      {/* SIDEBAR NAVIGATION */}
      {/* ========================================================= */}
      <aside className="w-64 bg-slate-900 text-slate-300 hidden md:flex flex-col flex-shrink-0 print-hidden border-r border-slate-800 shadow-2xl relative z-20">
        <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-slate-950">
          <h1 className="text-xl font-black text-white tracking-wider uppercase">Olten<span className="text-blue-500">Admin</span></h1>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <div className="px-3 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Main Menu</div>
          <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
             Dashboard Overview
          </button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Personnel</div>
          <button onClick={() => setActiveTab('list')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'list' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
             Directory List
          </button>
          <button onClick={() => { setActiveTab('add'); setFormData(initialFormState); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'add' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
             Register New
          </button>
          <button onClick={() => setActiveTab('attendance')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'attendance' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
             Log Attendance
          </button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Finance</div>
          <button onClick={() => setActiveTab('payroll')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'payroll' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
             Compute Payroll
          </button>
          <button onClick={() => setActiveTab('tax')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'tax' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
             Tax Reports
          </button>
          <button onClick={() => setActiveTab('report')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'report' ? 'bg-amber-600 text-white shadow-md shadow-amber-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>
             Summary Reports
          </button>

          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Settings</div>
          <button onClick={() => setActiveTab('users')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'users' ? 'bg-slate-700 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
             Manage System Users
          </button>
        </div>
      </aside>

      {/* ========================================================= */}
      {/* MAIN WORKSPACE CANVAS */}
      {/* ========================================================= */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden print:h-auto print:block">
        
        {/* TOP HEADER */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 shadow-sm relative z-10 print-hidden shrink-0">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-blue-950 tracking-tight">{getPageTitle()}</h2>
            <div className="text-xs font-semibold text-slate-400 mt-1 flex items-center gap-2">
              <span>Admin Panel</span> <span>/</span> <span className="text-blue-600">{getPageTitle()}</span>
            </div>
          </div>
          <button onClick={handleLogout} className="px-6 py-2 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 rounded-lg text-sm font-bold transition-colors shadow-sm border border-slate-200">
            Logout
          </button>
        </header>

        {/* SCROLLABLE MAIN CONTENT */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative print:p-0 print:overflow-visible">
          <div className="max-w-[1400px] mx-auto space-y-6 sm:space-y-8">

        {/* DASHBOARD TAB */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6 print-hidden">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Employees</p>
                    <h3 className="text-4xl font-black text-blue-950 mt-1">{employees.length}</h3>
                    <p className="text-sm text-slate-500 font-medium mt-4"><span className="text-emerald-500 font-bold">Active</span> in personnel directory</p>
                  </div>
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Net Processed</p>
                    <h3 className="text-4xl font-black text-emerald-900 mt-1">₱{formatMoney(payrolls.reduce((sum, p) => sum + p.netPay, 0))}</h3>
                    <p className="text-sm text-slate-500 font-medium mt-4">Across <span className="font-bold text-emerald-600">{payrolls.length}</span> historical records</p>
                  </div>
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Shift Logs</p>
                    <h3 className="text-4xl font-black text-indigo-950 mt-1">{attendances.length}</h3>
                    <p className="text-sm text-slate-500 font-medium mt-4">Stored attendance records</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-800 mb-4">Quick Actions</h3>
                    <div className="space-y-3">
                      <button onClick={() => setActiveTab('attendance')} className="w-full text-left font-bold p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 transition-all">Log Today's Attendance</button>
                      <button onClick={() => setActiveTab('payroll')} className="w-full text-left font-bold p-4 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-700 transition-all">Process New Payroll</button>
                      <button onClick={() => { setActiveTab('add'); setFormData(initialFormState); }} className="w-full text-left font-bold p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 transition-all">Register New Employee</button>
                    </div>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm text-slate-300 flex flex-col relative overflow-hidden">
                    <h3 className="text-lg font-bold text-white mb-4 relative z-10">System Configuration</h3>
                    <div className="space-y-4 flex-1 relative z-10">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">API Connection</p>
                        <p className="text-sm font-mono text-emerald-400 mt-1">{API_BASE_URL}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current Default Shift</p>
                        <p className="text-sm font-mono text-blue-400 mt-1 bg-slate-800/50 py-1.5 px-3 rounded-lg border border-slate-700/50 w-fit">{format12Hour(shiftStart)} — {format12Hour(shiftEnd)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MANAGE USERS TAB */}
            {activeTab === 'users' && (
              <div className="space-y-6 print-hidden">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-200 bg-slate-50/50">
                    <h2 className="text-lg font-bold text-slate-800">System Administrators</h2>
                    <p className="text-sm text-slate-500 mt-1">Manage database access, roles, and security credentials.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[750px]">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Username</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Role Level</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Status</th>
                          {/* ONLY SHOW THIS COLUMN TO SUPER ADMINS */}
                          {isCurrentUserSuperAdmin && (
                            <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-center">Security Access</th>
                          )}
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {adminUsers.map(user => (
                          <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-4 px-6 font-bold text-slate-800 flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center text-xs ${user.role === 'Super Admin' ? 'bg-blue-600' : 'bg-slate-600'}`}>
                                {user.username.charAt(0).toUpperCase()}
                              </div>
                              {user.username}
                            </td>
                            
                            <td className="py-4 px-6 text-sm text-slate-600">
                              {isCurrentUserSuperAdmin ? (
                                <select 
                                  value={user.role || 'Admin'} 
                                  onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 outline-none focus:border-blue-500 shadow-sm cursor-pointer"
                                >
                                  <option value="Admin">Standard Admin</option>
                                  <option value="Super Admin">Super Admin</option>
                                </select>
                              ) : (
                                user.role || 'Admin'
                              )}
                            </td>

                            <td className="py-4 px-6"><span className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">{user.status || 'Active'}</span></td>
                            
                            {isCurrentUserSuperAdmin && (
                              <td className="py-4 px-6 text-center">
                                {editingPasswordId === user.id ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <input type="text" placeholder="New Password" value={newResetPassword} onChange={e => setNewResetPassword(e.target.value)} className="px-3 py-1.5 border border-slate-300 rounded-md text-xs w-32 shadow-sm outline-none" />
                                    <button onClick={() => handleResetPassword(user.id)} className="text-emerald-600 font-bold text-xs uppercase hover:underline">Save</button>
                                    <button onClick={() => setEditingPasswordId(null)} className="text-slate-400 font-bold text-xs uppercase hover:underline">Cancel</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setEditingPasswordId(user.id)} className="text-indigo-600 hover:text-indigo-800 text-[11px] tracking-wide font-bold uppercase transition-colors bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">Change Password</button>
                                )}
                              </td>
                            )}

                            <td className="py-4 px-6 text-right">
                              <button onClick={() => handleDeleteAdmin(user.id, user.role)} className="text-red-500 hover:text-red-700 text-sm font-bold uppercase transition-colors">Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ADD NEW USER FORM */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-lg font-bold text-slate-800 mb-4">Add New Administrator</h3>
                  <form onSubmit={handleAddAdmin} className="flex flex-col sm:flex-row gap-4 items-end">
                    <div className="flex flex-col gap-1.5 w-full">
                      <label className="text-sm font-medium text-slate-600">Username</label>
                      <input type="text" required value={newAdminUsername} onChange={(e) => setNewAdminUsername(e.target.value)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="New username" />
                    </div>
                    <div className="flex flex-col gap-1.5 w-full">
                      <label className="text-sm font-medium text-slate-600">Password</label>
                      <input type="password" required value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••••••" />
                    </div>
                    <button type="submit" disabled={isSaving} className="w-full sm:w-auto px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-lg whitespace-nowrap disabled:opacity-50">{isSaving ? 'Adding...' : 'Add Database User'}</button>
                  </form>
                </div>
              </div>
            )}

        {/* SUMMARY REPORTS TAB */}
        {activeTab === 'report' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden print-hidden">
            <div className="p-6 border-b border-slate-200 bg-amber-50/30">
              <h2 className="text-xl font-bold text-amber-950">Payroll Summary Reports</h2>
              <p className="text-sm text-amber-700 mt-1">Generate comprehensive payroll aggregates filtered by processing date and employee.</p>
              
              <div className="mt-6 flex flex-col md:flex-row gap-6 items-end bg-white p-5 rounded-xl border border-amber-100 shadow-sm">
                <div className="flex flex-col gap-1.5 w-full md:w-1/4">
                  <label className="text-sm font-bold text-slate-600 uppercase tracking-wide">From Date</label>
                  <div className="relative w-full">
                    <div className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white shadow-sm flex items-center justify-between w-full pointer-events-none text-slate-800">
                      <span>{reportFromDate ? formatMDY(reportFromDate) : 'Start Date'}</span>
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <input type="date" value={reportFromDate} onChange={(e) => setReportFromDate(e.target.value)} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 w-full md:w-1/4">
                  <label className="text-sm font-bold text-slate-600 uppercase tracking-wide">To Date</label>
                  <div className="relative w-full">
                    <div className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white shadow-sm flex items-center justify-between w-full pointer-events-none text-slate-800">
                      <span>{reportToDate ? formatMDY(reportToDate) : 'End Date'}</span>
                      <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <input type="date" value={reportToDate} onChange={(e) => setReportToDate(e.target.value)} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 w-full md:w-1/3">
                  <label className="text-sm font-bold text-slate-600 uppercase tracking-wide">Select Employee</label>
                  <div className="relative">
                    <select value={reportSelectedEmp} onChange={(e) => setReportSelectedEmp(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-4 focus:ring-amber-600/10 focus:border-amber-600 focus:outline-none transition-all text-sm shadow-sm text-slate-800 appearance-none cursor-pointer">
                      <option value="all">All Employees</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.lastName}, {emp.firstName}</option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6"/></svg>
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-auto">
                  <button onClick={handleGenerateReport} className="w-full md:w-auto px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-sm transition-colors uppercase tracking-wide text-sm whitespace-nowrap">
                    Generate Report
                  </button>
                </div>
              </div>
            </div>
            
            <div className="p-12 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
              <svg className="w-16 h-16 mb-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p className="font-medium text-lg">Report Engine Ready</p>
              <p className="text-sm mt-1">Select your date range above and click Generate Report.</p>
            </div>
          </div>
        )}

        {/* TAX COMPUTATION TAB */}
        {activeTab === 'tax' && (
              <div className="space-y-8">
                
                {/* DYNAMIC TAX SETTINGS PANEL */}
                <div className="bg-white shadow-sm border border-slate-300 overflow-hidden rounded-xl">
                  <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-800 tracking-wide">Semi-Monthly Tax Matrix</h2>
                    {isCurrentUserSuperAdmin && (
                      <button 
                        onClick={() => setIsEditingTax(!isEditingTax)} 
                        className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors ${isEditingTax ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-800 hover:bg-slate-900 text-white'}`}
                      >
                        {isEditingTax ? 'Save & Apply Matrix' : 'Edit Tax Brackets'}
                      </button>
                    )}
                  </div>
                  
                  <div className="overflow-x-auto p-4">
                    <table className="w-full text-center border-collapse text-sm whitespace-nowrap">
                      <thead className="bg-slate-100 text-slate-600 font-bold">
                        <tr>
                          <th className="py-2.5 px-3 border border-slate-200">Level</th>
                          <th className="py-2.5 px-3 border border-slate-200">Income Over (₱)</th>
                          <th className="py-2.5 px-3 border border-slate-200">Base Tax (₱)</th>
                          <th className="py-2.5 px-3 border border-slate-200">+ Tax Rate (%)</th>
                          <th className="py-2.5 px-3 border border-slate-200">Excess Over (₱)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taxBrackets.map((bracket, index) => (
                          <tr key={bracket.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 border border-slate-200 font-bold text-slate-400">{index + 1}</td>
                            
                            {isEditingTax ? (
                              <>
                                <td className="py-1 px-2 border border-slate-200"><input type="number" value={bracket.min} onChange={(e) => { const newB = [...taxBrackets]; newB[index].min = Number(e.target.value); setTaxBrackets(newB); }} className="w-full px-2 py-1 border border-blue-300 rounded text-center outline-none focus:ring-2 focus:ring-blue-500" /></td>
                                <td className="py-1 px-2 border border-slate-200"><input type="number" value={bracket.baseTax} onChange={(e) => { const newB = [...taxBrackets]; newB[index].baseTax = Number(e.target.value); setTaxBrackets(newB); }} className="w-full px-2 py-1 border border-blue-300 rounded text-center outline-none focus:ring-2 focus:ring-blue-500" /></td>
                                <td className="py-1 px-2 border border-slate-200"><input type="number" step="0.01" value={bracket.rate} onChange={(e) => { const newB = [...taxBrackets]; newB[index].rate = Number(e.target.value); setTaxBrackets(newB); }} className="w-full px-2 py-1 border border-blue-300 rounded text-center outline-none focus:ring-2 focus:ring-blue-500" /></td>
                                <td className="py-1 px-2 border border-slate-200"><input type="number" value={bracket.excessOver} onChange={(e) => { const newB = [...taxBrackets]; newB[index].excessOver = Number(e.target.value); setTaxBrackets(newB); }} className="w-full px-2 py-1 border border-blue-300 rounded text-center outline-none focus:ring-2 focus:ring-blue-500" /></td>
                              </>
                            ) : (
                              <>
                                <td className="py-2.5 px-3 border border-slate-200 font-mono text-slate-700">{formatMoney(bracket.min)}</td>
                                <td className="py-2.5 px-3 border border-slate-200 font-mono text-slate-700">{formatMoney(bracket.baseTax)}</td>
                                <td className="py-2.5 px-3 border border-slate-200 font-mono text-slate-700 text-blue-600 font-bold">{(bracket.rate * 100).toFixed(0)}%</td>
                                <td className="py-2.5 px-3 border border-slate-200 font-mono text-slate-700">{formatMoney(bracket.excessOver)}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* REPORT TABLE */}
                <div className="bg-white shadow-sm border border-slate-300 overflow-hidden rounded-xl">
                  <div className="p-4 border-b border-slate-200 bg-[#4472c4]/10"><h2 className="text-lg font-bold text-[#4472c4] tracking-wider uppercase">Tax Computation Report</h2></div>
                  <div className="overflow-x-auto p-4">
                    <table className="w-full text-center border-collapse border border-slate-400 text-sm whitespace-nowrap">
                      <thead className="bg-[#4472c4] text-white"><tr><th className="border border-slate-400 py-2.5 px-3">Name</th><th className="border border-slate-400 py-2.5 px-3">TAXABLE INCOME</th><th className="border border-slate-400 py-2.5 px-3">INCOME BRACKET</th><th className="border border-slate-400 py-2.5 px-3">TAX BASE</th><th className="border border-slate-400 py-2.5 px-3">TAX RATE</th><th className="border border-slate-400 py-2.5 px-3">TAX</th><th className="border border-slate-400 py-2.5 px-3">MIN W/TAX</th><th className="border border-slate-400 py-2.5 px-3">WITHHOLDING TAX</th></tr></thead>
                      <tbody>
                        {payrolls.length === 0 ? ( <tr><td colSpan={8} className="py-8 text-slate-400 italic">No payrolls computed yet.</td></tr> ) : (
                          (() => {
                            let totalWithholdingTax = 0; const declaredPayrolls = payrolls.filter(pr => pr.tax > 0);
                            if (declaredPayrolls.length === 0) return <tr><td colSpan={8} className="py-8 text-slate-400 italic">No declared salary records found.</td></tr>;
                            
                            const rows = declaredPayrolls.map((pr) => {
                              const emp = employees.find(e => e.id === pr.employeeId); const name = emp ? `${emp.lastName}, ${emp.firstName}` : 'Unknown';
                              const taxableIncome = pr.grossPay - pr.sssDeduction - pr.pagIbigDeduct - pr.philhealthDeduct; 
                              
                              // Use the live dynamic tax helper
                              const taxData = calculateDynamicTax(taxableIncome, taxBrackets);
                              totalWithholdingTax += taxData.tax;
                              
                              return ( 
                                <tr key={pr.id} className="hover:bg-slate-50"> 
                                  <td className="border border-slate-400 py-2 px-3 text-left font-bold uppercase">{name}</td> 
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxableIncome)}</td> 
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxData.bracketMin)}</td> 
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxData.taxBase)}</td> 
                                  <td className="border border-slate-400 py-2 px-3 text-right">{taxData.rate.toFixed(2)}</td> 
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxData.tax - taxData.minTax)}</td> 
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxData.minTax)}</td> 
                                  <td className="border border-slate-400 py-2 px-3 text-right font-bold text-slate-900 bg-slate-50">{formatMoney(taxData.tax)}</td> 
                                </tr> 
                              )
                            });
                            return ( <>{rows}<tr className="bg-slate-200 font-bold"><td className="border border-slate-400 py-2 px-3 text-right" colSpan={7}>Total Collected:</td><td className="border border-slate-400 py-2 px-3 text-right text-black">{formatMoney(totalWithholdingTax)}</td></tr></> );
                          })()
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

        {/* DIRECTORY LIST TAB */}
        {activeTab === 'list' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
              <input type="text" placeholder="Search directory..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-4 focus:border-blue-600 outline-none shadow-sm" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead className="bg-slate-100 border-b border-slate-200">
                  <tr>
                    <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Employee</th>
                    <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Status</th>
                    <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Compensation & Bank</th>
                    <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Govt IDs</th>
                    <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEmployees.length === 0 ? (
                    <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium text-sm">No records found.</td></tr>
                  ) : (
                    filteredEmployees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-blue-50/30 transition-colors group">
                        <td className="py-4 px-6 align-top">
                          <div className="font-semibold text-blue-950">{emp.firstName} {emp.middleName ? emp.middleName + ' ' : ''}{emp.lastName}</div>
                          <div className="text-xs text-slate-500 mt-1">{emp.address}</div>
                        </td>
                        <td className="py-4 px-6 align-top pt-5"><span className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset ${getStatusStyle(emp.employmentStatus)}`}>{emp.employmentStatus}</span></td>
                        <td className="py-4 px-6 align-top pt-5">
                          <div className="font-bold text-blue-950">₱{Number(emp.baseRate).toLocaleString()}</div>
                          <div className="text-xs font-mono text-slate-500 mt-1">Acct: {emp.bankAccount || '--'}</div>
                        </td>
                        <td className="py-4 px-6 align-top pt-4 text-xs font-mono text-slate-600 space-y-1.5"><p>TIN: {emp.tin || '--'}</p><p>SSS: {emp.sssNumber || '--'}</p></td>
                        <td className="py-4 px-6 align-top pt-5 text-right">
                          <button onClick={() => openEditModal(emp)} className="text-blue-600 hover:underline text-xs font-bold uppercase mr-4">Edit</button>
                          <button onClick={() => deleteEmployee(emp.id)} className="text-red-500 hover:underline text-xs font-bold uppercase">Delete</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ATTENDANCE TAB */}
        {activeTab === 'attendance' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 bg-indigo-50/30">
              <div className="flex flex-col md:flex-row justify-between items-start gap-6">
                <div>
                  <h2 className="text-xl font-bold text-indigo-950">Time & Attendance Log</h2>
                  <p className="text-sm text-indigo-700 mt-1">Logs are bounded by the standard Office Shift parameters.</p>
                  
                  <div className="mt-4">
                    <input 
                      type="text" 
                      placeholder="Search employee attendance..." 
                      value={attendanceSearchQuery} 
                      onChange={(e) => setAttendanceSearchQuery(e.target.value)} 
                      className="w-full sm:w-[350px] px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 outline-none shadow-sm transition-all" 
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mt-4 bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-indigo-100 w-full xl:w-fit">
                    <div className="flex flex-col gap-1 w-full sm:w-auto">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Office In</label>
                      <TimePicker12h value={tempShiftStart} onChange={setTempShiftStart} compact />
                    </div>
                    <div className="hidden sm:block w-px h-8 bg-slate-200"></div>
                    <div className="flex flex-col gap-1 w-full sm:w-auto">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Office Out</label>
                      <TimePicker12h value={tempShiftEnd} onChange={setTempShiftEnd} compact />
                    </div>
                    <button onClick={applyShiftSettings} disabled={isSaving} className="w-full sm:w-auto mt-2 sm:mt-0 sm:ml-2 px-4 py-3 sm:py-2.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 text-xs sm:text-sm font-bold rounded shadow-sm transition-colors uppercase tracking-wide disabled:opacity-50">
                      Save Shift
                    </button>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-3 w-full md:w-auto">
                  <div className="flex bg-white p-1 rounded-lg border border-indigo-200 w-full sm:w-auto">
                    <button onClick={() => setAttendanceFilter('day')} className={`flex-1 px-4 py-2 rounded-md text-sm font-bold transition-colors ${attendanceFilter === 'day' ? 'bg-indigo-100 text-indigo-800' : 'text-slate-500 hover:text-indigo-800'}`}>Daily View</button>
                    <button onClick={() => setAttendanceFilter('month')} className={`flex-1 px-4 py-2 rounded-md text-sm font-bold transition-colors ${attendanceFilter === 'month' ? 'bg-indigo-100 text-indigo-800' : 'text-slate-500 hover:text-indigo-800'}`}>Monthly Summary</button>
                  </div>
                  
                  {/* --- CUSTOM DATE FILTER UI --- */}
                  {attendanceFilter === 'day' ? (
                    <div className="relative w-full sm:w-[160px]">
                      <div className="px-4 py-2 border border-indigo-200 rounded-lg text-sm font-bold text-indigo-900 bg-white shadow-sm flex items-center justify-between w-full pointer-events-none">
                        <span>{formatMDY(attendanceDate)}</span>
                        <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      </div>
                      <input 
                        type="date" 
                        value={attendanceDate} 
                        onChange={(e) => setAttendanceDate(e.target.value)} 
                        onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                      />
                    </div>
                  ) : (
                    <div className="relative w-full sm:w-[140px]">
                      <div className="px-4 py-2 border border-indigo-200 rounded-lg text-sm font-bold text-indigo-900 bg-white shadow-sm flex items-center justify-between w-full pointer-events-none">
                        <span>{formatMonthYear(attendanceMonth)}</span>
                        <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      </div>
                      <input 
                        type="month" 
                        value={attendanceMonth} 
                        onChange={(e) => setAttendanceMonth(e.target.value)} 
                        onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1050px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase w-1/4">Employee</th>
                    {attendanceFilter === 'day' ? (
                      <>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Recorded Logs</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Add New Log</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right whitespace-nowrap w-24">Total OT</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right whitespace-nowrap">Calculated Hours</th>
                      </>
                    ) : (
                      <>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Detailed Monthly Logs</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right whitespace-nowrap w-24">Total OT</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right whitespace-nowrap w-36">Total Payable Hrs</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attendanceFilter === 'day' && filteredAttendanceEmployees.map((emp) => {
                        const empLogs = attendances.filter(a => Number(a.employeeId) === emp.id && a.date && a.date.split('T')[0] === attendanceDate);
                        
                        // NEW LOGIC: Explicitly grab exact OT instead of guessing by subtracting 8
                        let totalHrs = 0;
                        let totalOtHrs = 0;
                        empLogs.forEach(log => {
                          if (!log.timeIn || !log.timeIn.includes(':')) {
                            totalHrs += log.hours;
                          } else {
                            const shiftCalc = calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd);
                            totalHrs += shiftCalc.total;
                            totalOtHrs += shiftCalc.ot;
                          }
                        });
                        
                        const currentLog = dailyTimeLogs[emp.id] || { timeIn: '', timeOut: '', type: 'regular', reason: '' };
                    
                    return (
                      <tr key={emp.id} className="hover:bg-indigo-50/10 transition-colors group">
                        <td className="py-5 px-6 align-top w-1/4"><span className="font-semibold text-blue-950 text-sm whitespace-nowrap">{emp.firstName} {emp.lastName}</span></td>
                        
                        <td className="py-5 px-6 align-top">
                          <div className="flex flex-col gap-3">
                            {empLogs.length === 0 ? <span className="text-sm text-slate-400 italic mt-1.5">No logs recorded</span> : 
                              empLogs.map(log => {
                                const isLeave = !log.timeIn.includes(':');
                                const shiftCalc = !isLeave ? calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd) : null;

                                return (
                                  <div key={log.id} className="flex flex-col bg-white border border-indigo-100 rounded-xl shadow-sm overflow-hidden w-full max-w-[420px]">
                                    <div className="flex items-center justify-between gap-6 bg-indigo-50 px-4 py-2.5">
                                      <span className="text-sm font-bold text-indigo-900 font-mono whitespace-nowrap">
                                        {isLeave 
                                          ? `${log.timeIn} (${log.timeOut})${log.reason ? ` - ${log.reason}` : ''}` 
                                          : `${format12Hour(log.timeIn)} - ${format12Hour(log.timeOut)}`}
                                      </span>
                                      <div className="flex items-center gap-3 shrink-0">
                                        <button onClick={() => openEditLogModal(log)} className="text-indigo-400 hover:text-indigo-600 font-bold transition-colors text-xs uppercase tracking-wider" title="Edit Log">EDIT</button>
                                        <button onClick={() => deleteAttendance(log.id)} className="text-rose-400 hover:text-rose-600 font-bold transition-colors text-sm" title="Remove Log">✕</button>
                                      </div>
                                    </div>
                                    {!isLeave && shiftCalc ? (
                                      <div className="flex gap-4 px-4 py-2.5 text-[11px] uppercase font-bold text-slate-500 bg-white items-center flex-wrap border-t border-indigo-50">
                                        <span className="text-indigo-600" title="Regular Shift Hours">Reg: {formatDecToHM(shiftCalc.reg)}</span>
                                        <span className="text-slate-200">|</span>
                                        <span title="Early Overtime Hours" className={`${shiftCalc.earlyOt > 0 ? 'text-amber-600 font-bold' : 'text-slate-400 font-medium'}`}>Early: {shiftCalc.earlyOt > 0 ? formatDecToHM(shiftCalc.earlyOt) : '--'}</span>
                                        <span className="text-slate-200">|</span>
                                        <span title="Late Overtime Hours" className={`${shiftCalc.lateOt > 0 ? 'text-amber-600 font-bold' : 'text-slate-400 font-medium'}`}>Late OT: {shiftCalc.lateOt > 0 ? formatDecToHM(shiftCalc.lateOt) : '--'}</span>
                                      </div>
                                    ) : (
                                      <div className={`px-4 py-2.5 text-[11px] uppercase font-bold border-t border-indigo-50 ${log.hours > 0 ? 'text-emerald-600 bg-white' : 'text-rose-600 bg-rose-50'}`}>
                                        {log.hours > 0 ? `Auto-credited: ${formatDecToHM(log.hours)}` : 'Deducted: 0m'}
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                            }
                          </div>
                        </td>

                        <td className="py-5 px-6 align-top">
                          <div className="flex flex-col gap-2 w-full min-w-[200px] max-w-full sm:max-w-[320px]">
                            <select value={currentLog.type} onChange={(e) => handleTimeChange(emp.id, 'type', e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 bg-white w-full shadow-sm">
                              <option value="regular">Standard Office Shift</option>
                              <option value="paid_leave">Paid Leave (8 hrs)</option>
                              <option value="unpaid_leave">Unpaid Leave (0 hrs)</option>
                            </select>
                            
                            <div className="flex flex-col gap-2 mt-1 w-full">
                              {currentLog.type === 'regular' ? (
                                <>
                                  <TimePicker12h value={currentLog.timeIn} onChange={(val: string) => handleTimeChange(emp.id, 'timeIn', val)} compact />
                                  <TimePicker12h value={currentLog.timeOut} onChange={(val: string) => handleTimeChange(emp.id, 'timeOut', val)} compact />
                                </>
                              ) : (
                                <input 
                                  type="text" 
                                  placeholder="Reason (Optional)" 
                                  value={currentLog.reason || ''} 
                                  onChange={(e) => handleTimeChange(emp.id, 'reason', e.target.value)} 
                                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 w-full shadow-sm"
                                />
                              )}
                            </div>
                            <button onClick={() => saveInlineAttendance(emp.id)} className="mt-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 transition-colors text-white text-sm font-bold rounded-lg shadow-sm w-full">Save Log</button>
                          </div>
                        </td>

                        <td className="py-5 px-6 align-top text-right font-mono font-semibold text-amber-600 text-sm">
                           {totalOtHrs > 0 ? formatDecToHM(totalOtHrs) : '--'}
                        </td>

                        <td className="py-5 px-6 align-top text-right">
                           <span className="inline-block whitespace-nowrap font-mono font-bold text-sm text-indigo-700 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100">
                             {totalHrs > 0 ? formatDecToHM(totalHrs) : '--'}
                           </span>
                        </td>
                      </tr>
                    );
                  })}

                  {attendanceFilter === 'month' && filteredAttendanceEmployees.map((emp) => {
                        const monthLogs = attendances.filter(a => Number(a.employeeId) === emp.id && a.date && a.date.split('T')[0].startsWith(attendanceMonth)).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                        
                        // NEW LOGIC: Explicitly grab exact monthly OT
                        let totalHrs = 0;
                        let totalOverallOtHrs = 0;
                        monthLogs.forEach(log => {
                          if (!log.timeIn || !log.timeIn.includes(':')) {
                            totalHrs += log.hours;
                          } else {
                            const shiftCalc = calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd);
                            totalHrs += shiftCalc.total;
                            totalOverallOtHrs += shiftCalc.ot;
                          }
                        });

                        return (
                      <tr key={emp.id} className="hover:bg-indigo-50/10 transition-colors">
                        <td className="py-5 px-6 align-top w-1/4"><span className="font-semibold text-blue-950 text-sm whitespace-nowrap">{emp.firstName} {emp.lastName}</span></td>
                        
                        <td className="py-5 px-6 align-top">
                          {monthLogs.length === 0 ? (
                            <span className="text-sm text-slate-400 italic">No logs this month</span>
                          ) : (
                            <button 
                              onClick={() => setMonthLogsModalEmp(emp)}
                              className="px-5 py-2.5 bg-white border border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 text-indigo-700 text-sm font-bold rounded-xl shadow-sm transition-all flex items-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                              View {monthLogs.length} Logs
                            </button>
                          )}
                        </td>

                        <td className="py-5 px-6 align-top text-right font-mono font-bold text-amber-700 text-sm">
                           {totalOverallOtHrs > 0 ? formatDecToHM(totalOverallOtHrs) : '--'}
                        </td>
                        <td className="py-5 px-6 align-top text-right font-mono font-bold text-indigo-700 text-sm">
                           <span className="inline-block whitespace-nowrap bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100">{totalHrs > 0 ? formatDecToHM(totalHrs) : '0m'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* PAYROLL TAB */}
        {activeTab === 'payroll' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200 bg-emerald-50/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-lg font-bold text-emerald-950">Active Employees (Compute Salary)</h2>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-full uppercase tracking-wider inline-block mt-2 sm:mt-0 sm:ml-2">Syncs with valid logged hours</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <div className="relative">
                    <input type="month" value={payrollComputeMonth} onChange={e => setPayrollComputeMonth(e.target.value)} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                    <div className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white shadow-sm flex items-center justify-between w-full sm:w-[150px] pointer-events-none text-emerald-900 font-semibold">
                      <span>{formatMonthYear(payrollComputeMonth)}</span>
                      <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                  </div>
                  <input type="text" placeholder="Search employee..." value={payrollActiveSearchQuery} onChange={e => setPayrollActiveSearchQuery(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 shadow-sm w-full sm:w-auto min-w-[200px]" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead className="bg-slate-100 border-b border-slate-200">
                    <tr>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Employee Name</th>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Valid Logged Hours</th>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Total OT Hours</th>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredActiveEmployees.length === 0 ? (
                      <tr><td colSpan={4} className="py-12 text-center text-slate-400 font-medium text-sm">No active employees found matching your search.</td></tr>
                    ) : (
                      filteredActiveEmployees.map((emp) => {
                        // Filter explicitly by selected computation month
                        const empLogs = attendances.filter(a => Number(a.employeeId) === emp.id && a.date && a.date.split('T')[0].startsWith(payrollComputeMonth));
                        
                        let totalLogged = 0;
                        let totalOtLogged = 0;

                        empLogs.forEach(log => {
                            if (!log.timeIn || !log.timeIn.includes(':')) {
                                totalLogged += log.hours;
                            } else {
                                const shiftCalc = calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd);
                                totalLogged += shiftCalc.total;
                                totalOtLogged += shiftCalc.ot; // Add up exact daily OT
                            }
                        });

                        return (
                          <tr key={emp.id} className="hover:bg-emerald-50/30 transition-colors">
                            <td className="py-4 px-6 font-semibold text-blue-950">{emp.firstName} {emp.lastName}</td>
                            <td className="py-4 px-6 font-mono text-slate-600">{formatDecToHM(totalLogged)}</td>
                            <td className="py-4 px-6 font-mono text-amber-600 font-semibold">{totalOtLogged > 0 ? formatDecToHM(totalOtLogged) : '--'}</td>
                            <td className="py-4 px-6 text-right">
                              <button onClick={() => openPayrollModal(emp)} className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold uppercase rounded hover:bg-emerald-700 shadow-sm transition-colors">Compute Salary</button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* --- SAVED PAYROLL HISTORY TABLE --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-8">
              <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-lg font-bold text-slate-800">Saved Payroll History</h2>
                <input type="text" placeholder="Search by name or date..." value={payrollHistorySearchQuery} onChange={e => setPayrollHistorySearchQuery(e.target.value)} className="w-full sm:w-[250px] px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-4 focus:ring-slate-600/10 focus:border-slate-500 shadow-sm" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead className="bg-slate-100 border-b border-slate-200">
                    <tr>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Date Computed</th>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Employee</th>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Hours / Days</th>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Final Net Pay</th>
                      <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSavedPayrolls.length === 0 ? (
                      <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium text-sm">No payroll records saved or matching your search.</td></tr>
                    ) : (
                      filteredSavedPayrolls.map(pr => {
                        const emp = employees.find(e => e.id === Number(pr.employeeId));
                        return (
                          <tr key={pr.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-4 px-6 text-sm text-slate-600 font-mono font-semibold">{formatMDY(pr.createdAt)}</td>
                            <td className="py-4 px-6 font-semibold text-blue-950">{emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown Employee'}</td>
                            <td className="py-4 px-6 text-sm text-slate-600">{formatDecToHM(pr.totalHours)} / {pr.daysWorked} days</td>
                            <td className="py-4 px-6 font-mono font-bold text-emerald-700">₱{pr.netPay.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            <td className="py-4 px-6 text-right space-x-4">
                              {emp && (
                                <button onClick={() => setSelectedPayslip({ record: pr, emp })} className="text-blue-600 hover:underline text-xs font-bold uppercase">Generate Payslip</button>
                              )}
                              <button onClick={() => deletePayroll(pr.id)} className="text-red-500 hover:underline text-xs font-bold uppercase">Delete</button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* REGISTER TAB */}
        {activeTab === 'add' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
            <h2 className="text-xl font-bold text-blue-950 tracking-tight mb-8">201 Personnel Registration</h2>
            <form onSubmit={handleSubmitEmployee} className="flex flex-col gap-6">
              <EmployeeFormFields formData={formData} handleChange={handleFormattedChange} />
              <button type="submit" disabled={isSaving} className={`mt-4 w-full py-3.5 px-4 rounded-xl font-semibold text-white bg-blue-700 hover:bg-blue-800 transition-colors shadow-sm`}>
                {isSaving ? 'Registering...' : 'Register Employee to Directory'}
              </button>
            </form>
          </div>
        )}
</div>
        </main>
      </div>
    </div>
  );
}