import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';
import { aggregateAttendanceRecords, attendanceSessionKey, calculateAttendanceMetrics, calculateAttendancePayroll, parseTimeToMinutes, toAttendanceDateYMD } from '../../../backend/src/employees/attendance-calculator';
import { resolvePayrollBasis } from '../../../backend/src/employees/payroll-profile';
import AttendanceEntryGrid from './AttendanceEntryGrid';
import PayrollProfileEditor from './PayrollProfileEditor';
import type { PayrollProfileEmployee } from './PayrollProfileEditor';
import type { PayrollProfile } from '../../../backend/src/employees/payroll-profile';
import { getCutoffDates, getInitialCutoff, moveCutoff } from '../lib/attendanceEntry';
import type { AttendanceEntryRecord as AttendanceRecord, CutoffSelection } from '../lib/attendanceEntry';
import { getApiAuthHeaders } from '../lib/apiSession';
import { getSavedPayslipBreakdown } from '../lib/savedPayslip';
import './payroll-workspace.css';

// ==========================================
// 1. GLOBAL FORMATTERS & STYLES
// ==========================================

const formatMDY = (dateStr: string) => {
  if (!dateStr) return 'MM/DD/YYYY';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) return `${parts[1]}/${parts[2]}/${parts[0]}`; 
  return dateStr;
};

const toManilaYMD = (dateStr?: string | null) => {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return dateStr.trim();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split('T')[0] || '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
};

