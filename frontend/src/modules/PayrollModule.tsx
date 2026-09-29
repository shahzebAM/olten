import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';

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

const formatMoney = (val: number) => {
  if (!val || val === 0) return '-';
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

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

const InputField = ({ label, required = false, type = "text", placeholder = "", value, onChange, step, disabled = false, compact = false }: any) => {
  const renderInput = () => {
    if (type === 'date') {
      return (
        <div className="relative w-full">
          <div className={`w-full border rounded-lg shadow-sm flex items-center justify-between pointer-events-none ${compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'} ${disabled ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-white border-slate-300 text-slate-800'}`}>
            <span>{value ? formatMDY(value) : 'MM/DD/YYYY'}</span>
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <input required={required} type="date" value={value} onChange={onChange} disabled={disabled} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
        </div>
      );
    }
    return (
      <input required={required} type={type} step={step} placeholder={placeholder} value={value} onChange={onChange} disabled={disabled} className={`w-full border rounded-lg focus:outline-none transition-all shadow-sm placeholder:text-slate-400 text-slate-800 ${compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'} ${disabled ? 'bg-slate-100 border-slate-200 cursor-not-allowed text-slate-500' : 'bg-white border-slate-300 focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600'}`} />
    );
  };

  return (
    <div className="flex flex-col gap-1 w-full">
      <label className={`${compact ? 'text-[10px]' : 'text-sm'} font-medium text-slate-600`}>
        {label} {required && <span className="text-blue-600">*</span>}
      </label>
      {renderInput()}
    </div>
  );
};

const EmployeeFormFields = ({ formData, handleChange }: any) => (
  <>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      <InputField required label="Employee ID" placeholder="Biometric ID" value={formData.employeeId} onChange={handleChange('employeeId', 'standard')} />
      <InputField required label="First Name" value={formData.firstName} onChange={handleChange('firstName', 'standard')} />
      <InputField label="Middle Name" placeholder="Optional" value={formData.middleName} onChange={handleChange('middleName', 'standard')} />
      <InputField required label="Last Name" value={formData.lastName} onChange={handleChange('lastName', 'standard')} />
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
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
    
    <hr className="border-t border-slate-200 my-5 sm:my-6" />

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
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

    <hr className="border-t border-slate-200 my-5 sm:my-6" />
    
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      <InputField type="number" step="0.01" label="Cash Advance Bal (₱)" placeholder="0.00" value={formData.cashAdvanceBalance} onChange={handleChange('cashAdvanceBalance', 'standard')} />
      <InputField type="number" step="0.01" label="Advance Deduct/Cutoff (₱)" placeholder="0.00" value={formData.cashAdvanceInstallment} onChange={handleChange('cashAdvanceInstallment', 'standard')} />
      <InputField type="number" step="0.01" label="Company Loan Bal (₱)" placeholder="0.00" value={formData.loanBalance} onChange={handleChange('loanBalance', 'standard')} />
      <InputField type="number" step="0.01" label="Loan Deduct/Cutoff (₱)" placeholder="0.00" value={formData.loanInstallment} onChange={handleChange('loanInstallment', 'standard')} />
    </div>

    <hr className="border-t border-slate-200 my-5 sm:my-6" />

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
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
  employeeId?: string; 
  firstName: string;
  middleName: string;
  lastName: string;
  company: string;
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
  loanBalance: number;
  loanInstallment: number;
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
  companyLoan: number;
  sssDeduction: number;
  pagIbigDeduct: number;
  philhealthDeduct: number;
  tax: number;
  grossPay: number;
  netPay: number;
  createdAt: string;
  pagIbigLoan: number;
  pagIbigHousingLoan: number;
  sssProvident: number;
  sssSalaryLoan: number;
  sssCalamityLoan: number;
  pagIbigCalamity: number;
  pagIbigSalaryLoan: number;
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
// 4. MAIN PAYROLL MODULE COMPONENT
// ==========================================

export default function PayrollModule({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  
  // --- STATES ---
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollRecord[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'list' | 'add' | 'attendance' | 'payroll' | 'tax' | 'report'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attendanceSearchQuery, setAttendanceSearchQuery] = useState(''); 
  
  const [payrollStartDate, setPayrollStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]);
  const [payrollEndDate, setPayrollEndDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 15).toISOString().split('T')[0]);

  const [payrollActiveSearchQuery, setPayrollActiveSearchQuery] = useState('');
  const [payrollHistorySearchQuery, setPayrollHistorySearchQuery] = useState('');

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState<{ record: PayrollRecord, emp: Employee } | null>(null);
  const [editingLog, setEditingLog] = useState<AttendanceRecord | null>(null);
  const [editLogForm, setEditLogForm] = useState({ date: '', timeIn: '', timeOut: '', type: 'regular', reason: '' });
  const [monthLogsModalEmp, setMonthLogsModalEmp] = useState<Employee | null>(null);
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');
  const [reportSelectedEmp, setReportSelectedEmp] = useState('all');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [activeEmployee, setActiveEmployee] = useState<Employee | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const [tempShiftStart, setTempShiftStart] = useState('08:00');
  const [tempShiftEnd, setTempShiftEnd] = useState('17:00');
  const [shiftStart, setShiftStart] = useState('08:00');
  const [shiftEnd, setShiftEnd] = useState('17:00');
  const [attendanceFilter, setAttendanceFilter] = useState<'day' | 'month'>('day');
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceMonth, setAttendanceMonth] = useState(new Date().toISOString().slice(0, 7)); 
  const [dailyTimeLogs, setDailyTimeLogs] = useState<Record<number, { timeIn: string, timeOut: string, type: string, reason: string }>>({});

  const initialFormState = {
    employeeId: '', firstName: '', middleName: '', lastName: '', dateOfBirth: '', 
    civilStatus: 'Single', address: '', employmentStatus: 'Probationary', 
    baseRate: '', bankAccount: '', tin: '', sssNumber: '', philhealth: '', pagIbig: '',
    cashAdvanceBalance: '', cashAdvanceInstallment: '', loanBalance: '', loanInstallment: ''
  };
  const [formData, setFormData] = useState(initialFormState);

  const [payrollData, setPayrollData] = useState({
    daysWorked: '14', cashAdvance: '', companyLoan: '', sss: '', pagIbig: '', philhealth: '', isDeclared: false,
    pagIbigLoan: '0', pagIbigHousingLoan: '0', sssProvident: '0', sssSalaryLoan: '0',
    sssCalamityLoan: '0', pagIbigCalamity: '0', pagIbigSalaryLoan: '0', govHolidayAmt: ''
  });

  const [isEditingTax, setIsEditingTax] = useState(false);
  const [taxBrackets, setTaxBrackets] = useState([
    { id: 1, min: 0, baseTax: 0, rate: 0, excessOver: 0 },
    { id: 2, min: 10417, baseTax: 0, rate: 0.15, excessOver: 10417 },
    { id: 3, min: 16667, baseTax: 937.5, rate: 0.20, excessOver: 16667 },
    { id: 4, min: 33333, baseTax: 4270.7, rate: 0.25, excessOver: 33333 },
    { id: 5, min: 83333, baseTax: 16770.7, rate: 0.30, excessOver: 83333 },
    { id: 6, min: 333333, baseTax: 91770.7, rate: 0.35, excessOver: 333333 },
  ]);

  useEffect(() => {
    fetchEmployees();
    fetchAttendances();
    fetchPayrolls();
    fetchSettings();
  }, [selectedCompany]);

  const fetchSettings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/settings?company=${selectedCompany}`);
      if (response.ok) {
        const data = await response.json();
        const settingsObj = Array.isArray(data) ? data[0] : data;
        if (settingsObj && settingsObj.shiftStart && settingsObj.shiftEnd) {
          setShiftStart(settingsObj.shiftStart);
          setShiftEnd(settingsObj.shiftEnd);
          setTempShiftStart(settingsObj.shiftStart);
          setTempShiftEnd(settingsObj.shiftEnd);
        } else {
          setShiftStart('08:00'); setShiftEnd('17:00');
          setTempShiftStart('08:00'); setTempShiftEnd('17:00');
        }
      }
    } catch (error) { console.warn("Could not connect to /settings backend endpoint."); }
  };

  const fetchEmployees = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees?company=${encodeURIComponent(selectedCompany)}&limit=5000`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setEmployees(Array.isArray(data) ? data : (data.data || []));
    } catch (error) { showToast("Could not fetch employees.", "error"); }
  };

  const fetchAttendances = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance/all?company=${encodeURIComponent(selectedCompany)}&limit=5000`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAttendances(Array.isArray(data) ? data : (data.data || []));
    } catch (error) { console.error(error); }
  };

  const fetchPayrolls = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/payroll/all?company=${encodeURIComponent(selectedCompany)}&limit=5000`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setPayrolls(Array.isArray(data) ? data : (data.data || []));
    } catch (error) { console.error(error); }
  };

  const handleRefreshData = async () => {
    setIsSaving(true);
    showToast("Syncing with database...", "success");
    try {
      await Promise.all([ fetchEmployees(), fetchAttendances(), fetchPayrolls() ]);
      showToast("Data is completely up to date!", "success");
    } catch (e) { showToast("Failed to refresh data from server.", "error"); } 
    finally { setIsSaving(false); }
  };

  const isLogWithinPayrollPeriod = (dateStr: string) => {
    if (!payrollStartDate || !payrollEndDate) return false;
    const logDate = dateStr.split('T')[0];
    return logDate >= payrollStartDate && logDate <= payrollEndDate;
  };

  const calculateDynamicTax = (taxableIncome: number, brackets: any[]) => {
    if (taxableIncome <= 0) return { tax: 0, bracketMin: 0, rate: 0, minTax: 0, taxBase: 0 };
    const sorted = [...brackets].sort((a, b) => b.min - a.min);
    const applicable = sorted.find(b => taxableIncome >= b.min) || sorted[sorted.length - 1];
    const taxBase = taxableIncome - applicable.excessOver;
    const computedTax = applicable.baseTax + (taxBase * applicable.rate);
    return { tax: computedTax, bracketMin: applicable.min, rate: applicable.rate, minTax: applicable.baseTax, taxBase: Math.max(0, taxBase) };
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => { setToast(null); }, 3500);
  };

  const exportToCSV = (filename: string, headers: string[], data: any[][]) => {
    const csvContent = [headers.join(','), ...data.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleExportAttendance = () => {
    const headers = ['System ID', 'Employee ID', 'Date', 'Time In', 'Time Out', 'Employee Name', 'Calculated Hours', 'Type/Reason'];
    const data = attendances.map(a => {
      const emp = employees.find(e => e.id === a.employeeId);
      const isLeave = a.timeIn === 'LEAVE';
      let niceTimeIn = isLeave ? a.timeIn : (a.timeIn ? format12Hour(a.timeIn) : 'MISSING');
      let niceTimeOut = isLeave ? a.timeOut : (a.timeOut ? format12Hour(a.timeOut) : 'MISSING');
      return [ a.employeeId, emp?.employeeId || '', a.date ? a.date.split('T')[0] : '', niceTimeIn, niceTimeOut, emp ? `${emp.lastName}, ${emp.firstName}` : 'Unknown', a.hours, a.reason || 'Regular' ];
    });
    exportToCSV(`Attendance_Export_${new Date().toISOString().split('T')[0]}.csv`, headers, data);
  };

  const handleExportPayrolls = () => {
    const headers = ['Date Computed', 'System ID', 'Employee ID', 'Employee Name', 'Days Worked', 'Total Hours', 'Gross Pay', 'Total Deductions', 'Net Pay'];
    const data = payrolls.map(p => {
      const emp = employees.find(e => e.id === p.employeeId);
      const totalDeds = p.cashAdvance + (p.companyLoan || 0) + p.sssDeduction + p.pagIbigDeduct + p.philhealthDeduct + p.tax + (p.pagIbigLoan || 0) + (p.pagIbigHousingLoan || 0);
      return [formatMDY(p.createdAt), p.employeeId, emp?.employeeId || '', emp ? `${emp.lastName}, ${emp.firstName}` : 'Unknown', p.daysWorked, p.totalHours, p.grossPay, totalDeds, p.netPay];
    });
    exportToCSV(`Payroll_Export_${new Date().toISOString().split('T')[0]}.csv`, headers, data);
  };

  const handleExportPayrollsZip = async () => {
    if (filteredSavedPayrolls.length === 0) { showToast("No payroll records found to export.", "error"); return; }
    setIsSaving(true);
    showToast(`Generating ${filteredSavedPayrolls.length} PDFs... Please wait.`, "success");

    try {
      const zip = new JSZip();
      for (let i = 0; i < filteredSavedPayrolls.length; i++) {
        const pr = filteredSavedPayrolls[i];
        const emp = employees.find(e => e.id === Number(pr.employeeId));
        if (!emp) continue;

        setSelectedPayslip({ record: pr, emp });
        await new Promise(resolve => setTimeout(resolve, 500)); 

        const element = document.getElementById('payslip-print-area');
        if (element) {
          const width = element.scrollWidth;
          const height = element.scrollHeight;
          const imgData = await toPng(element, { backgroundColor: '#ffffff', pixelRatio: 4, width: width, height: height, style: { transform: 'scale(1)', transformOrigin: 'top left', margin: '0' } });
          
          const pdf = new jsPDF('p', 'mm', 'a4'); 
          const pdfPageWidth = pdf.internal.pageSize.getWidth();
          const pdfPageHeight = pdf.internal.pageSize.getHeight();
          const ratio = pdfPageWidth / width;
          const imgWidthOnPdf = width * ratio;
          const imgHeightOnPdf = height * ratio;
          
          let finalWidth = imgWidthOnPdf;
          let finalHeight = imgHeightOnPdf;
          
          if (imgHeightOnPdf > pdfPageHeight) {
             const heightRatio = pdfPageHeight / height;
             finalWidth = width * heightRatio;
             finalHeight = height * heightRatio;
          }

          pdf.addImage(imgData, 'PNG', 0, 0, finalWidth, finalHeight, undefined, 'FAST');
          const pdfBlob = pdf.output('blob');
          const safeName = `${emp.lastName}_${emp.firstName}_Payslip_${pr.createdAt.split('T')[0]}.pdf`.replace(/[^a-zA-Z0-9_\-\.]/g, '');
          zip.file(safeName, pdfBlob);
        }
      }

      setSelectedPayslip(null);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `Batch_Payslips_${new Date().toISOString().split('T')[0]}.zip`;
      link.click();
      showToast("ZIP File generated successfully!", "success");
    } catch (err) {
      showToast("Export failed. Check console for details.", "error");
    } finally {
      setIsSaving(false);
      setSelectedPayslip(null); 
    }
  };

  const handleImportAttendance = async (event: any) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsSaving(true);
    showToast("Validating DTR records...", "success");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const rows = text.split(/\r?\n/).filter(row => row.trim() !== '');
        if (rows.length < 2) throw new Error("File empty or missing data");

        const parseCSVRow = (str: string) => {
            const result = [];
            let cell = '';
            let inQuotes = false;
            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                if (char === '"' && str[i+1] === '"') { cell += '"'; i++; } 
                else if (char === '"') { inQuotes = !inQuotes; }
                else if (char === ',' && !inQuotes) { result.push(cell.trim().replace(/^"|"$/g, '')); cell = ''; }
                else { cell += char; }
            }
            result.push(cell.trim().replace(/^"|"$/g, ''));
            return result;
        };

        let headerRowIdx = -1;
        let headers: string[] = [];
        for (let i = 0; i < Math.min(15, rows.length); i++) {
          const cols = parseCSVRow(rows[i]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
          if ((cols.includes('personnelno') || cols.includes('employeeid')) && cols.includes('date') && cols.includes('in') && cols.includes('out')) {
            headerRowIdx = i;
            headers = cols;
            break;
          }
        }

        if (headerRowIdx === -1) {
          showToast("Import Aborted! Could not detect required columns.", "error");
          setIsSaving(false);
          event.target.value = '';
          return;
        }

        const empIdIdx = headers.findIndex(h => h === 'personnelno' || h === 'employeeid' || h === 'systemid' || h === 'id');
        const dateIdx = headers.findIndex(h => h === 'date');
        const inIdx = headers.findIndex(h => h === 'in' || h === 'timein');
        const outIdx = headers.findIndex(h => h === 'out' || h === 'timeout');

        const formatTime24 = (timeStr: string) => {
          if (!timeStr) return '';
          const clean = timeStr.toUpperCase();
          if (['PAID', 'UNPAID', 'LEAVE'].includes(clean)) return clean;
          const match = timeStr.trim().match(/(\d+):(\d+)\s*(AM|PM)?/i);
          if (!match) return ''; 
          let [_, h, m, modifier] = match;
          let hours = parseInt(h, 10);
          if (modifier) {
            if (modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;
          }
          return `${hours.toString().padStart(2, '0')}:${m}`;
        };

        const formatIsoDate = (dStr: string) => {
           if (!dStr) return '';
           if (dStr.includes('/')) {
               const p = dStr.split('/');
               if (p[2] && p[2].length === 4) return `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
           }
           if (dStr.includes('-')) return dStr;
           return '';
        };

        const validPayloads: any = {};
        let currentPersonnelNo = '';
        let incompleteEmployees = new Set<string>();

        for (let i = headerRowIdx + 1; i < rows.length; i++) {
          const cols = parseCSVRow(rows[i]);
          
          if (cols[empIdIdx] && cols[empIdIdx].trim() !== '') {
            currentPersonnelNo = cols[empIdIdx].trim();
          }

          if (!currentPersonnelNo) continue; 

          const rawDate = cols[dateIdx];
          const rawIn = cols[inIdx] ? cols[inIdx].trim() : '';
          const rawOut = cols[outIdx] ? cols[outIdx].trim() : '';

          const tIn = formatTime24(rawIn);
          const tOut = formatTime24(rawOut);
          const safeDate = formatIsoDate(rawDate);

          if (!safeDate) continue;

          const matchedEmployee = employees.find(emp => 
            emp.employeeId === currentPersonnelNo || emp.id.toString() === currentPersonnelNo
          );

          if (!matchedEmployee) continue; 

          let hours = 0;
          if (tIn && tOut && tIn.includes(':') && tOut.includes(':')) { 
             hours = calculateShiftHours(tIn, tOut, shiftStart, shiftEnd).total; 
          } else if (tOut === 'PAID') { 
             hours = 8; 
          }

          if (!tIn || !tOut) {
             incompleteEmployees.add(`${matchedEmployee.firstName} ${matchedEmployee.lastName}`);
          }

          const payloadKey = `${matchedEmployee.id}_${safeDate}`;
          validPayloads[payloadKey] = { 
            employeeId: matchedEmployee.id, 
            date: safeDate, 
            timeIn: tIn || '', 
            timeOut: tOut || '', 
            hours, 
            reason: null, 
            shiftStart, 
            shiftEnd 
          };
        }

        const payloadArray = Object.values(validPayloads);

        if (payloadArray.length === 0) {
           showToast("No valid rows found to import.", "error");
           setIsSaving(false); event.target.value = ''; return;
        }

        let successCount = 0;
        for (const payload of payloadArray as any[]) {
          const existingLog = attendances.find(a => a.employeeId === payload.employeeId && a.date && a.date.split('T')[0] === payload.date);
          
          const url = existingLog ? `${API_BASE_URL}/employees/attendance/${existingLog.id}` : `${API_BASE_URL}/employees/attendance`;
          const method = existingLog ? 'PATCH' : 'POST';

          const res = await fetch(url, { 
            method: method, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
          });
          
          if(res.ok) successCount++;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchAttendances();
        
        showToast(`Imported ${successCount} logs successfully!`, "success");

        if (incompleteEmployees.size > 0) {
          setTimeout(() => {
            const arr = Array.from(incompleteEmployees);
            const nameStr = arr.slice(0, 3).join(', ') + (arr.length > 3 ? ` & ${arr.length - 3} more` : '');
            showToast(`Note: Incomplete punches safely saved for ${nameStr}`, "success");
          }, 3600);
        }
        
      } catch (err) { 
        showToast("Failed to parse CSV file. Check formatting.", "error"); 
      } finally {
        setIsSaving(false); 
        event.target.value = ''; 
      }
    };
    reader.readAsText(file);
  };

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
    if (!formData.employeeId.trim() || !formData.firstName.trim() || !formData.lastName.trim() || !formData.dateOfBirth || !formData.address.trim() || !formData.baseRate) {
      showToast("All core employee details (including Employee ID) must be filled out.", "error"); return;
    }

    const empIdToCheck = formData.employeeId.trim().toLowerCase();
    const isDuplicate = employees.find(emp => 
        emp.employeeId?.toLowerCase() === empIdToCheck && 
        emp.id !== editingId && 
        emp.company === selectedCompany
    );

    if (isDuplicate) {
        showToast(`Employee ID "${formData.employeeId}" is already assigned to ${isDuplicate.firstName} ${isDuplicate.lastName}.`, "error");
        return;
    }

    setIsSaving(true);
    const payload = {
      ...formData, 
      employeeId: formData.employeeId.trim(), 
      company: selectedCompany, 
      baseRate: parseFloat(formData.baseRate), dateOfBirth: new Date(formData.dateOfBirth).toISOString(),
      middleName: formData.middleName?.trim() || null, 
      bankAccount: formData.bankAccount?.trim() || null, 
      tin: formData.tin?.trim() || null,
      sssNumber: formData.sssNumber?.trim() || null, 
      philhealth: formData.philhealth?.trim() || null, 
      pagIbig: formData.pagIbig?.trim() || null,
      cashAdvanceBalance: parseFloat(formData.cashAdvanceBalance) || 0,
      cashAdvanceInstallment: parseFloat(formData.cashAdvanceInstallment) || 0,
      loanBalance: parseFloat(formData.loanBalance) || 0,
      loanInstallment: parseFloat(formData.loanInstallment) || 0,
    };
    
    const url = editingId ? `${API_BASE_URL}/employees/${editingId}` : `${API_BASE_URL}/employees`;
    const method = editingId ? 'PATCH' : 'POST';

    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) { 
        const errorData = await response.json().catch(() => ({}));
        showToast(errorData.message || "Failed to save. Employee ID or Govt ID already exists.", "error"); 
        setIsSaving(false); 
        return; 
      }
      
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
      if (!response.ok) throw new Error();
      await fetchEmployees();
      showToast("Employee deleted successfully.", "success");
    } catch (error) { showToast("Failed to delete employee.", "error"); }
  };

  const openEditModal = (emp: Employee) => {
    setFormData({
      employeeId: emp.employeeId || '', 
      firstName: emp.firstName, middleName: emp.middleName || '', lastName: emp.lastName,
      dateOfBirth: emp.dateOfBirth ? emp.dateOfBirth.split('T')[0] : '', civilStatus: emp.civilStatus,
      address: emp.address, employmentStatus: emp.employmentStatus, baseRate: emp.baseRate.toString(),
      bankAccount: emp.bankAccount || '', tin: emp.tin || '', sssNumber: emp.sssNumber || '',
      philhealth: emp.philhealth || '', pagIbig: emp.pagIbig || '',
      cashAdvanceBalance: emp.cashAdvanceBalance ? emp.cashAdvanceBalance.toString() : '',
      cashAdvanceInstallment: emp.cashAdvanceInstallment ? emp.cashAdvanceInstallment.toString() : '',
      loanBalance: emp.loanBalance ? emp.loanBalance.toString() : '',
      loanInstallment: emp.loanInstallment ? emp.loanInstallment.toString() : ''
    });
    setEditingId(emp.id); setIsEditModalOpen(true); 
  };

  const applyShiftSettings = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ company: selectedCompany, shiftStart: tempShiftStart, shiftEnd: tempShiftEnd })
      });
      if (!response.ok) throw new Error();
      setShiftStart(tempShiftStart); setShiftEnd(tempShiftEnd);
      showToast("Shift updated permanently for this workspace!", "success");
    } catch (error) { showToast("Failed to save shift to database.", "error"); } 
    finally { setIsSaving(false); }
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
    if (tIn < sIn && (sIn - tIn) >= 12) { tIn += 24; tOut += 24; } 
    else if (tIn > sOut && (tIn - sOut) >= 12) { tIn -= 24; tOut -= 24; }

    let totalGrossHours = Math.max(0, tOut - tIn);
    
    if (totalGrossHours > 0) {
      totalGrossHours = Math.max(0, totalGrossHours - 1);
    }

    const maxRegularHours = 8;
    let regHrs = Math.min(totalGrossHours, maxRegularHours);
    let totalOt = Math.max(0, totalGrossHours - maxRegularHours);

    let earlyOt = 0; let lateOt = 0;
    if (totalOt > 0) {
      if (tIn < sIn) { earlyOt = Math.min(totalOt, sIn - tIn); lateOt = totalOt - earlyOt; } 
      else { lateOt = totalOt; }
    }

    return { reg: regHrs, ot: totalOt, earlyOt: earlyOt, lateOt: lateOt, total: regHrs + totalOt };
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

    if (log.type === 'paid_leave') { payload = { employeeId: empId, date: attendanceDate, timeIn: 'LEAVE', timeOut: 'PAID', hours: 8, reason: log.reason || null }; } 
    else if (log.type === 'unpaid_leave') { payload = { employeeId: empId, date: attendanceDate, timeIn: 'LEAVE', timeOut: 'UNPAID', hours: 0, reason: log.reason || null }; } 
    else {
      if (!log.timeIn || !log.timeOut) { showToast("Please enter both Time In and Time Out.", "error"); return; }
      const calculated = calculateShiftHours(log.timeIn, log.timeOut, shiftStart, shiftEnd);
      payload = { employeeId: empId, date: attendanceDate, timeIn: log.timeIn, timeOut: log.timeOut, hours: calculated.total, reason: null, shiftStart: shiftStart, shiftEnd: shiftEnd };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error();
      await fetchAttendances();
      setDailyTimeLogs(prev => { const newState = { ...prev }; delete newState[empId]; return newState; });
      showToast("Log saved successfully!", "success");
    } catch (error) { showToast("Failed to save attendance log.", "error"); }
  };

  const openEditLogModal = (log: AttendanceRecord) => {
    const isLeave = log.timeIn === 'LEAVE';
    let type = 'regular';
    if (isLeave) type = log.timeOut === 'PAID' ? 'paid_leave' : 'unpaid_leave';
    setEditLogForm({ date: log.date ? log.date.split('T')[0] : '', timeIn: isLeave ? '' : log.timeIn, timeOut: isLeave ? '' : log.timeOut, type, reason: log.reason || '' });
    setEditingLog(log);
  };

  const submitEditLog = async () => {
    if (!editingLog) return;
    setIsSaving(true);
    let payload;

    if (editLogForm.type === 'paid_leave') { payload = { date: editLogForm.date, timeIn: 'LEAVE', timeOut: 'PAID', hours: 8, reason: editLogForm.reason || null }; } 
    else if (editLogForm.type === 'unpaid_leave') { payload = { date: editLogForm.date, timeIn: 'LEAVE', timeOut: 'UNPAID', hours: 0, reason: editLogForm.reason || null }; } 
    else {
      if (!editLogForm.timeIn || !editLogForm.timeOut) { showToast("Please enter both Time In and Time Out.", "error"); setIsSaving(false); return; }
      const appliedStart = editingLog.shiftStart || shiftStart; const appliedEnd = editingLog.shiftEnd || shiftEnd;
      const calculated = calculateShiftHours(editLogForm.timeIn, editLogForm.timeOut, appliedStart, appliedEnd);
      payload = { date: editLogForm.date, timeIn: editLogForm.timeIn, timeOut: editLogForm.timeOut, hours: calculated.total, reason: null, shiftStart: appliedStart, shiftEnd: appliedEnd };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance/${editingLog.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error();
      await fetchAttendances(); setEditingLog(null); showToast("Log updated successfully!", "success");
    } catch (error) { showToast("Failed to update log.", "error"); } 
    finally { setIsSaving(false); }
  };

  const deleteAttendance = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      await fetchAttendances(); showToast("Log removed successfully.", "success");
    } catch (error) { showToast("Failed to delete log.", "error"); }
  };

  // --- EXCEL AGGREGATE PAYROLL ENGINE ---
  const openPayrollModal = (emp: Employee) => {
    setActiveEmployee(emp);
    const empLogs = attendances.filter(a => Number(a.employeeId) === emp.id && a.date && isLogWithinPayrollPeriod(a.date));
    const actualDays = new Set(empLogs.map(l => l.date && l.date.split('T')[0])).size;
    const defaultDays = actualDays > 0 ? actualDays.toString() : '14';
    const safeCashAdvanceDeduction = (emp.cashAdvanceBalance || 0) > 0 ? Math.min((emp.cashAdvanceInstallment || 0), emp.cashAdvanceBalance) : 0;
    const safeLoanDeduction = (emp.loanBalance || 0) > 0 ? Math.min((emp.loanInstallment || 0), emp.loanBalance) : 0;

    setPayrollData({ daysWorked: defaultDays, cashAdvance: safeCashAdvanceDeduction.toString(), companyLoan: safeLoanDeduction.toString(), sss: '0', pagIbig: '0', philhealth: '0', isDeclared: false, pagIbigLoan: '0', pagIbigHousingLoan: '0', sssProvident: '0', sssSalaryLoan: '0', sssCalamityLoan: '0', pagIbigCalamity: '0', pagIbigSalaryLoan: '0', govHolidayAmt: '' });
    setIsPayrollModalOpen(true);
  };

  const calculatePayroll = () => {
    if (!activeEmployee) return null;
    
    // 1. Group records by unique date to prevent duplicate logs from inflating hours
    const rawEmpLogs = attendances.filter(a => Number(a.employeeId) === activeEmployee.id && a.date && isLogWithinPayrollPeriod(a.date));
    const uniqueLogsMap = new Map();
    
    rawEmpLogs.forEach(log => {
      const dateStr = log.date.split('T')[0];
      let logHrs = 0;
      if (!log.timeIn || !log.timeIn.includes(':')) { 
          logHrs = log.hours || 0; 
      } else {
          const shiftCalc = calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd);
          logHrs = shiftCalc.total;
      }
      
      // If a duplicate exists, keep the one with the higher working hours
      const existing = uniqueLogsMap.get(dateStr);
      if (!existing || logHrs > existing.calculatedHours) {
        uniqueLogsMap.set(dateStr, { ...log, calculatedHours: logHrs });
      }
    });

    const empLogs = Array.from(uniqueLogsMap.values());
    
    // 2. Sum valid logged hours
    let totalHoursWorked = 0;
    empLogs.forEach((log: any) => {
        totalHoursWorked += log.calculatedHours;
    });

    const basicSalary = activeEmployee.baseRate;
    const days = parseFloat(payrollData.daysWorked) || 0;
    
    // 3. Hourly Rates
    const ratePerDay = days > 0 ? basicSalary / days : 0;
    const ratePerHour = ratePerDay / 8;
    
    const requiredHrs = days * 8;
    
    // 4. Compare Required vs Actual for strict mathematical difference
    const diffHrs = totalHoursWorked - requiredHrs;
    
    let otHrs = 0;
    let undertimeHrs = 0;
    
    if (diffHrs > 0) {
        otHrs = diffHrs;
    } else {
        undertimeHrs = Math.abs(diffHrs);
    }

    // 5. Calculate Deductions & Pay (Exact unrounded time multipliers to match Excel)
    const undertimeDeduction = Math.round((undertimeHrs * ratePerHour) * 100) / 100;
    const otPay = Math.round((otHrs * ratePerHour * 1.25) * 100) / 100;
    
    // 6. Gross Pay & Government Holiday / Excluded Day Adjustment
    const govHolidayAmt = parseFloat(payrollData.govHolidayAmt) || 0;
    const grossPay = Math.round((basicSalary - undertimeDeduction + otPay + govHolidayAmt) * 100) / 100;
    
    const sssDed = parseFloat(payrollData.sss) || 0; const pagIbigDed = parseFloat(payrollData.pagIbig) || 0; const philhealthDed = parseFloat(payrollData.philhealth) || 0; const pagIbigLoanDed = parseFloat(payrollData.pagIbigLoan) || 0; const pagIbigHousingLoanDed = parseFloat(payrollData.pagIbigHousingLoan) || 0; const sssProvidentDed = parseFloat(payrollData.sssProvident) || 0; const sssSalaryLoanDed = parseFloat(payrollData.sssSalaryLoan) || 0; const sssCalamityLoanDed = parseFloat(payrollData.sssCalamityLoan) || 0; const pagIbigCalamityDed = parseFloat(payrollData.pagIbigCalamity) || 0; const pagIbigSalaryLoanDed = parseFloat(payrollData.pagIbigSalaryLoan) || 0;
    
    let cashAdvanceDed = parseFloat(payrollData.cashAdvance) || 0;
    if (activeEmployee && cashAdvanceDed > (activeEmployee.cashAdvanceBalance || 0)) { cashAdvanceDed = activeEmployee.cashAdvanceBalance || 0; }

    let companyLoanDed = parseFloat(payrollData.companyLoan) || 0;
    if (activeEmployee && companyLoanDed > (activeEmployee.loanBalance || 0)) { companyLoanDed = activeEmployee.loanBalance || 0; }

    const taxableIncome = Math.round((grossPay - sssDed - pagIbigDed - philhealthDed) * 100) / 100;
    let autoTax = 0;

    if (payrollData.isDeclared && taxableIncome > 0) {
      const taxResult = calculateDynamicTax(taxableIncome, taxBrackets);
      autoTax = Math.round(taxResult.tax * 100) / 100;
    }

    const totalDeductions = Math.round((cashAdvanceDed + companyLoanDed + sssDed + pagIbigDed + philhealthDed + autoTax + pagIbigLoanDed + pagIbigHousingLoanDed + sssProvidentDed + sssSalaryLoanDed + sssCalamityLoanDed + pagIbigCalamityDed + pagIbigSalaryLoanDed) * 100) / 100;
    const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

    return { 
      totalHoursWorked, ratePerDay, ratePerHour, requiredHrs, 
      otHrs, otPay, undertimeDeduction, grossPay, autoTax, totalDeductions, netPay, 
      cashAdvanceDed, companyLoanDed, pagIbigLoanDed, pagIbigHousingLoanDed, sssProvidentDed, 
      sssSalaryLoanDed, sssCalamityLoanDed, pagIbigCalamityDed, pagIbigSalaryLoanDed, govHolidayAmt 
    };
  };

  const computed = calculatePayroll();

  const savePayrollToDatabase = async () => {
    if (!activeEmployee || !computed) return;
    setIsSaving(true);
    const payload = {
      employeeId: activeEmployee.id, daysWorked: parseFloat(payrollData.daysWorked) || 0, totalHours: computed.totalHoursWorked,
      cashAdvance: computed.cashAdvanceDed, companyLoan: computed.companyLoanDed, sssDeduction: parseFloat(payrollData.sss) || 0, pagIbigDeduct: parseFloat(payrollData.pagIbig) || 0, philhealthDeduct: parseFloat(payrollData.philhealth) || 0, tax: computed.autoTax, grossPay: computed.grossPay, netPay: computed.netPay, pagIbigLoan: computed.pagIbigLoanDed, pagIbigHousingLoan: computed.pagIbigHousingLoanDed, sssProvident: computed.sssProvidentDed, sssSalaryLoan: computed.sssSalaryLoanDed, sssCalamityLoan: computed.sssCalamityLoanDed, pagIbigCalamity: computed.pagIbigCalamityDed, pagIbigSalaryLoan: computed.pagIbigSalaryLoanDed
    };

    try {
      const response = await fetch(`${API_BASE_URL}/employees/payroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error();
      
      const balancePatches = [];
      if (computed.cashAdvanceDed > 0) {
        const newBalance = Math.max(0, activeEmployee.cashAdvanceBalance - computed.cashAdvanceDed);
        balancePatches.push(fetch(`${API_BASE_URL}/employees/${activeEmployee.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cashAdvanceBalance: newBalance }) }));
      }
      if (computed.companyLoanDed > 0) {
        const newLoanBalance = Math.max(0, activeEmployee.loanBalance - computed.companyLoanDed);
        balancePatches.push(fetch(`${API_BASE_URL}/employees/${activeEmployee.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loanBalance: newLoanBalance }) }));
      }

      if (balancePatches.length > 0) {
        await Promise.all(balancePatches);
      }

      await fetchPayrolls(); await fetchEmployees(); 
      showToast("Payroll finalized and saved to database!", "success");
      setIsPayrollModalOpen(false);
    } catch (error) { showToast("Failed to save payroll.", "error"); } 
    finally { setIsSaving(false); }
  };

  const deletePayroll = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/payroll/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      await fetchPayrolls(); showToast("Saved payroll record successfully removed.", "success");
    } catch (error) { showToast("Failed to remove payroll record.", "error"); }
  };

  const getFilteredReportData = (): SummaryReportRow[] => {
    const filteredPayrolls = payrolls.filter(pr => {
      const prDate = new Date(pr.createdAt);
      const from = reportFromDate ? new Date(reportFromDate) : null;
      const to = reportToDate ? new Date(reportToDate) : null;
      if (from) { from.setHours(0, 0, 0, 0); if (prDate < from) return false; }
      if (to) { to.setHours(23, 59, 59, 999); if (prDate > to) return false; }
      if (reportSelectedEmp !== 'all' && pr.employeeId.toString() !== reportSelectedEmp) return false;
      return true;
    });

    return employees.filter(emp => emp.company === selectedCompany).map(emp => {
      const empPayrolls = filteredPayrolls.filter(pr => pr.employeeId === emp.id);
      if (empPayrolls.length === 0) return null;
      const totalHours = empPayrolls.reduce((sum, pr) => sum + pr.totalHours, 0);
      const totalDays = empPayrolls.reduce((sum, pr) => sum + pr.daysWorked, 0);
      const totalGross = empPayrolls.reduce((sum, pr) => sum + pr.grossPay, 0);
      const totalDeductions = empPayrolls.reduce((sum, pr) => sum + (pr.cashAdvance + (pr.companyLoan || 0) + pr.sssDeduction + pr.pagIbigDeduct + pr.philhealthDeduct + pr.tax), 0);
      const totalNet = empPayrolls.reduce((sum, pr) => sum + pr.netPay, 0);
      const requiredHrs = totalDays * 8;
      const otHours = Math.max(0, totalHours - requiredHrs);
      return { emp, totalHours, totalDays, otHours, totalGross, totalDeductions, totalNet, count: empPayrolls.length };
    }).filter(Boolean) as SummaryReportRow[];
  };

  const handleGenerateReport = () => {
    setIsReportModalOpen(true);
  };

  const getStatusStyle = (status: string) => {
    switch(status) {
      case 'Regular': return 'bg-blue-50 text-blue-700 ring-blue-600/20';
      case 'Contractual': return 'bg-slate-100 text-slate-700 ring-slate-600/20';
      case 'Probationary': return 'bg-sky-50 text-sky-700 ring-sky-600/20';
      default: return 'bg-slate-50 text-slate-700 ring-slate-600/20';
    }
  };

  const filteredEmployees = employees.filter(emp => {
    if (emp.company !== selectedCompany) return false; 
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const fullName = `${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}`.toLowerCase();
    return fullName.includes(query) || emp.employmentStatus.toLowerCase().includes(query) || (emp.bankAccount && emp.bankAccount.includes(query)) || (emp.employeeId && emp.employeeId.includes(query));
  });

  const filteredAttendanceEmployees = employees.filter(emp => {
    if (emp.company !== selectedCompany) return false; 
    if (!attendanceSearchQuery) return true;
    const query = attendanceSearchQuery.toLowerCase();
    const fullName = `${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}`.toLowerCase();
    const empId = emp.employeeId ? emp.employeeId.toLowerCase() : '';
    return fullName.includes(query) || empId.includes(query);
  });

  const filteredActiveEmployees = employees.filter(emp => {
    if (emp.company !== selectedCompany) return false; 
    if (!payrollActiveSearchQuery) return true;
    const query = payrollActiveSearchQuery.toLowerCase();
    const fullName = `${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}`.toLowerCase();
    const empId = emp.employeeId ? emp.employeeId.toLowerCase() : '';
    return fullName.includes(query) || empId.includes(query);
  });

  const filteredSavedPayrolls = payrolls.filter(pr => {
    const emp = employees.find(e => e.id === Number(pr.employeeId));
    if (!emp || emp.company !== selectedCompany) return false; 
    if (!payrollHistorySearchQuery) return true;
    const query = payrollHistorySearchQuery.toLowerCase();
    const fullName = `${emp.firstName} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName}`.toLowerCase();
    const dateStr = formatMDY(pr.createdAt).toLowerCase();
    return fullName.includes(query) || dateStr.includes(query);
  });

  const getPageTitle = () => {
    switch(activeTab) {
      case 'dashboard': return 'System Overview'; case 'list': return 'Personnel Directory'; case 'add': return 'Register Employee'; case 'attendance': return 'Attendance Logs'; case 'payroll': return 'Payroll Engine'; case 'tax': return 'Tax Reports'; case 'report': return 'Summary Reports'; default: return 'Admin Panel';
    }
  };

  // --- UI RENDER ---
  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden print:h-auto print:block selection:bg-blue-100">
      
      {/* FOOLPROOF SINGLE-PAGE PRINT CSS */}
      <style>{`
        @media print {
          @page { size: auto; margin: 0; }
          html, body, #root { height: 100% !important; max-height: 100vh !important; overflow: hidden !important; background: white !important; margin: 0 !important; padding: 0 !important; }
          ::-webkit-scrollbar { display: none; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .print-hidden { display: none !important; height: 0 !important; width: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; position: absolute !important; }
          .print-modal-release { position: absolute !important; left: 0 !important; top: 0 !important; background: transparent !important; padding: 0 !important; display: block !important; z-index: 1 !important; height: auto !important; width: 100% !important; }
          .print-modal-box { box-shadow: none !important; max-width: none !important; max-height: none !important; border: none !important; border-radius: 0 !important; display: block !important; overflow: visible !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .print-modal-content { padding: 0 !important; background: transparent !important; display: block !important; overflow: visible !important; width: 100% !important; }
          #payslip-print-area, #report-print-area { page-break-inside: avoid !important; break-inside: avoid !important; page-break-after: avoid !important; break-after: avoid !important; width: 100% !important; border: none !important; padding: 0 !important; margin: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* 1. ALL MODALS PLACED SAFELY AT THE ROOT OF THE COMPONENT */}
      
      {/* TOAST */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-semibold flex items-center gap-3 animate-in slide-in-from-right-8 slide-in-from-bottom-2 fade-in duration-300 ease-out border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'} print-hidden`}>
          {toast.message}
        </div>
      )}

      {/* EDIT EMPLOYEE MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm print-hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="flex justify-between items-center p-4 sm:p-5 border-b border-slate-200 bg-slate-50/80 shrink-0">
              <h2 className="text-lg sm:text-xl font-bold text-blue-950">Edit Employee Record</h2>
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors">✕</button>
            </div>
            <form onSubmit={handleSubmitEmployee} className="flex flex-col flex-1 overflow-hidden">
              <div className="overflow-y-auto p-4 sm:p-6 flex-1 space-y-6">
                <EmployeeFormFields formData={formData} handleChange={handleFormattedChange} />
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 p-4 sm:p-5 border-t border-slate-200 bg-slate-50/80 shrink-0">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="w-full sm:w-auto py-2.5 px-6 bg-white border border-slate-300 text-slate-700 rounded-xl font-semibold hover:bg-slate-100 transition-colors text-sm sm:text-base shadow-sm">Cancel</button>
                <button type="submit" disabled={isSaving} className="w-full sm:w-auto py-2.5 px-8 bg-blue-700 hover:bg-blue-800 text-white rounded-xl font-semibold shadow-sm transition-colors disabled:opacity-50 text-sm sm:text-base">{isSaving ? "Saving..." : "Save Changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MONTHLY LOGS MODAL */}
      {monthLogsModalEmp && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print-hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="flex justify-between items-center p-6 border-b border-slate-200 bg-indigo-50/50 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-indigo-950">Monthly Logs: {monthLogsModalEmp.firstName} {monthLogsModalEmp.lastName}</h2>
                <p className="text-sm text-indigo-700 font-medium mt-1">{formatMonthYear(attendanceMonth)}</p>
              </div>
              <button onClick={() => setMonthLogsModalEmp(null)} className="text-slate-400 hover:text-slate-600 p-2">✕</button>
            </div>
            <div className="overflow-y-auto p-6 bg-slate-50 flex flex-col gap-3">
              {(() => {
                const monthLogs = attendances.filter(a => Number(a.employeeId) === monthLogsModalEmp.id && a.date && a.date.split('T')[0].startsWith(attendanceMonth)).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                if (monthLogs.length === 0) return <div className="text-center py-8 text-slate-500 italic">No logs found for this month.</div>;
                return monthLogs.map(log => {
                  const isLeave = log.timeIn === 'LEAVE';
                  const hasFullPunch = log.timeIn && log.timeOut && !isLeave;
                  const shiftDetails = hasFullPunch ? calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd) : { reg: 0, ot: 0, earlyOt: 0, lateOt: 0, total: 0 };
                  return (
                    <div key={log.id} className="flex items-center justify-between gap-3 text-sm border border-slate-200 bg-white rounded-xl px-5 py-3.5 shadow-sm w-full group/log whitespace-nowrap hover:border-indigo-300 transition-colors">
                      <span className="font-bold text-slate-700 w-[95px]">{formatMDY(log.date)}</span>
                      <span className="text-slate-200">|</span>
                      <span className="font-mono font-bold text-indigo-900 min-w-[150px]">
                        {isLeave ? `${log.timeIn} (${log.timeOut})${log.reason ? ` - ${log.reason}` : ''}` : `${log.timeIn ? format12Hour(log.timeIn) : '--:--'} to ${log.timeOut ? format12Hour(log.timeOut) : '--:--'}`}
                      </span>
                      <span className="text-slate-200">|</span>
                      <span className="font-bold text-indigo-600 w-[70px]">Reg: {formatDecToHM(shiftDetails.reg)}</span>
                      <span className="text-slate-200">|</span>
                      {shiftDetails.earlyOt > 0 ? <span className="font-bold text-amber-600 w-[70px]" title="Early Hours">Early: {formatDecToHM(shiftDetails.earlyOt)}</span> : <span className="font-medium text-slate-400 w-[70px]">Early: --</span>}
                      <span className="text-slate-200">|</span>
                      {shiftDetails.lateOt > 0 ? <span className="font-bold text-amber-600 w-[75px]" title="Late Overtime">Late OT: {formatDecToHM(shiftDetails.lateOt)}</span> : <span className="font-medium text-slate-400 w-[75px]">Late OT: --</span>}
                      <span className="text-slate-200">|</span>
                      <span className={`font-bold w-[75px] text-right ${shiftDetails.total > 0 || log.hours > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{isLeave ? log.hours.toFixed(2) : shiftDetails.total.toFixed(2)} hrs</span>
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

      {/* EDIT ATTENDANCE MODAL */}
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

      {/* GENERATE PAYSLIP MODAL */}
      {selectedPayslip && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print-modal-release">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col overflow-hidden relative print-modal-box">
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

            <div className="overflow-y-auto p-4 sm:p-10 bg-gray-50 flex justify-center items-start print-modal-content">
              <div id="payslip-print-area" className="bg-white w-full max-w-4xl font-sans text-black print:pt-12 print:px-8 print:pb-8">
  <h2 className="hidden print:block text-center text-xl font-black uppercase mb-6 tracking-widest text-slate-900">
    {selectedCompany} TRADING CORP.
  </h2>
                {(() => {
                  const rec = selectedPayslip.record;
                  const emp = selectedPayslip.emp;
                  const baseSalary = emp.baseRate;
                  const days = rec.daysWorked || 0;
                  const ratePerDay = days > 0 ? baseSalary / days : 0;
                  const ratePerHour = ratePerDay / 8;
                  const requiredHrs = days * 8;
                  const diffHrs = rec.totalHours - requiredHrs;
                  
                  let undertimeDeduction = 0;
                  let otPay = 0;
                  if (diffHrs < 0) { 
                      undertimeDeduction = Math.abs(diffHrs) * ratePerHour; 
                  } else if (diffHrs > 0) {
                      otPay = diffHrs * ratePerHour * 1.25;
                  }
                  
                  const regularPay = baseSalary - undertimeDeduction;
                  const standardEarnings = regularPay + otPay; 
                  
                  // Dynamically extract any manual government holiday adjustments
                  // by comparing the calculated standard earning vs what was actually saved
                  const manualAdjustment = rec.grossPay - standardEarnings;
                  const totalEarnings = rec.grossPay; 
                  
                  const totalDeductionsCalc = rec.cashAdvance + (rec.companyLoan || 0) + rec.sssDeduction + rec.pagIbigDeduct + rec.philhealthDeduct + rec.tax;

                  return (
                    <table className="w-full text-left border-collapse border border-slate-300 text-[11px] sm:text-xs text-slate-700 bg-white shadow-sm print:shadow-none">
                      <colgroup><col className="w-[18%]" /><col className="w-[18%]" /><col className="w-[4%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /></colgroup>
                      <tbody>
                        <tr><td colSpan={5} className="border border-slate-300 bg-indigo-600 text-white font-bold text-center py-2.5 text-xs uppercase tracking-widest">{selectedCompany?.toUpperCase()} TRADING CORP.</td><td colSpan={4} className="border border-slate-300 border-l-0 bg-white"></td></tr>
                        <tr><td colSpan={5} className="border border-slate-300 bg-slate-100 font-bold px-3 py-2 uppercase text-slate-800"><span className="text-[10px] text-slate-500">Employee's Name :</span> <span className="ml-2 font-bold text-sm text-slate-900">{emp.lastName}, {emp.firstName}</span></td><td colSpan={4} className="border border-slate-300 bg-slate-100 font-bold px-3 py-2 text-center uppercase text-slate-800">Date: {formatMDY(rec.createdAt)} ({rec.daysWorked} WORKING DAYS)</td></tr>
                        <tr><td colSpan={5} className="border border-slate-300 text-center font-bold py-1.5 bg-slate-50 uppercase text-slate-600 tracking-wider">Earnings</td><td colSpan={4} className="border border-slate-300 px-3 py-1.5 font-bold bg-slate-50 text-slate-600">NO. OF DAYS PRESENT: <span className="font-bold text-indigo-700 ml-1">{rec.daysWorked}</span></td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium text-slate-800">BASIC SALARY</td><td className="border border-slate-300 px-1 text-center font-medium text-slate-400">₱</td><td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{formatMoney(baseSalary)}</td><td colSpan={4} rowSpan={11} className="border border-slate-300 bg-white"></td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE PER HOUR</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatMoney(ratePerHour)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE PER DAY</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatMoney(ratePerDay)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">TOTAL HOURS</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatDecToHM(rec.totalHours)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">REQUIRED NO.OF HOURS</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatDecToHM(requiredHrs)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-bold text-slate-800">REGULAR PAY</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{formatMoney(regularPay)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">OT HOURS</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{diffHrs > 0 ? formatDecToHM(diffHrs) : '-'}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE FOR OT</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{diffHrs > 0 ? formatMoney(ratePerHour * 1.25) : '-'}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-bold text-slate-800">OT PAY</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{otPay > 0 ? formatMoney(otPay) : '-'}</td></tr>
                        {Math.abs(manualAdjustment) > 0.01 ? (
                           <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">GOVT HOLIDAY / ADJ</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{manualAdjustment > 0 ? '+' : ''}{formatMoney(manualAdjustment)}</td></tr>
                        ) : (
                           <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">HOLIDAY</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td></tr>
                        )}
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">SUNDAY</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td></tr>
                        <tr><td colSpan={5} className="border border-slate-300 bg-white border-t-0"></td><td colSpan={2} className="border border-slate-300 px-3 py-1.5 text-right font-bold text-slate-800 bg-slate-50 uppercase text-[10px] tracking-wider border-l-0">Total Earnings:</td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono font-bold text-emerald-700 bg-emerald-50 border-b-2 border-slate-400 text-sm">{formatMoney(totalEarnings)}</td></tr>
                      {(() => {
                          const activeDeductions = [
                            { label: 'Advances', value: rec.cashAdvance || 0 }, 
                            { label: 'Company Loan', value: rec.companyLoan || 0 }, 
                            { label: 'SSS', value: rec.sssDeduction || 0 }, 
                            { label: 'PhilHealth', value: rec.philhealthDeduct || 0 }, 
                            { label: 'Pag-IBIG', value: rec.pagIbigDeduct || 0 }, 
                            { label: 'Pag-IBIG MP Loan', value: rec.pagIbigLoan || 0 }, 
                            { label: 'Pag-IBIG Housing Loan', value: rec.pagIbigHousingLoan || 0 }, 
                            { label: 'SSS Provident', value: rec.sssProvident || 0 }, 
                            { label: 'SSS Salary Loan', value: rec.sssSalaryLoan || 0 }, 
                            { label: 'SSS Calamity Loan', value: rec.sssCalamityLoan || 0 }, 
                            { label: 'Pag-IBIG Calamity', value: rec.pagIbigCalamity || 0 }, 
                            { label: 'Pag-IBIG Salary Loan', value: rec.pagIbigSalaryLoan || 0 }, 
                            { label: 'Withholding Tax', value: rec.tax || 0 }
                          ].filter(d => d.value > 0);
                          const rowSpanCount = activeDeductions.length > 0 ? activeDeductions.length + 1 : 2;

                          return (
                            <>
                              <tr><td colSpan={5} className="border border-slate-300 text-center font-bold py-1.5 bg-slate-50 text-slate-600 uppercase tracking-wider">Deductions</td><td colSpan={4} rowSpan={rowSpanCount} className="border border-slate-300 bg-white"></td></tr>
                              {activeDeductions.length === 0 ? (
                                <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium text-slate-400 italic">No Deductions</td><td className="border border-slate-300 px-1 text-center font-medium text-slate-400"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">-</td></tr>
                              ) : (
                                activeDeductions.map((ded, idx) => (
                                  <tr key={idx}><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">{ded.label}</td><td className="border border-slate-300 px-1 text-center font-medium text-slate-400">{idx === 0 ? '₱' : ''}</td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{formatMoney(ded.value)}</td></tr>
                                ))
                              )}
                            </>
                          );
                        })()}
                        <tr><td colSpan={5} className="border border-slate-300 bg-white border-t-0"></td><td colSpan={2} className="border border-slate-300 px-3 py-1.5 text-right font-bold text-slate-800 bg-slate-50 uppercase text-[10px] tracking-wider border-l-0">Total Deductions:</td><td colSpan={2} className="border border-slate-300 px-3 py-1.5 text-right font-mono font-bold text-rose-700 bg-rose-50 border-b-2 border-slate-400 text-sm">{formatMoney(totalDeductionsCalc)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-bold text-slate-600 bg-slate-50">Outstanding:</td><td colSpan={3} className="border border-slate-300 bg-slate-50"></td><td colSpan={4} rowSpan={3} className="border border-slate-300 bg-white"></td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 pl-6 font-medium">Cash Advances</td><td colSpan={3} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{(emp.cashAdvanceBalance || 0) > 0 ? formatMoney(emp.cashAdvanceBalance) : '-'}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 pl-6 font-medium">Company Loan</td><td colSpan={3} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{(emp.loanBalance || 0) > 0 ? formatMoney(emp.loanBalance) : '-'}</td></tr>
                        <tr><td colSpan={3} className="border border-slate-300 px-3 py-3 text-slate-600">Prepared by: <span className="ml-2 uppercase font-bold text-slate-800 text-[10px]">SYSTEM ADMIN</span></td><td colSpan={2} className="border border-slate-300 font-bold text-right px-3 text-emerald-800 bg-emerald-50 text-[10px] uppercase">Net Earnings:</td><td colSpan={4} className="border-4 border-emerald-500 px-3 text-right font-mono font-black text-[15px] bg-emerald-50 text-emerald-900 shadow-inner">{formatMoney(rec.netPay)}</td></tr>
                        <tr><td colSpan={3} className="border border-slate-300 px-3 py-2 text-slate-600">Checked by: <span className="ml-2 uppercase font-bold text-slate-800 text-[10px]">{emp.firstName} {emp.lastName}</span></td><td colSpan={2} className="border-b border-slate-300 text-right px-3 py-1 text-sm font-bold text-slate-800 bg-slate-50">{formatMoney(rec.netPay)}</td><td colSpan={4} className="border border-slate-300 border-t-0 bg-white px-4 pb-2 text-center align-bottom h-16"><div className="w-48 mx-auto border-b border-slate-800 mb-1 mt-6"></div><div className="text-[10px] font-bold text-slate-600 uppercase">Received By (Signature)</div></td></tr>
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* COMPUTE PAYROLL MODAL */}
      {isPayrollModalOpen && activeEmployee && computed && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-900/50 backdrop-blur-sm print-hidden">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[98vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="flex justify-between items-center p-3 sm:p-4 border-b border-slate-200 bg-emerald-50/50 shrink-0">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-emerald-950 leading-tight">Compute Payroll: {activeEmployee.firstName} {activeEmployee.lastName}</h2>
                <p className="text-[10px] sm:text-xs text-emerald-700 font-mono mt-0.5">Basic Salary: ₱{activeEmployee.baseRate.toLocaleString()} / Cutoff</p>
              </div>
              <button onClick={() => setIsPayrollModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-emerald-100 transition-colors">✕</button>
            </div>
            <div className="overflow-y-auto p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-4 items-start">
              <div className="space-y-3">
                <h3 className="font-bold text-slate-800 border-b pb-1.5 text-[10px] sm:text-xs uppercase tracking-wider">Time & Attendance</h3>
                <div className="grid grid-cols-4 gap-2 sm:gap-3">
                  <InputField compact type="number" step="0.1" label="Working Days" value={payrollData.daysWorked} onChange={(e: any) => setPayrollData({...payrollData, daysWorked: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="Govt Adj (±)" placeholder="0.00" value={payrollData.govHolidayAmt} onChange={(e: any) => setPayrollData({...payrollData, govHolidayAmt: e.target.value})} />
                  <InputField compact type="text" disabled label="Logged Hours" value={formatDecToHM(computed.totalHoursWorked)} />
                  <InputField compact type="text" disabled label="OT Hours" value={formatDecToHM(computed.otHrs)} />
                </div>
                <h3 className="font-bold text-slate-800 border-b pb-1.5 mt-2 text-[10px] sm:text-xs uppercase tracking-wider">Deductions</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-start">
                  <div className="flex flex-col w-full">
                    <InputField compact type="number" step="0.01" label="Cash Advance" value={payrollData.cashAdvance} onChange={(e: any) => setPayrollData({...payrollData, cashAdvance: e.target.value})} />
                    {(activeEmployee?.cashAdvanceBalance || 0) > 0 && (
                      <span className="text-[9px] font-bold text-amber-600 mt-0.5 ml-1 leading-tight tracking-tight">Rem: ₱{formatMoney(Math.max(0, (activeEmployee!.cashAdvanceBalance || 0) - (parseFloat(payrollData.cashAdvance) || 0)))}</span>
                    )}
                  </div>
                  <div className="flex flex-col w-full">
                    <InputField compact type="number" step="0.01" label="Company Loan" value={payrollData.companyLoan} onChange={(e: any) => setPayrollData({...payrollData, companyLoan: e.target.value})} />
                    {(activeEmployee?.loanBalance || 0) > 0 && (
                      <span className="text-[9px] font-bold text-amber-600 mt-0.5 ml-1 leading-tight tracking-tight">Rem: ₱{formatMoney(Math.max(0, (activeEmployee!.loanBalance || 0) - (parseFloat(payrollData.companyLoan) || 0)))}</span>
                    )}
                  </div>
                  <InputField compact type="number" step="0.01" label="SSS" value={payrollData.sss} onChange={(e: any) => setPayrollData({...payrollData, sss: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="Pag-IBIG" value={payrollData.pagIbig} onChange={(e: any) => setPayrollData({...payrollData, pagIbig: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="PhilHealth" value={payrollData.philhealth} onChange={(e: any) => setPayrollData({...payrollData, philhealth: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="Pag-IBIG MP" value={payrollData.pagIbigLoan} onChange={(e: any) => setPayrollData({...payrollData, pagIbigLoan: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="Pag-IBIG Housing" value={payrollData.pagIbigHousingLoan} onChange={(e: any) => setPayrollData({...payrollData, pagIbigHousingLoan: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="SSS Provident" value={payrollData.sssProvident} onChange={(e: any) => setPayrollData({...payrollData, sssProvident: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="SSS Salary" value={payrollData.sssSalaryLoan} onChange={(e: any) => setPayrollData({...payrollData, sssSalaryLoan: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="SSS Calamity" value={payrollData.sssCalamityLoan} onChange={(e: any) => setPayrollData({...payrollData, sssCalamityLoan: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="Pag-IBIG Salary" value={payrollData.pagIbigSalaryLoan} onChange={(e: any) => setPayrollData({...payrollData, pagIbigSalaryLoan: e.target.value})} />
                  <InputField compact type="number" step="0.01" label="Pag-IBIG Calamity" value={payrollData.pagIbigCalamity} onChange={(e: any) => setPayrollData({...payrollData, pagIbigCalamity: e.target.value})} />
                  <div className="flex flex-col justify-end w-full h-full sm:col-span-2">
                    <label className={`flex items-center gap-2 p-1.5 border rounded-lg cursor-pointer transition-colors shadow-sm h-[42px] ${payrollData.isDeclared ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-slate-300 hover:bg-slate-50'}`}>
                      <input type="checkbox" checked={payrollData.isDeclared} onChange={(e) => setPayrollData({...payrollData, isDeclared: e.target.checked})} className="w-3.5 h-3.5 ml-1 text-indigo-600 rounded border-slate-300 focus:ring-indigo-600 shrink-0"/>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-800 leading-none mt-0.5">Declared Salary</span>
                        {payrollData.isDeclared ? (
                          <span className="text-[9px] font-mono font-bold text-rose-600 mt-1">-₱{computed.autoTax.toLocaleString(undefined, {minimumFractionDigits: 2})} Tax</span>
                        ) : (
                          <span className="text-[9px] text-slate-500 mt-1">Apply BIR Tax</span>
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col h-full">
                <h3 className="font-bold text-slate-800 border-b pb-1.5 mb-2.5 text-[11px] uppercase tracking-wider">Calculation Breakdown</h3>
                <div className="space-y-1 text-xs flex-1">
                  <div className="flex justify-between"><span className="text-slate-500">Rate per Day:</span> <span className="font-mono">₱{computed.ratePerDay.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Rate per Hour:</span> <span className="font-mono">₱{computed.ratePerHour.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Required Hours:</span> <span className="font-mono">{formatDecToHM(computed.requiredHrs)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Valid Logged Hours:</span> <span className="font-mono">{formatDecToHM(computed.totalHoursWorked)}</span></div>
                  
                 {computed.govHolidayAmt !== 0 && (
                    <div className={`flex justify-between font-medium ${computed.govHolidayAmt > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'} p-1.5 rounded-lg border ${computed.govHolidayAmt > 0 ? 'border-emerald-100' : 'border-rose-100'} mt-1 mb-1 text-[11px]`}>
                      <span>Govt Holiday / Adjustment:</span> 
                      <span className="font-mono">{computed.govHolidayAmt > 0 ? '+' : '-'} ₱{Math.abs(computed.govHolidayAmt).toFixed(2)}</span>
                    </div>
                  )}

                  {computed.otHrs > 0 && (
                    <div className="flex justify-between font-medium text-emerald-700 bg-emerald-50 p-1.5 rounded-lg border border-emerald-100 mt-1 mb-1 text-[11px]">
                      <span>Total Overtime ({computed.otHrs.toFixed(4)} hrs @ 125%):</span> 
                      <span className="font-mono">+ ₱{computed.otPay.toFixed(2)}</span>
                    </div>
                  )}
                  {computed.undertimeDeduction > 0 && (
                    <div className="flex justify-between font-medium text-rose-700 bg-rose-50 p-1.5 rounded text-[11px]">
                      <span>Lates/Undertime Deduction:</span> 
                      <span className="font-mono">- ₱{computed.undertimeDeduction.toFixed(2)}</span>
                    </div>
                  )}
                  <hr className="my-1.5 border-slate-200" />
                  <div className="flex justify-between font-bold text-slate-800 text-sm"><span>Gross Pay:</span> <span className="font-mono">₱{computed.grossPay.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                  {computed.autoTax > 0 && (
                    <div className="flex justify-between font-medium text-rose-700 bg-rose-50 p-1.5 rounded border border-rose-100 text-[11px]">
                      <span>Withholding Tax (Auto):</span> 
                      <span className="font-mono">- ₱{computed.autoTax.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-rose-600 font-semibold text-[11px]"><span>Total Deductions:</span> <span className="font-mono">- ₱{computed.totalDeductions.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                </div>

                <div className="mt-3 p-3 bg-emerald-950 text-white rounded-xl shadow-inner text-center overflow-hidden shrink-0">
                  <p className="text-emerald-200 text-[10px] font-semibold uppercase tracking-widest mb-0.5">Final Net Pay</p>
                  <p className="text-3xl font-mono font-bold break-all">₱{computed.netPay.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>

                <button onClick={savePayrollToDatabase} disabled={isSaving} className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white rounded-xl font-bold shadow-sm transition-colors text-sm shrink-0">
                  {isSaving ? "Saving..." : "Close & Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUMMARY REPORT PRINT MODAL */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print-modal-release">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden relative print-modal-box">
            
            <div className="flex justify-between items-center p-5 border-b border-slate-200 bg-amber-50 z-10 sticky top-0 no-print shrink-0">
              <div>
                <h2 className="font-bold text-amber-900 text-lg">Payroll Summary Report</h2>
                <p className="text-xs font-medium text-amber-700 mt-0.5">
                  {reportFromDate ? formatMDY(reportFromDate) : 'Start'} to {reportToDate ? formatMDY(reportToDate) : 'End'}
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="bg-blue-600 text-white px-5 py-2.5 rounded-lg shadow-sm font-bold text-sm hover:bg-blue-700 flex items-center gap-2 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  Print Report
                </button>
                <button onClick={() => setIsReportModalOpen(false)} className="bg-white border border-slate-300 text-slate-700 px-5 py-2.5 rounded-lg shadow-sm font-bold text-sm hover:bg-slate-50 transition-colors">Close</button>
              </div>
            </div>

            <div className="overflow-y-auto p-8 bg-white flex justify-center items-start print-modal-content">
              <div id="report-print-area" className="w-full max-w-5xl font-sans text-black print:p-12">
                
                <div className="hidden print:block mb-8 border-b-2 border-slate-900 pb-4">
                  <h1 className="text-2xl font-black uppercase text-slate-900">{selectedCompany} TRADING CORP.</h1>
                  <h2 className="text-lg font-bold text-slate-600 uppercase mt-1">Payroll Summary Report</h2>
                  <p className="text-sm font-medium text-slate-500 mt-1">
                    Period: {reportFromDate ? formatMDY(reportFromDate) : 'Beginning'} - {reportToDate ? formatMDY(reportToDate) : 'Present'}
                  </p>
                </div>

                <table className="w-full text-left border-collapse text-sm whitespace-nowrap min-w-[800px]">
                  <thead className="bg-amber-100/50 text-amber-950 border-y-2 border-slate-900 print:bg-slate-100">
                    <tr>
                      <th className="py-3 px-4 font-black uppercase text-xs">Employee Name</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-center">Payrolls</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-center">Total Days</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-center">Total Hrs</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-right">Gross Pay</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-right">Deductions</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-right">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {getFilteredReportData().length === 0 ? (
                      <tr><td colSpan={7} className="py-12 text-center text-slate-500 font-medium">No records found for this period.</td></tr>
                    ) : (
                      <>
                        {getFilteredReportData().map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-bold text-slate-800 uppercase">{row.emp.lastName}, {row.emp.firstName}</td>
                            <td className="py-3 px-4 text-center text-slate-600 font-medium">{row.count}</td>
                            <td className="py-3 px-4 text-center text-slate-600 font-medium">{row.totalDays}</td>
                            <td className="py-3 px-4 text-center text-slate-600 font-medium">{row.totalHours.toFixed(2)}</td>
                            <td className="py-3 px-4 text-right text-slate-700 font-mono">₱{row.totalGross.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            <td className="py-3 px-4 text-right text-rose-600 font-mono">-₱{row.totalDeductions.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            <td className="py-3 px-4 text-right font-black text-slate-900 font-mono text-[15px]">₱{row.totalNet.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 border-t-2 border-slate-900 font-black">
                          <td colSpan={4} className="py-3 px-4 text-right uppercase text-slate-800 text-xs tracking-widest">Grand Totals:</td>
                          <td className="py-3 px-4 text-right text-slate-900 font-mono">₱{getFilteredReportData().reduce((s, r) => s + r.totalGross, 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                          <td className="py-3 px-4 text-right text-rose-700 font-mono">-₱{getFilteredReportData().reduce((s, r) => s + r.totalDeductions, 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                          <td className="py-3 px-4 text-right text-indigo-700 font-mono text-lg bg-indigo-50 border-b-4 border-indigo-200">₱{getFilteredReportData().reduce((s, r) => s + r.totalNet, 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>

                <div className="hidden print:flex mt-16 justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-widest">
                  <div>Printed By: {loginUsername}</div>
                  <div>Date Printed: {new Date().toLocaleDateString()}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR NAVIGATION & OVERLAY */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden print-hidden" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}
      
      <aside className={`fixed inset-y-0 left-0 z-50 transform bg-slate-900 text-slate-300 flex flex-col flex-shrink-0 w-64 transition-transform duration-300 ease-in-out md:relative md:translate-x-0 print-hidden border-r border-slate-800 shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950">
          <h1 className="text-xl font-black text-white tracking-wider uppercase">{selectedCompany}<span className="text-blue-500">Admin</span></h1>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white">
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <div className="px-3 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Main Menu</div>
          <button onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Dashboard Overview</button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Personnel</div>
          <button onClick={() => { setActiveTab('list'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'list' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Directory List</button>
          <button onClick={() => { setActiveTab('add'); setFormData(initialFormState); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'add' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Register New</button>
          <button onClick={() => { setActiveTab('attendance'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'attendance' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Log Attendance</button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Finance</div>
          <button onClick={() => { setActiveTab('payroll'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'payroll' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Compute Payroll</button>
          <button onClick={() => { setActiveTab('tax'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'tax' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Tax Reports</button>
          <button onClick={() => { setActiveTab('report'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'report' ? 'bg-amber-600 text-white shadow-md shadow-amber-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Summary Reports</button>
        </div>
      </aside>

      {/* MAIN WORKSPACE CANVAS */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden print:h-auto print:block">
        
        {/* TOP HEADER */}
        <header className="h-auto sm:h-20 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-8 py-3 sm:py-0 shadow-sm relative z-10 print-hidden shrink-0 gap-3 sm:gap-0">
          <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 sm:p-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors border border-slate-200 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg sm:text-2xl font-extrabold text-blue-950 tracking-tight truncate">{getPageTitle()}</h2>
              <div className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-0.5 flex items-center gap-1.5 sm:gap-2">
                <span>Admin Panel</span> <span className="hidden sm:inline">/</span> <span className="text-blue-600 truncate">{getPageTitle()}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-end">
            <button onClick={onBack} className="flex-1 sm:flex-none flex justify-center px-4 py-2 sm:py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs sm:text-sm font-bold transition-colors shadow-sm border border-blue-200 items-center gap-1.5 sm:gap-2 whitespace-nowrap">
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              <span className="hidden sm:inline">Gateway</span>
              <span className="sm:hidden">Back</span>
            </button>
            <button onClick={onLogout} className="flex-1 sm:flex-none flex justify-center px-4 sm:px-6 py-2 sm:py-2 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 rounded-lg text-xs sm:text-sm font-bold transition-colors shadow-sm border border-slate-200 whitespace-nowrap">
              Logout
            </button>
          </div>
        </header>

        {/* SCROLLABLE MAIN CONTENT */}
        <main className={`flex-1 overflow-y-auto p-4 sm:p-8 relative print:p-0 print:overflow-visible ${selectedPayslip ? 'print-hidden' : ''}`}>
          <div className="max-w-[1400px] mx-auto space-y-6 sm:space-y-8">

            {/* DASHBOARD TAB */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6 print-hidden">
                {(() => {
                  const companyEmployees = employees.filter(emp => emp.company === selectedCompany);
                  const companyPayrolls = payrolls.filter(pr => {
                    const emp = employees.find(e => e.id === Number(pr.employeeId));
                    return emp && emp.company === selectedCompany;
                  });
                  const companyAttendances = attendances.filter(a => {
                    const emp = employees.find(e => e.id === Number(a.employeeId));
                    return emp && emp.company === selectedCompany;
                  });

                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Employees</p>
                        <h3 className="text-4xl font-black text-blue-950 mt-1">{companyEmployees.length}</h3>
                        <p className="text-sm text-slate-500 font-medium mt-4"><span className="text-emerald-500 font-bold">Active</span> in personnel directory</p>
                      </div>
                      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Net Processed</p>
                        <h3 className="text-4xl font-black text-emerald-900 mt-1">₱{formatMoney(companyPayrolls.reduce((sum, p) => sum + p.netPay, 0))}</h3>
                        <p className="text-sm text-slate-500 font-medium mt-4">Across <span className="font-bold text-emerald-600">{companyPayrolls.length}</span> historical records</p>
                      </div>
                      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Shift Logs</p>
                        <h3 className="text-4xl font-black text-indigo-950 mt-1">{companyAttendances.length}</h3>
                        <p className="text-sm text-slate-500 font-medium mt-4">Stored attendance records</p>
                      </div>
                    </div>
                  );
                })()}

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
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Current Default Shift</p>
                        <p className="text-sm font-mono text-blue-400 mt-1 bg-slate-800/50 py-1.5 px-3 rounded-lg border border-slate-700/50 w-fit">{format12Hour(shiftStart)} — {format12Hour(shiftEnd)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DIRECTORY LIST TAB */}
            {activeTab === 'list' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden print-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
                  <input type="text" placeholder="Search directory..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-4 focus:border-blue-600 outline-none shadow-sm" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead className="bg-slate-100 border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase w-24">Emp ID</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Employee</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Status</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Compensation & Bank</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Govt IDs</th>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEmployees.length === 0 ? (
                        <tr><td colSpan={6} className="py-12 text-center text-slate-400 font-medium text-sm">No records found.</td></tr>
                      ) : (
                        filteredEmployees.map((emp) => (
                          <tr key={emp.id} className="hover:bg-blue-50/30 transition-colors group">
                            <td className="py-4 px-6 align-top">
                              <span className="font-mono font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                                {emp.employeeId ? emp.employeeId : `#${emp.id}`}
                              </span>
                            </td>
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
                <div className="p-4 sm:p-6 border-b border-slate-200 bg-indigo-50/30">
                  <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 sm:gap-6">
                    <div className="w-full lg:w-auto flex flex-col gap-3">
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold text-indigo-950">Time & Attendance Log</h2>
                        <p className="text-xs sm:text-sm text-indigo-700 mt-0.5">Logs are bounded by the standard Office Shift parameters.</p>
                      </div>
                      <div className="w-full sm:w-72 md:w-80">
                        <input type="text" placeholder="Search employee attendance..." value={attendanceSearchQuery} onChange={(e) => setAttendanceSearchQuery(e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-4 focus:ring-indigo-600/10 focus:border-indigo-600 outline-none shadow-sm transition-all bg-white" />
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto shrink-0 mt-1 lg:mt-0">
                      <div className="flex rounded-xl bg-slate-200/70 p-1 border border-slate-300/60 shadow-inner w-full sm:w-auto">
                        <button onClick={() => setAttendanceFilter('day')} className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${attendanceFilter === 'day' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>Daily View</button>
                        <button onClick={() => setAttendanceFilter('month')} className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${attendanceFilter === 'month' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>Monthly Summary</button>
                      </div>
                      {attendanceFilter === 'day' ? (
                        <div className="relative w-full sm:w-auto">
                          <div className="w-full sm:w-auto px-4 py-2 bg-white border border-indigo-200 rounded-xl text-sm font-bold text-indigo-950 shadow-sm flex items-center justify-between gap-3 pointer-events-none">
                            <span>{formatMDY(attendanceDate)}</span>
                            <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          </div>
                          <input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                        </div>
                      ) : (
                        <div className="relative w-full sm:w-auto">
                          <div className="w-full sm:w-auto px-4 py-2 bg-white border border-indigo-200 rounded-xl text-sm font-bold text-indigo-950 shadow-sm flex items-center justify-between gap-3 pointer-events-none">
                            <span>{formatMonthYear(attendanceMonth)}</span>
                            <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          </div>
                          <input type="month" value={attendanceMonth} onChange={(e) => setAttendanceMonth(e.target.value)} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mt-6 pt-5 border-t border-indigo-100">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-indigo-100 w-full xl:w-fit">
                      <div className="flex flex-col gap-1 w-full sm:w-auto"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Office In</label><TimePicker12h value={tempShiftStart} onChange={setTempShiftStart} compact /></div>
                      <div className="hidden sm:block w-px h-8 bg-slate-200"></div>
                      <div className="flex flex-col gap-1 w-full sm:w-auto"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Office Out</label><TimePicker12h value={tempShiftEnd} onChange={setTempShiftEnd} compact /></div>
                      <button onClick={applyShiftSettings} disabled={isSaving} className="w-full sm:w-auto mt-2 sm:mt-0 sm:ml-2 px-4 py-2.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors uppercase tracking-wide disabled:opacity-50">Save Shift</button>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto mb-1">
                      <button onClick={handleRefreshData} disabled={isSaving} className="flex-1 sm:flex-none px-4 py-2 bg-sky-100 hover:bg-sky-200 text-sky-700 text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1 disabled:opacity-50"><svg className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>{isSaving ? 'Syncing...' : 'Refresh'}</button>
                      <button onClick={() => exportToCSV('Attendance_Template.csv', ['Employee ID', 'Date', 'Time In', 'Time Out'], [['1', new Date().toISOString().split('T')[0], '08:00 AM', '05:00 PM'], ['2', new Date().toISOString().split('T')[0], 'LEAVE', 'PAID']])} className="flex-1 sm:flex-none px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg shadow-sm transition-colors">Template</button>
                      <label className="cursor-pointer flex-1 sm:flex-none text-center px-4 py-2 bg-white hover:bg-slate-50 text-indigo-700 text-xs font-bold rounded-lg shadow-sm border border-indigo-200 transition-colors">Import CSV<input type="file" accept=".csv" className="hidden" onChange={handleImportAttendance} /></label>
                      <button onClick={handleExportAttendance} className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">Export CSV</button>
                    </div>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[1050px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase w-1/4">Employee</th>
                        {attendanceFilter === 'day' ? (
                          <><th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Recorded Logs</th><th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Add New Log</th><th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right whitespace-nowrap w-24">Total OT</th><th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right whitespace-nowrap">Calculated Hours</th></>
                        ) : (
                          <><th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase whitespace-nowrap">Detailed Monthly Logs</th><th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right whitespace-nowrap w-24">Total OT</th><th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right whitespace-nowrap w-36">Total Payable Hrs</th></>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {attendanceFilter === 'day' && filteredAttendanceEmployees.map((emp) => {
                            const empLogs = attendances.filter(a => Number(a.employeeId) === emp.id && a.date && a.date.split('T')[0] === attendanceDate);
                            let totalHrs = 0; let totalOtHrs = 0;
                            empLogs.forEach(log => {
                              if (!log.timeIn || !log.timeIn.includes(':')) { totalHrs += log.hours; } 
                              else { const shiftCalc = calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd); totalHrs += shiftCalc.total; totalOtHrs += shiftCalc.ot; }
                            });
                            const currentLog = dailyTimeLogs[emp.id] || { timeIn: shiftStart, timeOut: shiftEnd, type: 'regular', reason: '' };
                        return (
                          <tr key={emp.id} className="hover:bg-indigo-50/10 transition-colors group">
                            <td className="py-5 px-6 align-top w-1/4">
                              <span className="font-semibold text-blue-950 text-sm whitespace-nowrap">{emp.firstName} {emp.lastName}</span>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {emp.employeeId || emp.id}</div>
                            </td>
                            <td className="py-5 px-6 align-top">
                              <div className="flex flex-col gap-3">
                                {empLogs.length === 0 ? <span className="text-sm text-slate-400 italic mt-1.5">No logs recorded</span> : 
                                  empLogs.map(log => {
                                    const isLeave = log.timeIn === 'LEAVE';
                                    const hasFullPunch = log.timeIn && log.timeOut && !isLeave;
                                    const shiftCalc = hasFullPunch ? calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd) : null;
                                    return (
                                      <div key={log.id} className="flex flex-col bg-white border border-indigo-100 rounded-xl shadow-sm overflow-hidden w-full max-w-[420px]">
                                        <div className="flex items-center justify-between gap-6 bg-indigo-50 px-4 py-2.5">
                                          <span className="text-sm font-bold text-indigo-900 font-mono whitespace-nowrap">
                                            {isLeave ? `${log.timeIn} (${log.timeOut})${log.reason ? ` - ${log.reason}` : ''}` : `${log.timeIn ? format12Hour(log.timeIn) : '--:--'} to ${log.timeOut ? format12Hour(log.timeOut) : '--:--'}`}
                                          </span>
                                          <div className="flex items-center gap-3 shrink-0">
                                            <button onClick={() => openEditLogModal(log)} className="text-indigo-400 hover:text-indigo-600 font-bold transition-colors text-xs uppercase tracking-wider">EDIT</button>
                                            <button onClick={() => deleteAttendance(log.id)} className="text-rose-400 hover:text-rose-600 font-bold transition-colors text-sm">✕</button>
                                          </div>
                                        </div>
                                        {!isLeave && shiftCalc ? (
                                          <div className="flex gap-4 px-4 py-2.5 text-[11px] uppercase font-bold text-slate-500 bg-white items-center flex-wrap border-t border-indigo-50">
                                            <span className="text-indigo-600" title="Regular Shift Hours">Reg: {formatDecToHM(shiftCalc.reg)}</span><span className="text-slate-200">|</span><span className={`${shiftCalc.earlyOt > 0 ? 'text-amber-600 font-bold' : 'text-slate-400 font-medium'}`}>Early: {shiftCalc.earlyOt > 0 ? formatDecToHM(shiftCalc.earlyOt) : '--'}</span><span className="text-slate-200">|</span><span className={`${shiftCalc.lateOt > 0 ? 'text-amber-600 font-bold' : 'text-slate-400 font-medium'}`}>Late OT: {shiftCalc.lateOt > 0 ? formatDecToHM(shiftCalc.lateOt) : '--'}</span>
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
                              <div className="flex flex-col gap-2 w-full min-w-[200px] max-w-full sm:max-w-[400px]">
                                <select value={currentLog.type} onChange={(e) => handleTimeChange(emp.id, 'type', e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 bg-white w-full shadow-sm">
                                  <option value="regular">Standard Office Shift</option>
                                  <option value="paid_leave">Paid Leave (8 hrs)</option>
                                  <option value="unpaid_leave">Unpaid Leave (0 hrs)</option>
                                </select>
                                <div className="flex flex-col gap-2 mt-1 w-full">
                                  {currentLog.type === 'regular' ? (
                                    <div className="flex items-center gap-2 w-full bg-slate-50 p-2 rounded-xl border border-slate-200 shadow-inner">
                                      <div className="flex-1 min-w-0"><TimePicker12h value={currentLog.timeIn} onChange={(val: string) => handleTimeChange(emp.id, 'timeIn', val)} compact /></div>
                                      <span className="text-slate-300 font-bold text-lg shrink-0">→</span>
                                      <div className="flex-1 min-w-0"><TimePicker12h value={currentLog.timeOut} onChange={(val: string) => handleTimeChange(emp.id, 'timeOut', val)} compact /></div>
                                    </div>
                                  ) : (
                                    <input type="text" placeholder="Reason (Optional)" value={currentLog.reason || ''} onChange={(e) => handleTimeChange(emp.id, 'reason', e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 w-full shadow-sm" />
                                  )}
                                </div>
                                <button onClick={() => saveInlineAttendance(emp.id)} className="mt-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 transition-colors text-white text-sm font-bold rounded-lg shadow-sm w-full">Save Log</button>
                              </div>
                            </td>
                            <td className="py-5 px-6 align-top text-right font-mono font-semibold text-amber-600 text-sm">{totalOtHrs > 0 ? formatDecToHM(totalOtHrs) : '--'}</td>
                            <td className="py-5 px-6 align-top text-right"><span className="inline-block whitespace-nowrap font-mono font-bold text-sm text-indigo-700 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100">{totalHrs > 0 ? formatDecToHM(totalHrs) : '--'}</span></td>
                          </tr>
                        );
                      })}

                      {attendanceFilter === 'month' && filteredAttendanceEmployees.map((emp) => {
                            const monthLogs = attendances.filter(a => Number(a.employeeId) === emp.id && a.date && a.date.split('T')[0].startsWith(attendanceMonth)).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                            let totalHrs = 0; let totalOverallOtHrs = 0;
                            monthLogs.forEach(log => {
                              if (!log.timeIn || !log.timeIn.includes(':')) { totalHrs += log.hours; } 
                              else { const shiftCalc = calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd); totalHrs += shiftCalc.total; totalOverallOtHrs += shiftCalc.ot; }
                            });
                        return (
                          <tr key={emp.id} className="hover:bg-indigo-50/10 transition-colors">
                            <td className="py-5 px-6 align-top w-1/4">
                              <span className="font-semibold text-blue-950 text-sm whitespace-nowrap">{emp.firstName} {emp.lastName}</span>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {emp.employeeId || emp.id}</div>
                            </td>
                            <td className="py-5 px-6 align-top">
                              {monthLogs.length === 0 ? (
                                <span className="text-sm text-slate-400 italic">No logs this month</span>
                              ) : (
                                <button onClick={() => setMonthLogsModalEmp(emp)} className="px-5 py-2.5 bg-white border border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 text-indigo-700 text-sm font-bold rounded-xl shadow-sm transition-all flex items-center gap-2">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                  View {monthLogs.length} Logs
                                </button>
                              )}
                            </td>
                            <td className="py-5 px-6 align-top text-right font-mono font-bold text-amber-700 text-sm">{totalOverallOtHrs > 0 ? formatDecToHM(totalOverallOtHrs) : '--'}</td>
                            <td className="py-5 px-6 align-top text-right"><span className="inline-block whitespace-nowrap bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100">{totalHrs > 0 ? formatDecToHM(totalHrs) : '0m'}</span></td>
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
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-full uppercase tracking-wider inline-block mt-2 sm:mt-0">Syncs with valid logged hours</span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto items-start sm:items-center">
                      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center border border-slate-300 p-2 rounded-xl bg-white shadow-sm w-full sm:w-auto">
                        <div className="flex flex-col w-full sm:w-auto">
                           <label className="text-[10px] font-bold text-slate-500 uppercase px-1">Cut-off Start</label>
                           <div className="relative">
                             <div className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 shadow-sm flex items-center justify-between w-full sm:w-[130px] pointer-events-none text-emerald-900 font-semibold">
                               <span>{formatMDY(payrollStartDate)}</span>
                             </div>
                             <input type="date" value={payrollStartDate} onChange={e => setPayrollStartDate(e.target.value)} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                           </div>
                        </div>
                        <span className="text-slate-300 font-bold hidden sm:block">-</span>
                        <div className="flex flex-col w-full sm:w-auto">
                           <label className="text-[10px] font-bold text-slate-500 uppercase px-1">Cut-off End</label>
                           <div className="relative">
                             <div className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 shadow-sm flex items-center justify-between w-full sm:w-[130px] pointer-events-none text-emerald-900 font-semibold">
                               <span>{formatMDY(payrollEndDate)}</span>
                             </div>
                             <input type="date" value={payrollEndDate} onChange={e => setPayrollEndDate(e.target.value)} onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch(err){} }} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                           </div>
                        </div>
                      </div>
                      <input type="text" placeholder="Search employee..." value={payrollActiveSearchQuery} onChange={e => setPayrollActiveSearchQuery(e.target.value)} className="px-3 py-2.5 h-[52px] border border-slate-300 rounded-xl text-sm outline-none focus:ring-4 focus:ring-emerald-600/10 focus:border-emerald-600 shadow-sm w-full sm:w-[200px]" />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase w-24">Emp ID</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Employee Name</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Valid Logged Hours</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Total OT Hours</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredActiveEmployees.length === 0 ? (
                          <tr><td colSpan={5} className="py-12 text-center text-slate-400 font-medium text-sm">No active employees found matching your search.</td></tr>
                        ) : (
                          filteredActiveEmployees.map((emp) => {
                            const rawEmpLogs = attendances.filter(a => Number(a.employeeId) === emp.id && a.date && isLogWithinPayrollPeriod(a.date));
                            
                            // Visual dedup in row rendering
                            const uniqueLogsMap = new Map();
                            rawEmpLogs.forEach(log => {
                              const dateStr = log.date.split('T')[0];
                              let logHrs = 0;
                              if (!log.timeIn || !log.timeIn.includes(':')) { 
                                  logHrs = log.hours || 0; 
                              } else { 
                                  const shiftCalc = calculateShiftHours(log.timeIn, log.timeOut, log.shiftStart || shiftStart, log.shiftEnd || shiftEnd); 
                                  logHrs = shiftCalc.total; 
                              }
                              
                              const existing = uniqueLogsMap.get(dateStr);
                              if (!existing || logHrs > existing.calculatedHours) {
                                uniqueLogsMap.set(dateStr, { ...log, calculatedHours: logHrs });
                              }
                            });
                            
                            const uniqueEmpLogs = Array.from(uniqueLogsMap.values());

                            let totalLogged = 0; 
                            uniqueEmpLogs.forEach((log: any) => {
                                // Dynamic exclusion for visual display on the table
                                const logDate = new Date(log.date);
                                const isSunday = logDate.getDay() === 0;
                                const isAug31 = logDate.getMonth() === 7 && logDate.getDate() === 31;
                                
                                if (!isSunday && !isAug31) {
                                    totalLogged += log.calculatedHours;
                                }
                            });
                            
                            // Calculate dynamic required hours instead of hardcoded 112
                            const currentDays = parseFloat(payrollData.daysWorked) || 14;
                            const tableOtLogged = Math.max(0, totalLogged - (currentDays * 8));

                            return (
                              <tr key={emp.id} className="hover:bg-emerald-50/30 transition-colors">
                                <td className="py-4 px-6 font-mono text-slate-500">{emp.employeeId || `#${emp.id}`}</td>
                                <td className="py-4 px-6 font-semibold text-blue-950">{emp.firstName} {emp.lastName}</td>
                                <td className="py-4 px-6 font-mono text-slate-600">{formatDecToHM(totalLogged)}</td>
                                <td className="py-4 px-6 font-mono text-amber-600 font-semibold">{tableOtLogged > 0 ? formatDecToHM(tableOtLogged) : '--'}</td>
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

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-8 print-hidden">
                  <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <h2 className="text-lg font-bold text-slate-800">Saved Payroll History</h2>
                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                      <button onClick={handleExportPayrolls} className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg shadow-sm transition-colors whitespace-nowrap">Export All Payrolls</button>
                      <button onClick={handleExportPayrollsZip} disabled={isSaving} className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg shadow-sm transition-colors whitespace-nowrap disabled:opacity-50">{isSaving ? 'Processing PDFs...' : 'Export All as ZIP'}</button>
                      <input type="text" placeholder="Search by name or date..." value={payrollHistorySearchQuery} onChange={e => setPayrollHistorySearchQuery(e.target.value)} className="w-full sm:w-[250px] px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-4 focus:ring-slate-600/10 focus:border-slate-500 shadow-sm" />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[900px]">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Date Computed</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Emp ID</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Employee</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Hours / Days</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase">Final Net Pay</th>
                          <th className="py-3.5 px-6 text-xs font-semibold text-slate-600 uppercase text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredSavedPayrolls.length === 0 ? (
                          <tr><td colSpan={6} className="py-12 text-center text-slate-400 font-medium text-sm">No payroll records saved or matching your search.</td></tr>
                        ) : (
                          filteredSavedPayrolls.map(pr => {
                            const emp = employees.find(e => e.id === Number(pr.employeeId));
                            return (
                              <tr key={pr.id} className="hover:bg-slate-50 transition-colors">
                                <td className="py-4 px-6 text-sm text-slate-600 font-mono font-semibold">{formatMDY(pr.createdAt)}</td>
                                <td className="py-4 px-6 text-sm text-slate-500 font-mono">{emp?.employeeId || `#${emp?.id}`}</td>
                                <td className="py-4 px-6 font-semibold text-blue-950">{emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown Employee'}</td>
                                <td className="py-4 px-6 text-sm text-slate-600">{formatDecToHM(pr.totalHours)} / {pr.daysWorked} days</td>
                                <td className="py-4 px-6 font-mono font-bold text-emerald-700">₱{pr.netPay.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                <td className="py-4 px-6">
  <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
    {emp && (
      <>
        <button onClick={() => setSelectedPayslip({ record: pr, emp })} className="text-blue-600 hover:text-blue-800 transition-colors text-xs font-bold uppercase whitespace-nowrap">
          Generate Payslip
        </button>
        
        <a href={`mailto:?subject=Payslip%20for%20${emp.firstName}%20${emp.lastName}%20-%20${formatMDY(pr.createdAt)}&body=Hi%20${emp.firstName},%0D%0A%0D%0APlease%20find%20your%20payslip%20for%20the%20cutoff%20attached.%0D%0A%0D%0AThank%20you.`} 
           className="text-amber-600 hover:text-amber-800 transition-colors text-xs font-bold uppercase whitespace-nowrap">
          Email
        </a>
      </>
    )}
    <button onClick={() => deletePayroll(pr.id)} className="text-rose-500 hover:text-rose-700 transition-colors text-xs font-bold uppercase whitespace-nowrap">
      Delete
    </button>
  </div>
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

            {/* TAX TAB */}
            {activeTab === 'tax' && (
              <div className="space-y-8">
                <div className="bg-white shadow-sm border border-slate-300 overflow-hidden rounded-xl">
                  <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-800 tracking-wide">Semi-Monthly Tax Matrix</h2>
                    <button onClick={() => setIsEditingTax(!isEditingTax)} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors ${isEditingTax ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-800 hover:bg-slate-900 text-white'}`}>
                      {isEditingTax ? 'Save & Apply Matrix' : 'Edit Tax Brackets'}
                    </button>
                  </div>
                  <div className="overflow-x-auto p-4">
                    <table className="w-full text-center border-collapse text-sm whitespace-nowrap">
                      <thead className="bg-slate-100 text-slate-600 font-bold">
                        <tr>
                          <th className="py-2.5 px-3 border border-slate-200">Level</th><th className="py-2.5 px-3 border border-slate-200">Income Over (₱)</th><th className="py-2.5 px-3 border border-slate-200">Base Tax (₱)</th><th className="py-2.5 px-3 border border-slate-200">+ Tax Rate (%)</th><th className="py-2.5 px-3 border border-slate-200">Excess Over (₱)</th>
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
                                <td className="py-2.5 px-3 border border-slate-200 font-mono text-slate-700">{formatMoney(bracket.min)}</td><td className="py-2.5 px-3 border border-slate-200 font-mono text-slate-700">{formatMoney(bracket.baseTax)}</td><td className="py-2.5 px-3 border border-slate-200 font-mono text-slate-700 text-blue-600 font-bold">{(bracket.rate * 100).toFixed(0)}%</td><td className="py-2.5 px-3 border border-slate-200 font-mono text-slate-700">{formatMoney(bracket.excessOver)}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white shadow-sm border border-slate-300 overflow-hidden rounded-xl">
                  <div className="p-4 border-b border-slate-200 bg-[#4472c4]/10"><h2 className="text-lg font-bold text-[#4472c4] tracking-wider uppercase">Tax Computation Report</h2></div>
                  <div className="overflow-x-auto p-4">
                    <table className="w-full text-center border-collapse border border-slate-400 text-sm whitespace-nowrap">
                      <thead className="bg-[#4472c4] text-white"><tr><th className="border border-slate-400 py-2.5 px-3">Name</th><th className="border border-slate-400 py-2.5 px-3">TAXABLE INCOME</th><th className="border border-slate-400 py-2.5 px-3">INCOME BRACKET</th><th className="border border-slate-400 py-2.5 px-3">TAX BASE</th><th className="border border-slate-400 py-2.5 px-3">TAX RATE</th><th className="border border-slate-400 py-2.5 px-3">TAX</th><th className="border border-slate-400 py-2.5 px-3">MIN W/TAX</th><th className="border border-slate-400 py-2.5 px-3">WITHHOLDING TAX</th></tr></thead>
                      <tbody>
                        {payrolls.length === 0 ? ( <tr><td colSpan={8} className="py-8 text-slate-400 italic">No payrolls computed yet.</td></tr> ) : (
                          (() => {
                            let totalWithholdingTax = 0; const declaredPayrolls = payrolls.filter(pr => pr.tax > 0 && employees.some(e => e.id === Number(pr.employeeId) && e.company === selectedCompany));
                            if (declaredPayrolls.length === 0) return <tr><td colSpan={8} className="py-8 text-slate-400 italic">No declared salary records found.</td></tr>;
                            const rows = declaredPayrolls.map((pr) => {
                              const emp = employees.find(e => e.id === pr.employeeId); const name = emp ? `${emp.lastName}, ${emp.firstName}` : 'Unknown';
                              const taxableIncome = pr.grossPay - pr.sssDeduction - pr.pagIbigDeduct - pr.philhealthDeduct; 
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
    {/* FIXED: Filtered by selectedCompany */}
    {employees.filter(emp => emp.company === selectedCompany).map(emp => (
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
                
              <div className="p-12 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 print-hidden">
                  <svg className="w-16 h-16 mb-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  <p className="font-medium text-lg">Report Engine Ready</p>
                  <p className="text-sm mt-1">Select your date range above and click Generate Report.</p>
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