const formatManilaMDY = (dateStr?: string | null) => {
  const ymd = toManilaYMD(dateStr);
  return ymd ? formatMDY(ymd) : 'MM/DD/YYYY';
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
  const totalMinutes = Math.round(decimalHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
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
  payrollProfile?: PayrollProfile | null;
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
  attendanceSummary?: {
    version: number;
    cutoffStart: string;
    cutoffEnd: string;
    totalMinutes: number;
    regularMinutes: number;
    overtimeMinutes: number;
    lateMinutes: number;
    undertimeMinutes: number;
    requiredMinutes: number;
    basicSalary: number;
    ratePerDay: number;
    ratePerHour: number;
    otPay: number;
    undertimeDeduction: number;
    govHolidayAmt: number;
    payrollProfile?: PayrollProfile;
    paidDays?: number;
    workedDateCount?: number;
    paidLeaveDateCount?: number;
    unpaidLeaveDateCount?: number;
    sourceSessionCount?: number;
    overtimeBasis?: 'DAILY' | 'CUTOFF_NET';
  } | null;
}

interface PayrollPreview {
  employee: PayrollProfileEmployee & { firstName: string; lastName: string };
  attendanceSummary: NonNullable<PayrollRecord['attendanceSummary']> & { grossPay: number };
  computed: { grossPay: number; netPay: number; totalDeductions: number; withholdingTax: number };
  source: { fetchedAt: string; attendanceDateCount: number; workedDateCount: number; paidLeaveDateCount: number; unpaidLeaveDateCount: number; sessionCount: number };
  configurationRequired: boolean;
  previewFingerprint: string;
}

interface SummaryReportRow {
  emp: Employee;
  totalHours: number;
  totalDays: number;
  otHours: number | null;
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
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceRefreshVersion, setAttendanceRefreshVersion] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [sharedCutoff, setSharedCutoff] = useState<CutoffSelection>(getInitialCutoff);
  const cutoffDates = getCutoffDates(sharedCutoff);
  const payrollStartDate = cutoffDates[0] ?? '';
  const payrollEndDate = cutoffDates.at(-1) ?? '';
  const [payrollPreview, setPayrollPreview] = useState<{ data: PayrollPreview; requestKey: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewRevision, setPreviewRevision] = useState(0);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [payrollUnconfirmed, setPayrollUnconfirmed] = useState(false);
  const payrollSaveLock = useRef(false);

const [payrollActiveSearchQuery, setPayrollActiveSearchQuery] = useState('');
  const [payrollHistorySearchQuery, setPayrollHistorySearchQuery] = useState('');

  // --- TAX REPORTS FILTER & SEARCH STATES ---
  const [taxDateFilterType, setTaxDateFilterType] = useState<'payroll_date' | 'cutoff'>('payroll_date');
  const [taxDraftFromDate, setTaxDraftFromDate] = useState('');
  const [taxDraftToDate, setTaxDraftToDate] = useState('');
  const [taxAppliedFromDate, setTaxAppliedFromDate] = useState('');
  const [taxAppliedToDate, setTaxAppliedToDate] = useState('');
  const [taxSearchInput, setTaxSearchInput] = useState('');
  const [taxDebouncedSearch, setTaxDebouncedSearch] = useState('');
  const [taxFilterError, setTaxFilterError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTaxDebouncedSearch(taxSearchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [taxSearchInput]);

  const handleApplyTaxDateFilter = () => {
    if (taxDraftFromDate && taxDraftToDate && taxDraftFromDate > taxDraftToDate) {
      setTaxFilterError('Invalid date range: Date From cannot be later than Date To.');
      showToast('Invalid date range: Date From cannot be later than Date To.', 'error');
      return;
    }
    setTaxFilterError(null);
    setTaxAppliedFromDate(taxDraftFromDate);
    setTaxAppliedToDate(taxDraftToDate);
  };

  const handleClearTaxDates = () => {
    setTaxDraftFromDate('');
    setTaxDraftToDate('');
    setTaxAppliedFromDate('');
    setTaxAppliedToDate('');
    setTaxFilterError(null);
  };

  const handleResetAllTaxFilters = () => {
    setTaxDraftFromDate('');
    setTaxDraftToDate('');
    setTaxAppliedFromDate('');
    setTaxAppliedToDate('');
    setTaxSearchInput('');
    setTaxDebouncedSearch('');
    setTaxFilterError(null);
  };

  const applyQuickTaxDatePreset = (preset: 'today' | 'this_month' | 'last_month') => {
    const todayManila = toManilaYMD(new Date().toISOString());
    const [y, m] = todayManila.split('-').map(Number);

    let start = todayManila;
    let end = todayManila;

    if (preset === 'this_month') {
      const lastDay = new Date(y, m, 0).getDate();
      start = `${y}-${String(m).padStart(2, '0')}-01`;
      end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (preset === 'last_month') {
      const prevYear = m === 1 ? y - 1 : y;
      const prevMonth = m === 1 ? 12 : m - 1;
      const lastDay = new Date(prevYear, prevMonth, 0).getDate();
      start = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
      end = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    }

    setTaxFilterError(null);
    setTaxDraftFromDate(start);
    setTaxDraftToDate(end);
    setTaxAppliedFromDate(start);
    setTaxAppliedToDate(end);
  };

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState<{ record: PayrollRecord, emp: Employee } | null>(null);
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
  const [lunchStart, setLunchStart] = useState('12:00');
  const [lunchEnd, setLunchEnd] = useState('13:00');

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
      const response = await fetch(`${API_BASE_URL}/settings?company=${encodeURIComponent(selectedCompany)}`, { headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany } });
      if (response.ok) {
        const data = await response.json();
        const settingsObj = Array.isArray(data) ? data[0] : data;
        setLunchStart(settingsObj?.lunchStart || '12:00');
        setLunchEnd(settingsObj?.lunchEnd || '13:00');
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
      const response = await fetch(`${API_BASE_URL}/employees?company=${encodeURIComponent(selectedCompany)}&limit=5000`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', ...getApiAuthHeaders(), 'x-company': selectedCompany } });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setEmployees(Array.isArray(data) ? data : (data.data || []));
    } catch (error) { showToast("Could not fetch employees.", "error"); }
  };

  const fetchAttendances = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/attendance/all?company=${encodeURIComponent(selectedCompany)}&limit=5000`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', ...getApiAuthHeaders(), 'x-company': selectedCompany } });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAttendances(Array.isArray(data) ? data : (data.data || []));
    } catch (error) { console.error(error); }
  };

  const fetchPayrolls = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/payroll/all?company=${encodeURIComponent(selectedCompany)}&limit=5000`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', ...getApiAuthHeaders(), 'x-company': selectedCompany } });
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

  const getAttendanceSummary = (employeeId?: number, startDate?: string, endDate?: string) =>
    aggregateAttendanceRecords(attendances, { employeeId, startDate, endDate, shiftStart, shiftEnd, lunchStart, lunchEnd });

const toCents = (val: any): number => {
    const num = typeof val === 'number' ? val : parseFloat(String(val ?? '0'));
    return Number.isFinite(num) ? Math.round(num * 100) : 0;
  };

  const fromCents = (cents: number): number => {
    return Math.round(cents) / 100;
  };

  const calculateMandatoryTaxableIncome = (
    grossPay: number,
    sss: number,
    philhealth: number,
    pagIbig: number,
    sssProvident: number = 0,
    isSssProvidentMandatory: boolean = true
  ): number => {
    const grossCents = toCents(grossPay);
    const mandatoryExemptCents =
      Math.max(0, toCents(sss)) +
      Math.max(0, toCents(philhealth)) +
      Math.max(0, toCents(pagIbig)) +
      (isSssProvidentMandatory ? Math.max(0, toCents(sssProvident)) : 0);

    return fromCents(Math.max(0, grossCents - mandatoryExemptCents));
  };

  const calculateTotalPayrollDeductions = (rec: {
    cashAdvance?: number;
    companyLoan?: number;
    sssDeduction?: number;
    pagIbigDeduct?: number;
    philhealthDeduct?: number;
    sssProvident?: number;
    tax?: number;
    pagIbigLoan?: number;
    pagIbigHousingLoan?: number;
    sssSalaryLoan?: number;
    sssCalamityLoan?: number;
    pagIbigCalamity?: number;
    pagIbigSalaryLoan?: number;
  }): number => {
    const totalCents =
      Math.max(0, toCents(rec.cashAdvance)) +
      Math.max(0, toCents(rec.companyLoan)) +
      Math.max(0, toCents(rec.sssDeduction)) +
      Math.max(0, toCents(rec.pagIbigDeduct)) +
      Math.max(0, toCents(rec.philhealthDeduct)) +
      Math.max(0, toCents(rec.sssProvident)) +
      Math.max(0, toCents(rec.tax)) +
      Math.max(0, toCents(rec.pagIbigLoan)) +
      Math.max(0, toCents(rec.pagIbigHousingLoan)) +
      Math.max(0, toCents(rec.sssSalaryLoan)) +
      Math.max(0, toCents(rec.sssCalamityLoan)) +
      Math.max(0, toCents(rec.pagIbigCalamity)) +
      Math.max(0, toCents(rec.pagIbigSalaryLoan));

    return fromCents(totalCents);
  };

  const calculateDynamicTax = (taxableIncome: number, brackets: any[]) => {
    const taxableCents = toCents(taxableIncome);
    if (taxableCents <= 0) return { tax: 0, bracketMin: 0, rate: 0, minTax: 0, taxBase: 0 };
    const sorted = [...brackets].sort((a, b) => b.min - a.min);
    const applicable = sorted.find(b => taxableCents >= toCents(b.min)) || sorted[sorted.length - 1];
    const excessCents = Math.max(0, taxableCents - toCents(applicable.excessOver));
    const baseTaxCents = toCents(applicable.baseTax);
    const computedTaxCents = baseTaxCents + Math.round(excessCents * Number(applicable.rate));
    return {
      tax: fromCents(computedTaxCents),
      bracketMin: applicable.min,
      rate: applicable.rate,
      minTax: applicable.baseTax,
      taxBase: fromCents(excessCents),
    };
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => { setToast(null); }, 3500);
  };

  const canLeaveAttendance = () => {
    if (activeTab !== 'attendance') return true;
    if (attendanceBusy || isSaving) {
      showToast('Please wait for the attendance operation to finish.', 'error');
      return false;
    }
    return !attendanceDirty || window.confirm('Discard your unsaved attendance changes and leave Attendance Logs?');
  };

  const changeTab = (nextTab: typeof activeTab) => {
    if (nextTab !== activeTab) {
      if (!canLeaveAttendance()) return false;
      setAttendanceDirty(false);
      setActiveTab(nextTab);
    }
    setIsMobileMenuOpen(false);
    return true;
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
    const headers = ['System ID', 'Employee ID', 'Date', 'Time In', 'Time Out', 'Employee Name', 'Calculated Hours', 'Net Minutes', 'Type/Reason'];
    const data = getAttendanceSummary().records.map(a => {
      const emp = employees.find(e => e.id === a.employeeId);
      const isLeave = a.timeIn === 'LEAVE';
      let niceTimeIn = isLeave ? a.timeIn : (a.timeIn ? format12Hour(a.timeIn) : 'MISSING');
      let niceTimeOut = isLeave ? a.timeOut : (a.timeOut ? format12Hour(a.timeOut) : 'MISSING');
      return [ a.employeeId, emp?.employeeId || '', toAttendanceDateYMD(a.date), niceTimeIn, niceTimeOut, emp ? `${emp.lastName}, ${emp.firstName}` : 'Unknown', (a.metrics.netMinutes / 60).toFixed(2), a.metrics.netMinutes, a.reason || 'Regular' ];
    });
    exportToCSV(`Attendance_Export_${new Date().toISOString().split('T')[0]}.csv`, headers, data);
  };

  const handleExportPayrolls = () => {
    const headers = ['Date Computed', 'System ID', 'Employee ID', 'Employee Name', 'Days Worked', 'Total Hours', 'Gross Pay', 'Total Deductions', 'Net Pay', 'Cutoff Start', 'Cutoff End', 'Regular Hours', 'OT Hours', 'Late Hours', 'Undertime Hours'];
    const data = payrolls.map(p => {
      const emp = employees.find(e => e.id === p.employeeId);
     const totalDeds = calculateTotalPayrollDeductions(p);
      const summary = p.attendanceSummary;
      return [formatMDY(p.createdAt), p.employeeId, emp?.employeeId || '', emp ? `${emp.lastName}, ${emp.firstName}` : 'Unknown', p.daysWorked, summary ? (summary.totalMinutes / 60).toFixed(2) : p.totalHours, p.grossPay, totalDeds, p.netPay, summary?.cutoffStart || '', summary?.cutoffEnd || '', summary ? (summary.regularMinutes / 60).toFixed(2) : 'Unavailable', summary ? (summary.overtimeMinutes / 60).toFixed(2) : 'Unavailable', summary ? (summary.lateMinutes / 60).toFixed(2) : 'Unavailable', summary ? (summary.undertimeMinutes / 60).toFixed(2) : 'Unavailable'];
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
          if ((cols.includes('personnelno') || cols.includes('employeeid') || cols.includes('systemid')) && cols.includes('date') && (cols.includes('in') || cols.includes('timein')) && (cols.includes('out') || cols.includes('timeout'))) {
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
          const minutes = parseTimeToMinutes(timeStr);
          if (minutes === null) return '';
          return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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

        const validPayloads = new Map<string, Omit<AttendanceRecord, 'id'>>();
        let skippedCount = 0;
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
          const safeDate = toAttendanceDateYMD(formatIsoDate(rawDate));

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

          const payload = {
            employeeId: matchedEmployee.id, 
            date: safeDate, 
            timeIn: tIn || '', 
            timeOut: tOut || '', 
            hours, 
            reason: null, 
            shiftStart, 
            shiftEnd 
          };
          const payloadKey = attendanceSessionKey(payload);
          if (validPayloads.has(payloadKey)) skippedCount++;
          else validPayloads.set(payloadKey, payload);
        }

        const payloadArray = Array.from(validPayloads.values());

        if (payloadArray.length === 0) {
           showToast("No valid rows found to import.", "error");
           setIsSaving(false); event.target.value = ''; return;
        }

        let successCount = 0;
        const existingSessions = new Set(attendances.map(attendanceSessionKey));
        for (const payload of payloadArray) {
          const sessionKey = attendanceSessionKey(payload);
          if (existingSessions.has(sessionKey)) { skippedCount++; continue; }

          const res = await fetch(`${API_BASE_URL}/employees/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany },
            body: JSON.stringify(payload) 
          });
          
          if(res.ok) { successCount++; existingSessions.add(sessionKey); }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        await fetchAttendances();
        setAttendanceRefreshVersion(version => version + 1);
        
        showToast(`Imported ${successCount} logs successfully!${skippedCount ? ` Skipped ${skippedCount} exact duplicates.` : ''}`, "success");

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
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany }, body: JSON.stringify(payload) });
      if (!response.ok) { 
        const errorData = await response.json().catch(() => ({}));
        showToast(errorData.message || "Failed to save. Employee ID or Govt ID already exists.", "error"); 
        setIsSaving(false); 
        return; 
      }
      
      await fetchEmployees();
      setIsEditModalOpen(false);
      showToast(editingId ? "Successfully updated employee!" : "Successfully registered employee!", "success");
      if (!editingId) { setFormData(initialFormState); changeTab('list'); }
    } catch (error) { showToast("Network Error. Cannot connect to backend.", "error"); } finally { setIsSaving(false); }
  };

  const deleteEmployee = async (id: number) => {
    if (!window.confirm("Are you sure you want to permanently delete this employee?")) return;
    try {
      const response = await fetch(`${API_BASE_URL}/employees/${id}`, { method: 'DELETE', headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany } });
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
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany },
        body: JSON.stringify({ company: selectedCompany, shiftStart: tempShiftStart, shiftEnd: tempShiftEnd })
      });
      if (!response.ok) throw new Error();
      setShiftStart(tempShiftStart); setShiftEnd(tempShiftEnd);
      setAttendanceRefreshVersion(version => version + 1);
      showToast("Shift updated permanently for this workspace!", "success");
    } catch (error) { showToast("Failed to save shift to database.", "error"); } 
    finally { setIsSaving(false); }
  };

  const calculateShiftHours = (
    timeIn: string,
    timeOut: string,
    appliedShiftStart: string = shiftStart,
    appliedShiftEnd: string = shiftEnd,
  ) => calculateAttendanceMetrics({ timeIn, timeOut, shiftStart: appliedShiftStart, shiftEnd: appliedShiftEnd, lunchStart, lunchEnd });

  // --- EXCEL AGGREGATE PAYROLL ENGINE ---
  const openPayrollModal = (emp: Employee) => {
    setActiveEmployee(emp);
    const cashAdvance = Math.max(0, Math.min(emp.cashAdvanceInstallment || 0, emp.cashAdvanceBalance || 0));
    const companyLoan = Math.max(0, Math.min(emp.loanInstallment || 0, emp.loanBalance || 0));
    setPayrollData({ daysWorked: '14', cashAdvance: String(cashAdvance), companyLoan: String(companyLoan), sss: '0', pagIbig: '0', philhealth: '0', isDeclared: false, pagIbigLoan: '0', pagIbigHousingLoan: '0', sssProvident: '0', sssSalaryLoan: '0', sssCalamityLoan: '0', pagIbigCalamity: '0', pagIbigSalaryLoan: '0', govHolidayAmt: '' });
    setPayrollPreview(null); setPreviewError(''); setPayrollUnconfirmed(false);
    setIsPayrollModalOpen(true);
  };

  const payrollRequest = activeEmployee ? {
    employeeId: activeEmployee.id, company: selectedCompany, cutoffStart: payrollStartDate, cutoffEnd: payrollEndDate,
    daysWorked: Number(payrollData.daysWorked), govHolidayAmt: Number(payrollData.govHolidayAmt || 0), isDeclared: payrollData.isDeclared,
    cashAdvance: Math.min(Number(payrollData.cashAdvance || 0), activeEmployee.cashAdvanceBalance || 0),
    companyLoan: Math.min(Number(payrollData.companyLoan || 0), activeEmployee.loanBalance || 0),
    sssDeduction: Number(payrollData.sss || 0), pagIbigDeduct: Number(payrollData.pagIbig || 0), philhealthDeduct: Number(payrollData.philhealth || 0),
    pagIbigLoan: Number(payrollData.pagIbigLoan || 0), pagIbigHousingLoan: Number(payrollData.pagIbigHousingLoan || 0), sssProvident: Number(payrollData.sssProvident || 0),
    sssSalaryLoan: Number(payrollData.sssSalaryLoan || 0), sssCalamityLoan: Number(payrollData.sssCalamityLoan || 0), pagIbigCalamity: Number(payrollData.pagIbigCalamity || 0), pagIbigSalaryLoan: Number(payrollData.pagIbigSalaryLoan || 0),
  } : null;
  const payrollRequestKey = JSON.stringify(payrollRequest);
  const previewKey = payrollRequestKey + ':' + previewRevision;
  useEffect(() => {
    if (!isPayrollModalOpen || payrollRequestKey === 'null') return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewBusy(true); setPreviewError('');
      try {
        const payload = JSON.parse(payrollRequestKey);
        const response = await fetch(API_BASE_URL + '/employees/payroll/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany }, body: payrollRequestKey, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : 'Payroll preview could not be refreshed.');
        if (result.employee?.id !== payload.employeeId || result.employee?.company !== payload.company || result.attendanceSummary?.cutoffStart !== payload.cutoffStart || result.attendanceSummary?.cutoffEnd !== payload.cutoffEnd || !/^[a-f0-9]{64}$/.test(result.previewFingerprint) || !Number.isFinite(result.computed?.netPay)) throw new Error('The server returned an invalid payroll preview.');
        if (controller.signal.aborted) return;
        setPayrollPreview({ data: result, requestKey: previewKey });
        setActiveEmployee(current => current?.id === result.employee.id ? { ...current, ...result.employee } : current);
      } catch (error) {
        if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'Payroll preview could not be refreshed.');
      } finally { if (!controller.signal.aborted) setPreviewBusy(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [isPayrollModalOpen, payrollRequestKey, previewKey, API_BASE_URL, selectedCompany]);

  const savedPreview = payrollPreview?.data;
  const summary = savedPreview?.attendanceSummary;
  const computed = savedPreview && summary && payrollRequest ? {
    totalHoursWorked: summary.totalMinutes / 60, regularHours: summary.regularMinutes / 60, ratePerDay: summary.ratePerDay, ratePerHour: summary.ratePerHour,
    requiredHrs: summary.requiredMinutes / 60, otHrs: summary.overtimeMinutes / 60, otPay: summary.otPay, undertimeDeduction: summary.undertimeDeduction,
    grossPay: savedPreview.computed.grossPay, autoTax: savedPreview.computed.withholdingTax, totalDeductions: savedPreview.computed.totalDeductions, netPay: savedPreview.computed.netPay,
    cashAdvanceDed: payrollRequest.cashAdvance, companyLoanDed: payrollRequest.companyLoan, pagIbigLoanDed: payrollRequest.pagIbigLoan, pagIbigHousingLoanDed: payrollRequest.pagIbigHousingLoan,
    sssProvidentDed: payrollRequest.sssProvident, sssSalaryLoanDed: payrollRequest.sssSalaryLoan, sssCalamityLoanDed: payrollRequest.sssCalamityLoan, pagIbigCalamityDed: payrollRequest.pagIbigCalamity, pagIbigSalaryLoanDed: payrollRequest.pagIbigSalaryLoan, govHolidayAmt: summary.govHolidayAmt,
  } : null;
  const previewReady = !!computed && payrollPreview?.requestKey === previewKey && !previewBusy && !previewError;
  useEffect(() => {
    if (!isPayrollModalOpen || (!profileDirty && !isSaving)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isPayrollModalOpen, profileDirty, isSaving]);
  const closePayrollModal = () => {
    if (payrollSaveLock.current || profileBusy) { showToast('Please wait for the payroll operation to finish.', 'error'); return; }
    if (profileDirty && !window.confirm('Discard unsaved pay profile edits?')) return;
    if (payrollUnconfirmed) { void fetchPayrolls(); void fetchEmployees(); }
    setIsPayrollModalOpen(false);
  };
  const profileSaved = (updated: PayrollProfileEmployee) => {
    setActiveEmployee(current => current?.id === updated.id ? { ...current, ...updated } : current);
    setEmployees(current => current.map(employee => employee.id === updated.id ? { ...employee, ...updated } : employee));
    setPreviewRevision(version => version + 1);
  };

  const savePayrollToDatabase = async () => {
    if (!activeEmployee || !computed || !payrollRequest || !previewReady || savedPreview?.configurationRequired || profileDirty || profileBusy || payrollSaveLock.current || payrollUnconfirmed) return;
    payrollSaveLock.current = true;
    setIsSaving(true);
    const payload = {
      ...payrollRequest, previewFingerprint: savedPreview?.previewFingerprint,
    };

    let saveResponse: Response | undefined;
    try {
      saveResponse = await fetch(`${API_BASE_URL}/employees/payroll`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany }, body: JSON.stringify(payload) });
      const saved = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(typeof saved.message === 'string' ? saved.message : 'Payroll could not be saved.');
      if (saved.employeeId !== activeEmployee.id || !Number.isFinite(saved.id) || !Number.isFinite(saved.netPay)) throw new Error('The payroll save reply could not be confirmed.');
      
      const balancePatches = [];
      if (computed.cashAdvanceDed > 0) {
        const newBalance = Math.max(0, activeEmployee.cashAdvanceBalance - computed.cashAdvanceDed);
        balancePatches.push(fetch(`${API_BASE_URL}/employees/${activeEmployee.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany }, body: JSON.stringify({ cashAdvanceBalance: newBalance }) }));
      }
      if (computed.companyLoanDed > 0) {
        const newLoanBalance = Math.max(0, activeEmployee.loanBalance - computed.companyLoanDed);
        balancePatches.push(fetch(`${API_BASE_URL}/employees/${activeEmployee.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders(), 'x-company': selectedCompany }, body: JSON.stringify({ loanBalance: newLoanBalance }) }));
      }

      if (balancePatches.length > 0) {
        const responses = await Promise.all(balancePatches);
        if (responses.some(response => !response.ok)) throw new Error('Payroll was saved, but a loan or cash advance balance update failed. Check the payroll ledger and balances before continuing.');
      }

      await Promise.all([fetchPayrolls(), fetchEmployees(), fetchAttendances()]);
      showToast("Payroll finalized and saved to database!", "success");
      setIsPayrollModalOpen(false);
    } catch (error) {
      if (!saveResponse || saveResponse.status >= 500 || saveResponse.ok) {
        setPayrollUnconfirmed(true); setPreviewError('Save result is unconfirmed. Check the payroll ledger before attempting another payroll for this cutoff.');
      } else { setPreviewError(error instanceof Error ? error.message : 'Payroll could not be saved.'); setPreviewRevision(version => version + 1); }
      showToast(error instanceof Error ? error.message : 'Payroll could not be saved.', 'error');
    } finally { payrollSaveLock.current = false; setIsSaving(false); }
  };

  const deletePayroll = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/employees/payroll/${id}`, { method: 'DELETE', headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany } });
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
      const totalHours = empPayrolls.reduce((sum, pr) => sum + (pr.attendanceSummary?.totalMinutes ?? Math.round(pr.totalHours * 60)), 0) / 60;
      const totalDays = empPayrolls.reduce((sum, pr) => sum + pr.daysWorked, 0);
      const totalGross = empPayrolls.reduce((sum, pr) => sum + pr.grossPay, 0);
    const totalDeductions = empPayrolls.reduce((sum, pr) => fromCents(toCents(sum) + toCents(calculateTotalPayrollDeductions(pr))), 0);
      const totalNet = empPayrolls.reduce((sum, pr) => sum + pr.netPay, 0);
      const otHours = empPayrolls.every(pr => pr.attendanceSummary) ? empPayrolls.reduce((sum, pr) => sum + pr.attendanceSummary!.overtimeMinutes, 0) / 60 : null;
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
    <div className="payroll-workspace flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden print:h-auto print:block selection:bg-blue-100">
      
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
          <div className="payroll-edit-dialog bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden border border-slate-200">
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

      {/* GENERATE PAYSLIP MODAL */}
      {selectedPayslip && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print-modal-release">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col overflow-hidden relative print-modal-box">
            <div className="payroll-preview-toolbar flex justify-between items-center p-4 border-b border-slate-200 bg-slate-50 z-10 sticky top-0 no-print shrink-0">
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
                  const breakdown = getSavedPayslipBreakdown(rec, emp.baseRate);
                  const legacy = breakdown.source === 'legacy';
                  const manualAdjustment = breakdown.adjustment;
                  const payslipMoney = (value: number | null) => value === null ? 'Not recorded' : formatMoney(value);
                  const payslipHours = (value: number | null) => value === null ? 'Not recorded' : formatDecToHM(value);
                  const totalEarnings = rec.grossPay; 
                 const totalDeductionsCalc = calculateTotalPayrollDeductions(rec);

                  return (
                    <table className="w-full text-left border-collapse border border-slate-300 text-[11px] sm:text-xs text-slate-700 bg-white shadow-sm print:shadow-none">
                      <colgroup><col className="w-[18%]" /><col className="w-[18%]" /><col className="w-[4%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[10%]" /></colgroup>
                      <tbody>
                        <tr><td colSpan={5} className="border border-slate-300 bg-indigo-600 text-white font-bold text-center py-2.5 text-xs uppercase tracking-widest">{selectedCompany?.toUpperCase()} TRADING CORP.</td><td colSpan={4} className="border border-slate-300 border-l-0 bg-white"></td></tr>
                        <tr><td colSpan={5} className="border border-slate-300 bg-slate-100 font-bold px-3 py-2 uppercase text-slate-800"><span className="text-[10px] text-slate-500">Employee's Name :</span> <span className="ml-2 font-bold text-sm text-slate-900">{emp.lastName}, {emp.firstName}</span></td><td colSpan={4} className="border border-slate-300 bg-slate-100 font-bold px-3 py-2 text-center uppercase text-slate-800">Date: {formatMDY(rec.createdAt)} ({rec.daysWorked} WORKING DAYS)</td></tr>
                        {legacy && <tr><td colSpan={9} className="border border-slate-300 bg-amber-50 px-3 py-2 text-[10px] text-amber-900">Older payroll: salary, rates and the earnings breakdown are estimates using the current salary reference and saved days/hours. Original salary details were not recorded. Gross pay, deductions and net pay are the original saved amounts.</td></tr>}
                        <tr><td colSpan={5} className="border border-slate-300 text-center font-bold py-1.5 bg-slate-50 uppercase text-slate-600 tracking-wider">Earnings</td><td colSpan={4} className="border border-slate-300 px-3 py-1.5 font-bold bg-slate-50 text-slate-600">REQUIRED PAID DAYS: <span className="font-bold text-indigo-700 ml-1">{rec.daysWorked}</span></td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium text-slate-800">BASIC SALARY{legacy ? ' (REFERENCE)' : ''}</td><td className="border border-slate-300 px-1 text-center font-medium text-slate-400">₱</td><td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{payslipMoney(breakdown.basicSalary)}</td><td colSpan={4} rowSpan={11} className="border border-slate-300 bg-white"></td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE PER HOUR</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{payslipMoney(breakdown.ratePerHour)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE PER DAY</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{payslipMoney(breakdown.ratePerDay)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">TOTAL HOURS</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{payslipHours(breakdown.totalHours)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">REQUIRED NO.OF HOURS</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{payslipHours(breakdown.requiredHours)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-bold text-slate-800">REGULAR PAY</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{payslipMoney(breakdown.regularPay)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">OT HOURS{legacy ? ' (CUTOFF BALANCE)' : ''}</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{payslipHours(breakdown.overtimeHours)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">RATE FOR OT</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{payslipMoney(breakdown.ratePerHour === null ? null : breakdown.ratePerHour * 1.25)}</td></tr>
                        <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-bold text-slate-800">OT PAY</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right bg-indigo-50 font-mono font-bold text-indigo-900">{payslipMoney(breakdown.otPay)}</td></tr>
                        {manualAdjustment !== null && Math.abs(manualAdjustment) >= 0.01 ? (
                           <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">{legacy ? 'BALANCING ADJ (UNVERIFIED)' : 'GOVT HOLIDAY / ADJ'}</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{manualAdjustment > 0 ? '+' : ''}{formatMoney(manualAdjustment)}</td></tr>
                        ) : (
                           <tr><td colSpan={2} className="border border-slate-300 px-3 py-1 font-medium">{legacy ? 'BALANCING ADJ' : 'HOLIDAY'}</td><td className="border border-slate-300"></td><td colSpan={2} className="border border-slate-300 px-3 text-right font-mono text-slate-700">{payslipMoney(manualAdjustment)}</td></tr>
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
      {isPayrollModalOpen && activeEmployee && !computed && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"><h2 className="font-bold text-indigo-950">Loading current payroll records</h2><p role="status" className="my-4 text-sm text-slate-600">{previewError || 'Fetching the saved salary, attendance and shift settings for this cutoff…'}</p><button type="button" onClick={() => setPreviewRevision(version => version + 1)} className="mr-3 text-sm font-semibold text-indigo-600">Retry Preview</button><button type="button" onClick={closePayrollModal} className="text-sm text-slate-600">Close</button></div></div>
      )}
      {isPayrollModalOpen && activeEmployee && computed && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-slate-900/50 backdrop-blur-sm print-hidden">
          <div className="payroll-compute-dialog bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[98vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="flex justify-between items-center p-3 sm:p-4 border-b border-slate-200 bg-emerald-50/50 shrink-0">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-emerald-950 leading-tight">Compute Payroll: {activeEmployee.firstName} {activeEmployee.lastName}</h2>
                <p className="text-[10px] sm:text-xs text-emerald-700 font-mono mt-0.5">{formatMDY(payrollStartDate)} – {formatMDY(payrollEndDate)} · {savedPreview?.configurationRequired ? 'Pay profile setup required' : `Basic Salary: ₱${summary?.basicSalary.toLocaleString()} / Cutoff`}</p>
              </div>
              <button aria-label="Close payroll" onClick={closePayrollModal} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-emerald-100 transition-colors">✕</button>
            </div>
            <div className="overflow-y-auto p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-4 items-start">
              <fieldset disabled={isSaving || payrollUnconfirmed} className="min-w-0 space-y-3">
                <PayrollProfileEditor key={activeEmployee.id} employee={activeEmployee} API_BASE_URL={API_BASE_URL} onSaved={profileSaved} onDirtyChange={setProfileDirty} onBusyChange={setProfileBusy} />
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600" role="status">
                  {previewError || (previewReady ? `Server confirmed · ${savedPreview?.source.workedDateCount} dates worked · ${savedPreview?.source.paidLeaveDateCount} paid leave · ${savedPreview?.source.unpaidLeaveDateCount} unpaid leave · ${savedPreview?.source.sessionCount} saved sessions` : 'Refreshing payroll preview…')}
                  {payrollUnconfirmed && <p className="mt-1 text-rose-700">Check the payroll ledger before creating another payroll for this cutoff.</p>}
                  <button type="button" disabled={isSaving || profileBusy} onClick={() => setPreviewRevision(version => version + 1)} className="ml-2 font-semibold text-indigo-600 disabled:opacity-50">Refresh Preview</button>
                </div>
                {savedPreview?.configurationRequired && <p className="text-xs text-amber-700">Complete the one-time pay profile before saving payroll. Required days and rates will then be calculated automatically.</p>}
                {!savedPreview?.configurationRequired && <p className="text-xs text-slate-500">{summary?.overtimeBasis === 'CUTOFF_NET' ? 'Excel cutoff balance: overtime starts above the required cutoff hours; shortages are deducted at the normal hourly rate.' : 'Daily overtime: each workday’s overtime and shortfall are calculated separately.'}</p>}
                <h3 className="font-bold text-slate-800 border-b pb-1.5 text-[10px] sm:text-xs uppercase tracking-wider">Time & Attendance</h3>
                <div className="grid grid-cols-4 gap-2 sm:gap-3">
                  <InputField compact type="text" disabled label="Required Paid Days" value={savedPreview?.configurationRequired ? 'Setup required' : String((summary?.requiredMinutes ?? 0) / 480)} />
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
              </fieldset>

              <div className={`payroll-calculation-card bg-slate-50 p-4 rounded-xl border border-slate-200 flex-col h-full ${savedPreview?.configurationRequired ? 'hidden' : 'flex'}`}>
                <h3 className="font-bold text-slate-800 border-b pb-1.5 mb-2.5 text-[11px] uppercase tracking-wider">Calculation Breakdown</h3>
                <div className="space-y-1 text-xs flex-1">
                  <div className="flex justify-between"><span className="text-slate-500">Rate per Day:</span> <span className="font-mono">₱{computed.ratePerDay.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Rate per Hour:</span> <span className="font-mono">₱{computed.ratePerHour.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Required Hours:</span> <span className="font-mono">{formatDecToHM(computed.requiredHrs)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Valid Logged Hours:</span> <span className="font-mono">{formatDecToHM(computed.totalHoursWorked)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Regular Hours:</span> <span className="font-mono">{formatDecToHM(computed.regularHours)}</span></div>
                  
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

                <button onClick={savePayrollToDatabase} disabled={isSaving || !previewReady || profileDirty || profileBusy || savedPreview?.configurationRequired || payrollUnconfirmed} className="mt-3 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white rounded-xl font-bold shadow-sm transition-colors text-sm shrink-0">
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
            
            <div className="payroll-preview-toolbar flex justify-between items-center p-5 border-b border-slate-200 bg-amber-50 z-10 sticky top-0 no-print shrink-0">
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
                      <th className="py-3 px-4 font-black uppercase text-xs text-center">OT Hrs</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-right">Gross Pay</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-right">Deductions</th>
                      <th className="py-3 px-4 font-black uppercase text-xs text-right">Net Pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {getFilteredReportData().length === 0 ? (
                      <tr><td colSpan={8} className="py-12 text-center text-slate-500 font-medium">No records found for this period.</td></tr>
                    ) : (
                      <>
                        {getFilteredReportData().map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-bold text-slate-800 uppercase">{row.emp.lastName}, {row.emp.firstName}</td>
                            <td className="py-3 px-4 text-center text-slate-600 font-medium">{row.count}</td>
                            <td className="py-3 px-4 text-center text-slate-600 font-medium">{row.totalDays}</td>
                            <td className="py-3 px-4 text-center text-slate-600 font-medium">{row.totalHours.toFixed(2)}</td>
                            <td className="py-3 px-4 text-center text-slate-600 font-medium">{row.otHours === null ? 'Unavailable' : row.otHours.toFixed(2)}</td>
                            <td className="py-3 px-4 text-right text-slate-700 font-mono">₱{row.totalGross.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            <td className="py-3 px-4 text-right text-rose-600 font-mono">-₱{row.totalDeductions.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            <td className="py-3 px-4 text-right font-black text-slate-900 font-mono text-[15px]">₱{row.totalNet.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 border-t-2 border-slate-900 font-black">
                          <td colSpan={5} className="py-3 px-4 text-right uppercase text-slate-800 text-xs tracking-widest">Grand Totals:</td>
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
      
      <aside className={`payroll-sidebar fixed inset-y-0 left-0 z-50 transform bg-slate-900 text-slate-300 flex flex-col flex-shrink-0 w-64 transition-transform duration-300 ease-in-out md:relative md:translate-x-0 print-hidden border-r border-slate-800 shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="payroll-brand h-20 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950">
          <h1 className="text-xl font-black text-white tracking-wider uppercase">{selectedCompany}<span className="text-blue-500">Admin</span></h1>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white">
             <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <div className="payroll-navigation flex-1 overflow-y-auto py-6 px-3 space-y-1">
          <div className="px-3 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Main Menu</div>
          <button onClick={() => { changeTab('dashboard'); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'dashboard' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Dashboard Overview</button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Personnel</div>
          <button onClick={() => { changeTab('list'); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'list' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Directory List</button>
          <button onClick={() => { if (changeTab('add')) setFormData(initialFormState); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'add' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Register New</button>
          <button onClick={() => { changeTab('attendance'); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'attendance' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Log Attendance</button>
          
          <div className="px-3 pt-6 pb-2 text-xs font-bold text-slate-500 uppercase tracking-widest">Finance</div>
          <button onClick={() => { changeTab('payroll'); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'payroll' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Compute Payroll</button>
          <button onClick={() => { changeTab('tax'); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'tax' ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Tax Reports</button>
          <button onClick={() => { changeTab('report'); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all font-semibold text-sm ${activeTab === 'report' ? 'bg-amber-600 text-white shadow-md shadow-amber-900/20' : 'hover:bg-slate-800 hover:text-white'}`}>Summary Reports</button>
        </div>
      </aside>

      {/* MAIN WORKSPACE CANVAS */}
      <div className="payroll-canvas flex-1 flex flex-col min-w-0 h-screen overflow-hidden print:h-auto print:block">
        
        {/* TOP HEADER */}
        <header className="payroll-header h-auto sm:h-20 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-8 py-3 sm:py-0 shadow-sm relative z-10 print-hidden shrink-0 gap-3 sm:gap-0">
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
            <button onClick={() => { if (canLeaveAttendance()) onBack(); }} className="flex-1 sm:flex-none flex justify-center px-4 py-2 sm:py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs sm:text-sm font-bold transition-colors shadow-sm border border-blue-200 items-center gap-1.5 sm:gap-2 whitespace-nowrap">
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              <span className="hidden sm:inline">Gateway</span>
              <span className="sm:hidden">Back</span>
            </button>
            <button onClick={() => { if (canLeaveAttendance()) onLogout(); }} className="flex-1 sm:flex-none flex justify-center px-4 sm:px-6 py-2 sm:py-2 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 rounded-lg text-xs sm:text-sm font-bold transition-colors shadow-sm border border-slate-200 whitespace-nowrap">
              Logout
            </button>
          </div>
        </header>

        {/* SCROLLABLE MAIN CONTENT */}
        <main className={`payroll-main flex-1 overflow-y-auto p-4 sm:p-8 relative print:p-0 print:overflow-visible ${selectedPayslip ? 'print-hidden' : ''}`}>
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
                      <div className="payroll-metric bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Employees</p>
                        <h3 className="text-4xl font-black text-blue-950 mt-1">{companyEmployees.length}</h3>
                        <p className="text-sm text-slate-500 font-medium mt-4"><span className="text-emerald-500 font-bold">Active</span> in personnel directory</p>
                      </div>
                      <div className="payroll-metric bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Net Processed</p>
                        <h3 className="text-4xl font-black text-emerald-900 mt-1">₱{formatMoney(companyPayrolls.reduce((sum, p) => sum + p.netPay, 0))}</h3>
                        <p className="text-sm text-slate-500 font-medium mt-4">Across <span className="font-bold text-emerald-600">{companyPayrolls.length}</span> historical records</p>
                      </div>
                      <div className="payroll-metric bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
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
                      <button onClick={() => changeTab('attendance')} className="w-full text-left font-bold p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 transition-all">Log Today's Attendance</button>
                      <button onClick={() => changeTab('payroll')} className="w-full text-left font-bold p-4 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 text-slate-700 transition-all">Process New Payroll</button>
                      <button onClick={() => { if (changeTab('add')) setFormData(initialFormState); }} className="w-full text-left font-bold p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 transition-all">Register New Employee</button>
                    </div>
                  </div>

                  <div className="payroll-configuration bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm text-slate-300 flex flex-col relative overflow-hidden">
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
              <div className="space-y-4">
                <fieldset disabled={isSaving} className="min-w-0">
                  <AttendanceEntryGrid
                    key={selectedCompany + ':' + attendanceRefreshVersion}
                    selectedCompany={selectedCompany}
                    API_BASE_URL={API_BASE_URL}
                    employees={employees}
                    onRecordsChange={setAttendances}
                    onDirtyChange={setAttendanceDirty}
                    onBusyChange={setAttendanceBusy}
                    cutoffSelection={sharedCutoff}
                    onCutoffChange={setSharedCutoff}
                  />
                </fieldset>
                <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-600">Attendance tools: CSV &amp; office shift</summary>
                  <div className="border-t border-slate-100 p-4">
                    {attendanceDirty && <p className="mb-3 text-xs text-amber-700">Save or discard your attendance changes before using these tools.</p>}
                    <fieldset disabled={isSaving || attendanceBusy || attendanceDirty} className="flex flex-col gap-4 disabled:opacity-50">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Office In</label><TimePicker12h value={tempShiftStart} onChange={setTempShiftStart} compact /></div>
                        <div className="flex flex-col gap-1"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Office Out</label><TimePicker12h value={tempShiftEnd} onChange={setTempShiftEnd} compact /></div>
                        <button type="button" onClick={applyShiftSettings} className="rounded-lg bg-indigo-100 px-4 py-2.5 text-xs font-bold text-indigo-800 hover:bg-indigo-200">Save Shift</button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={async () => { await handleRefreshData(); setAttendanceRefreshVersion(version => version + 1); }} className="rounded-lg bg-sky-100 px-4 py-2 text-xs font-bold text-sky-700 hover:bg-sky-200">{isSaving ? 'Syncing...' : 'Refresh'}</button>
                        <button type="button" onClick={() => exportToCSV('Attendance_Template.csv', ['Employee ID', 'Date', 'Time In', 'Time Out'], [['1', toAttendanceDateYMD(new Date()), '08:00 AM', '05:00 PM'], ['2', toAttendanceDateYMD(new Date()), 'LEAVE', 'PAID']])} className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200">Template</button>
                        <label className="cursor-pointer rounded-lg border border-indigo-200 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-slate-50">Import CSV<input type="file" accept=".csv" className="hidden" onChange={handleImportAttendance} /></label>
                        <button type="button" onClick={handleExportAttendance} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700">Export CSV</button>
                      </div>
                    </fieldset>
                  </div>
                </details>
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
                      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 text-xs">
                        <label className="text-slate-500">Payroll cutoff<select aria-label="Payroll cutoff" value={sharedCutoff.period} onChange={event => setSharedCutoff({ ...sharedCutoff, period: event.target.value as CutoffSelection['period'] })} className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5"><option value="26-10">26th–10th</option><option value="11-25">11th–25th</option></select></label>
                        <label className="text-slate-500">Cutoff end month<input aria-label="Payroll cutoff end month" type="month" value={sharedCutoff.month} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setSharedCutoff({ ...sharedCutoff, month: event.target.value }); }} className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5" /></label>
                        <button type="button" aria-label="Previous payroll cutoff" onClick={() => setSharedCutoff(moveCutoff(sharedCutoff, -1))} className="rounded-md border border-slate-200 px-2 py-1.5">←</button>
                        <button type="button" aria-label="Next payroll cutoff" onClick={() => setSharedCutoff(moveCutoff(sharedCutoff, 1))} className="rounded-md border border-slate-200 px-2 py-1.5">→</button>
                        <p className="w-full text-slate-500">{formatMDY(payrollStartDate)} – {formatMDY(payrollEndDate)} · shared with Attendance Logs</p>
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
                            const payrollAttendance = getAttendanceSummary(emp.id, payrollStartDate, payrollEndDate);
                            const totalLogged = payrollAttendance.netMinutes / 60;
                            let tableOtLogged: number | null = null;
                            try {
                              const basis = emp.payrollProfile ? resolvePayrollBasis(emp.payrollProfile, emp.baseRate, payrollStartDate, payrollEndDate) : null;
                              tableOtLogged = calculateAttendancePayroll(attendances, {
                                employeeId: emp.id, startDate: payrollStartDate, endDate: payrollEndDate,
                                shiftStart, shiftEnd, lunchStart, lunchEnd,
                                daysWorked: basis?.paidDays ?? 14, basicSalary: basis?.basicSalary ?? emp.baseRate,
                                ratePerDay: basis?.ratePerDay, overtimeBasis: emp.payrollProfile?.overtimeBasis ?? 'CUTOFF_NET',
                              }).overtimeMinutes / 60;
                            } catch { /* Invalid saved profiles require review in Compute Salary. */ }

                            return (
                              <tr key={emp.id} className="hover:bg-emerald-50/30 transition-colors">
                                <td className="py-4 px-6 font-mono text-slate-500">{emp.employeeId || `#${emp.id}`}</td>
                                <td className="py-4 px-6 font-semibold text-blue-950">{emp.firstName} {emp.lastName}</td>
                                <td className="py-4 px-6 font-mono text-slate-600">{formatDecToHM(totalLogged)}</td>
                                <td className="py-4 px-6 font-mono text-amber-600 font-semibold">{tableOtLogged === null ? 'Check pay profile' : tableOtLogged > 0 ? formatDecToHM(tableOtLogged) : '--'}</td>
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
                                <td className="py-4 px-6 text-sm text-slate-600">{formatDecToHM(pr.attendanceSummary ? pr.attendanceSummary.totalMinutes / 60 : pr.totalHours)} / {pr.daysWorked} days</td>
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
                  <div className="p-4 border-b border-slate-200 bg-[#4472c4]/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold text-[#4472c4] tracking-wider uppercase">Tax Computation Report</h2>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">
                        Filter historical BIR withholding tax records by {taxDateFilterType === 'cutoff' ? 'Payroll Cutoff Period' : 'Payroll Generation Date'} (Asia/Manila) and employee name.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold uppercase text-slate-400 mr-1">Quick:</span>
                      <button type="button" onClick={() => applyQuickTaxDatePreset('today')} className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors shadow-sm">Today</button>
                      <button type="button" onClick={() => applyQuickTaxDatePreset('this_month')} className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors shadow-sm">This Month</button>
                      <button type="button" onClick={() => applyQuickTaxDatePreset('last_month')} className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors shadow-sm">Last Month</button>
                    </div>
                  </div>

                  {/* COMPACT HORIZONTAL FILTER & SEARCH TOOLBAR */}
                  <div className="p-4 bg-slate-50/80 border-b border-slate-200">
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-end gap-3">
                      {/* FILTER BASIS SELECTOR: PAYROLL DATE VS CUTOFF */}
                      <div className="flex flex-col gap-1 w-full sm:w-auto lg:w-44 shrink-0">
                        <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Date Basis</label>
                        <select
                          value={taxDateFilterType}
                          onChange={(e) => setTaxDateFilterType(e.target.value as 'payroll_date' | 'cutoff')}
                          className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-600 outline-none shadow-sm cursor-pointer h-[38px]"
                        >
                          <option value="payroll_date">Payroll Date (Generated)</option>
                          <option value="cutoff">Payroll Cutoff Period</option>
                        </select>
                      </div>

                      {/* DATE FROM */}
                      <div className="flex flex-col gap-1 w-full sm:w-auto lg:w-40 shrink-0">
                        <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Date From</label>
                        <div className="relative w-full">
                          <div className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg shadow-sm flex items-center justify-between pointer-events-none text-xs font-semibold text-slate-800 h-[38px]">
                            <span>{taxDraftFromDate ? formatMDY(taxDraftFromDate) : 'MM/DD/YYYY'}</span>
                            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          </div>
                          <input
                            type="date"
                            value={taxDraftFromDate}
                            onChange={(e) => { setTaxDraftFromDate(e.target.value); setTaxFilterError(null); }}
                            onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch (err) {} }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                        </div>
                      </div>

                      {/* DATE TO */}
                      <div className="flex flex-col gap-1 w-full sm:w-auto lg:w-40 shrink-0">
                        <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Date To</label>
                        <div className="relative w-full">
                          <div className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg shadow-sm flex items-center justify-between pointer-events-none text-xs font-semibold text-slate-800 h-[38px]">
                            <span>{taxDraftToDate ? formatMDY(taxDraftToDate) : 'MM/DD/YYYY'}</span>
                            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          </div>
                          <input
                            type="date"
                            value={taxDraftToDate}
                            onChange={(e) => { setTaxDraftToDate(e.target.value); setTaxFilterError(null); }}
                            onClick={(e: any) => { try { e.target.showPicker && e.target.showPicker(); } catch (err) {} }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                        </div>
                      </div>

                      {/* EMPLOYEE SEARCH BAR */}
                      <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                        <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Search Employee</label>
                        <div className="relative w-full">
                          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                          <input
                            type="text"
                            placeholder="Search employee name..."
                            value={taxSearchInput}
                            onChange={(e) => setTaxSearchInput(e.target.value)}
                            className="w-full pl-9 pr-8 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-600 outline-none shadow-sm h-[38px]"
                          />
                          {taxSearchInput && (
                            <button
                              type="button"
                              onClick={() => { setTaxSearchInput(''); setTaxDebouncedSearch(''); }}
                              title="Clear search (keep dates)"
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* ACTION BUTTONS: APPLY | CLEAR FILTER | RESET ALL */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleApplyTaxDateFilter}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors h-[38px] whitespace-nowrap"
                        >
                          Apply Filter
                        </button>
                        <button
                          type="button"
                          onClick={handleClearTaxDates}
                          className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold rounded-lg shadow-sm transition-colors h-[38px] whitespace-nowrap"
                          title="Clear date range while preserving employee search"
                        >
                          Clear Filter
                        </button>
                        {(taxAppliedFromDate || taxAppliedToDate || taxDebouncedSearch || taxDraftFromDate || taxDraftToDate) && (
                          <button
                            type="button"
                            onClick={handleResetAllTaxFilters}
                            className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold rounded-lg shadow-sm transition-colors h-[38px] whitespace-nowrap"
                          >
                            Reset All
                          </button>
                        )}
                      </div>
                    </div>

                    {taxFilterError && (
                      <div className="mt-2.5 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs font-bold text-rose-700">
                        {taxFilterError}
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto p-4">
                    <table className="w-full text-center border-collapse border border-slate-400 text-sm whitespace-nowrap">
                      <thead className="bg-[#4472c4] text-white">
                        <tr>
                          <th className="border border-slate-400 py-2.5 px-3">Name</th>
                          <th className="border border-slate-400 py-2.5 px-3">PAYROLL DATE</th>
                          <th className="border border-slate-400 py-2.5 px-3">TAXABLE INCOME</th>
                          <th className="border border-slate-400 py-2.5 px-3">INCOME BRACKET</th>
                          <th className="border border-slate-400 py-2.5 px-3">TAX BASE</th>
                          <th className="border border-slate-400 py-2.5 px-3">TAX RATE</th>
                          <th className="border border-slate-400 py-2.5 px-3">TAX</th>
                          <th className="border border-slate-400 py-2.5 px-3">MIN W/TAX</th>
                          <th className="border border-slate-400 py-2.5 px-3">WITHHOLDING TAX</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payrolls.length === 0 ? (
                          <tr><td colSpan={9} className="py-8 text-slate-400 italic">No payrolls computed yet.</td></tr>
                        ) : (
                          (() => {
                            const companyDeclaredPayrolls = payrolls.filter(pr =>
                              pr.tax > 0 && employees.some(e => e.id === Number(pr.employeeId) && e.company === selectedCompany)
                            );

                            if (companyDeclaredPayrolls.length === 0) {
                              return <tr><td colSpan={9} className="py-8 text-slate-400 italic">No declared salary records found.</td></tr>;
                            }

                            const normalizedQuery = taxDebouncedSearch.toLowerCase().replace(/\s+/g, ' ');

                            const filteredTaxPayrolls = companyDeclaredPayrolls.filter((pr: any) => {
                              const emp = employees.find(e => e.id === Number(pr.employeeId));
                              if (!emp) return false;

                              if (normalizedQuery) {
                                const first = (emp.firstName || '').trim().toLowerCase();
                                const middle = (emp.middleName || '').trim().toLowerCase();
                                const last = (emp.lastName || '').trim().toLowerCase();
                                const empCode = String(emp.employeeId || '').trim().toLowerCase();
                                const sysId = String(emp.id || '').trim().toLowerCase();
                                const fullFML = [first, middle, last].filter(Boolean).join(' ');
                                const fullFL = [first, last].filter(Boolean).join(' ');
                                const fullLF = [last, first].filter(Boolean).join(', ');
                                const fullLFM = [last, first, middle].filter(Boolean).join(' ');

                                const matchesSearch =
                                  first.includes(normalizedQuery) ||
                                  middle.includes(normalizedQuery) ||
                                  last.includes(normalizedQuery) ||
                                  empCode.includes(normalizedQuery) ||
                                  sysId === normalizedQuery ||
                                  fullFML.includes(normalizedQuery) ||
                                  fullFL.includes(normalizedQuery) ||
                                  fullLF.includes(normalizedQuery) ||
                                  fullLFM.includes(normalizedQuery);

                                if (!matchesSearch) return false;
                              }

                              if (taxAppliedFromDate || taxAppliedToDate) {
                                const hasExplicitCutoff = Boolean(pr.cutoffStart && pr.cutoffEnd);
                                if (taxDateFilterType === 'cutoff' && hasExplicitCutoff) {
                                  const cStart = toManilaYMD(pr.cutoffStart);
                                  const cEnd = toManilaYMD(pr.cutoffEnd);
                                  if (taxAppliedFromDate && cEnd < taxAppliedFromDate) return false;
                                  if (taxAppliedToDate && cStart > taxAppliedToDate) return false;
                                } else {
                                  const recordDateManila = toManilaYMD(pr.createdAt);
                                  if (!recordDateManila) return false;
                                  if (taxAppliedFromDate && recordDateManila < taxAppliedFromDate) return false;
                                  if (taxAppliedToDate && recordDateManila > taxAppliedToDate) return false;
                                }
                              }

                              return true;
                            });

                            if (filteredTaxPayrolls.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={9} className="py-10 text-slate-500 font-medium">
                                    No matching payroll tax records found for the selected filter criteria.
                                  </td>
                                </tr>
                              );
                            }

                            let totalWithholdingTax = 0;

                            const rows = filteredTaxPayrolls.map((pr: any) => {
                              const emp = employees.find(e => e.id === Number(pr.employeeId));
                              const name = emp ? `${emp.lastName}, ${emp.firstName}${emp.middleName ? ' ' + emp.middleName : ''}` : 'Unknown';
                              const taxableIncome = calculateMandatoryTaxableIncome(
                                pr.grossPay,
                                pr.sssDeduction,
                                pr.philhealthDeduct,
                                pr.pagIbigDeduct,
                                pr.sssProvident || 0,
                                true
                              );
                              const taxData = calculateDynamicTax(taxableIncome, taxBrackets);
                              const recordWithholdingTax = taxData.tax;
                              const taxOnExcess = fromCents(Math.max(0, toCents(recordWithholdingTax) - toCents(taxData.minTax)));
                              totalWithholdingTax = fromCents(toCents(totalWithholdingTax) + toCents(recordWithholdingTax));

                              return (
                                <tr key={pr.id} className="hover:bg-slate-50">
                                  <td className="border border-slate-400 py-2 px-3 text-left font-bold uppercase">
                                    <div>{name}</div>
                                    {emp?.employeeId && <div className="text-[10px] font-mono text-slate-400">ID: {emp.employeeId}</div>}
                                  </td>
                                  <td className="border border-slate-400 py-2 px-3 text-center font-mono text-xs text-slate-700">
                                    <div className="font-semibold">{formatManilaMDY(pr.createdAt)}</div>
                                    {pr.cutoffStart && pr.cutoffEnd ? (
                                      <div className="text-[10px] text-blue-600 font-sans">
                                        Cutoff: {formatManilaMDY(pr.cutoffStart)} - {formatManilaMDY(pr.cutoffEnd)}
                                      </div>
                                    ) : (
                                      <div className="text-[10px] text-slate-400 font-sans">{pr.daysWorked} working days</div>
                                    )}
                                  </td>
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxableIncome)}</td>
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxData.bracketMin)}</td>
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxData.taxBase)}</td>
                                  <td className="border border-slate-400 py-2 px-3 text-right">{taxData.rate.toFixed(2)}</td>
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxOnExcess)}</td>
                                  <td className="border border-slate-400 py-2 px-3 text-right">{formatMoney(taxData.minTax)}</td>
                                  <td className="border border-slate-400 py-2 px-3 text-right font-bold text-slate-900 bg-slate-50">{formatMoney(recordWithholdingTax)}</td>
                                </tr>
                              );
                            });

                            return (
                              <>
                                {rows}
                                <tr className="bg-slate-200 font-bold">
                                  <td className="border border-slate-400 py-2.5 px-3 text-right" colSpan={8}>
                                    Total Collected ({filteredTaxPayrolls.length} {filteredTaxPayrolls.length === 1 ? 'record' : 'records'}):
                                  </td>
                                  <td className="border border-slate-400 py-2.5 px-3 text-right text-black font-mono">
                                    ₱{totalWithholdingTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </>
                            );
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
