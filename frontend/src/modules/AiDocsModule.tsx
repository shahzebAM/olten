import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DocumentPreview from '../components/DocumentPreview';
import { getApiAuthHeaders, expireApiSession } from '../lib/apiSession';
import { safeDocumentLink } from '../lib/documentLinks';
import { clearDocumentPreviews, invalidateDocumentPreviews, prefetchDocumentPreview } from '../lib/previewSource';

// --- INTERFACES ---
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  size?: string;
  parents?: string[];
  // --- NEW EXPIRY FIELDS ---
  documentType?: string;
  documentNumber?: string;
  expiryDate?: string;
  expiryStatus?: string;
  expiryDetectionMethod?: string;
  expiryConfidence?: number;
  documentId?: number;
  reminder?: DocumentReminder | null;
  reminderWarning?: string;
  expiryDateText?: string;
  expiryEvidence?: string;
  evidence?: string;
  daysRemaining?: number | null;
  expires?: { daysRemaining?: number | null };
  reminderSetupPending?: boolean;
  reminderDisabled?: boolean;
  reminderValue?: number | null;
}

type ReminderUnit = 'days' | 'months';

interface DocumentSource {
  documentId?: number;
  driveFileId?: string;
  sourceUrl?: string;
  googleDriveLink?: string;
}

interface DocumentReminder extends DocumentSource {
  id: number;
  fileName: string;
  expiryDate: string;
  reminderDays: number;
  triggerDate: string;
  status: string;
  isTriggered: boolean;
  title?: string;
  message?: string;
  reminderValue?: number;
  reminderUnit?: ReminderUnit;
  daysRemaining?: number | null;
  expires?: { daysRemaining?: number | null };
}

interface ExpiryReviewFile extends DocumentSource {
  id: number;
  name: string;
  expiryDate: string;
  reminderValue: string;
  reminderUnit: ReminderUnit;
  expiryStatus?: string;
  warning?: string;
  hasReminder: boolean;
  expiryDateText?: string;
  expiryEvidence?: string;
}

interface UploadedDocument extends DocumentSource {
  id: number;
  originalName?: string;
  filename?: string;
  expiryDate?: string;
  expiryStatus?: string;
  reminder?: DocumentReminder | null;
  reminderWarning?: string;
  detectionWarning?: string;
  indexingWarning?: string;
  expiryDateText?: string;
  expiryEvidence?: string;
  evidence?: string;
}

interface ReplacedDocument extends UploadedDocument {
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  documentType?: string;
  documentNumber?: string;
  expiryDetectionMethod?: string;
  expiryConfidence?: number;
  daysRemaining?: number | null;
  reminderDisabled?: boolean;
  reminderSetupPending?: boolean;
  reminderValue?: number | null;
  cleanupWarning?: string;
}

interface UploadProgress {
  current: number;
  total: number;
  filename: string;
  progressPct: number;
  phase: 'uploading' | 'analyzing';
  phaseStartedAt: number;
  elapsedMs: number;
  remainingMs: number | null;
  analysisEstimateMs: number;
  estimateBasedOnHistory: boolean;
}

interface ProcessingEstimate { averageMs: number; samples: number }
const PROCESSING_ESTIMATES_KEY = 'olten-document-processing-estimates';
const processingCategory = (file: File) => file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'document';
const processingEstimate = (category: string): ProcessingEstimate => {
  try {
    const estimates = JSON.parse(localStorage.getItem(PROCESSING_ESTIMATES_KEY) || '{}');
    const estimate = estimates[category] as ProcessingEstimate | undefined;
    if (estimate && Number.isFinite(estimate.averageMs) && estimate.averageMs > 0 && estimate.samples > 0) return estimate;
  } catch { /* Storage may be disabled. A rough estimate is still available. */ }
  return { averageMs: category === 'image' ? 20000 : 30000, samples: 0 };
};
const recordProcessingDuration = (category: string, durationMs: number) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  try {
    const estimates = JSON.parse(localStorage.getItem(PROCESSING_ESTIMATES_KEY) || '{}');
    const previous = processingEstimate(category);
    const samples = Math.min(previous.samples + 1, 10);
    estimates[category] = { averageMs: previous.samples ? previous.averageMs + (durationMs - previous.averageMs) / samples : durationMs, samples };
    localStorage.setItem(PROCESSING_ESTIMATES_KEY, JSON.stringify(estimates));
  } catch { /* Uploads also work when browser storage is unavailable. */ }
};
const approximateDuration = (milliseconds: number) => {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} sec`;
};
const expiryCountdownText = (days: number) => days < 0 ? `Expired ${Math.abs(days)} ${days === -1 ? 'day' : 'days'} ago` : days === 0 ? 'Expires today' : `${days} ${days === 1 ? 'day' : 'days'} remaining`;

function SourceEyeIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" strokeWidth="2" /></svg>;
}

const dateInputValue = (date?: string) => date?.slice(0, 10) || '';
const displayDate = (date: string) => new Date(`${dateInputValue(date)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const isValidReminder = (value: string, unit: ReminderUnit) => value.trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= (unit === 'months' ? 1200 : 36500);
const canScheduleReminder = (file: { expiryDate?: string; expiryStatus?: string }) => Boolean(file.expiryDate) && file.expiryStatus !== 'NEEDS_REVIEW';
const previewVersion = (file: DriveFile) => [file.modifiedTime, file.md5Checksum].filter(Boolean).join('|') || undefined;

function ReminderLeadTimeInput({ value, unit, onChange, disabled = false }: {
  value: string;
  unit: ReminderUnit;
  onChange: (value: string, unit: ReminderUnit) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
      Remind me before expiry
      <span className="flex gap-2">
        <input aria-label="Reminder amount" type="number" min="0" max={unit === 'months' ? 1200 : 36500} step="1" required value={value} disabled={disabled} onChange={e => onChange(e.target.value, unit)} className="w-20 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500" />
        <select aria-label="Reminder unit" value={unit} disabled={disabled} onChange={e => onChange(value, e.target.value as ReminderUnit)} className="px-2 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="days">Days</option>
          <option value="months">Months</option>
        </select>
      </span>
    </label>
  );
}

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
}

interface AiDocsModuleProps {
  selectedCompany: string;
  loginUsername: string;
  API_BASE_URL: string;
  onBack: () => void;
}

export default function AiDocsModule({ selectedCompany, loginUsername, API_BASE_URL, onBack }: AiDocsModuleProps) {
  const mountedRef = useRef(true);
  const workspaceKey = `${API_BASE_URL}\n${selectedCompany}\n${loginUsername}`;
  const workspaceRef = useRef({ key: workspaceKey, generation: 0 });
  if (workspaceRef.current.key !== workspaceKey) {
    workspaceRef.current = { key: workspaceKey, generation: workspaceRef.current.generation + 1 };
  }
  const sourceRevisionRef = useRef(0);
  const mutationRevisionRef = useRef(0);
  const sourceFingerprintRef = useRef<string | null>(null);
  const directoryRequestRef = useRef(0);
  const notificationRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const directoryAbortRef = useRef<AbortController | null>(null);
  const notificationAbortRef = useRef<AbortController | null>(null);
  const replacementRequestRef = useRef<XMLHttpRequest | null>(null);
  const replacementPickerTargetRef = useRef<{ file: DriveFile; generation: number } | null>(null);
  const previewIntentRef = useRef<(() => void) | null>(null);
  const directoryRetryRef = useRef({ failures: 0, retryAt: 0 });
  const notificationRetryRef = useRef({ failures: 0, retryAt: 0 });
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; searchAbortRef.current?.abort(); directoryAbortRef.current?.abort(); notificationAbortRef.current?.abort(); replacementRequestRef.current?.abort(); previewIntentRef.current?.(); clearDocumentPreviews(); };
  }, []);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  
  // --- SUBMISSION LOCKS ---
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [uploadBatch, setUploadBatch] = useState<{ completed: number; total: number } | null>(null);
  const [replacementDraft, setReplacementDraft] = useState<{ target: DriveFile; file: File; generation: number } | null>(null);
  const [replacementProgress, setReplacementProgress] = useState<UploadProgress | null>(null);
  const [replacementError, setReplacementError] = useState('');
  const [isReplacing, setIsReplacing] = useState(false);

  useEffect(() => {
    if (!isUploading) return;
    const timer = setInterval(() => setUploadProgress(prev => prev.map(progress => {
      const elapsedMs = Date.now() - progress.phaseStartedAt;
      return { ...progress, elapsedMs, remainingMs: progress.phase === 'analyzing' ? Math.max(0, progress.analysisEstimateMs - elapsedMs) : progress.remainingMs };
    })), 1000);
    return () => clearInterval(timer);
  }, [isUploading]);

  useEffect(() => {
    if (!isReplacing) return;
    const timer = setInterval(() => setReplacementProgress(progress => {
      if (!progress) return null;
      const elapsedMs = Date.now() - progress.phaseStartedAt;
      return { ...progress, elapsedMs, remainingMs: progress.phase === 'analyzing' ? Math.max(0, progress.analysisEstimateMs - elapsedMs) : progress.remainingMs };
    }), 1000);
    return () => clearInterval(timer);
  }, [isReplacing]);

  // --- RESPONSIVE STATES ---
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // --- DATA STATES ---
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  
  // --- STORAGE STATE ---
  const [storageData, setStorageData] = useState<{ usage: string, limit: string } | null>(null);
  
  // --- WORKSPACE & TREE STATES ---
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [sourcePreview, setSourcePreview] = useState<({ name: string; url: string; version?: string } & DocumentSource) | null>(null);
  const [isDeletingSource, setIsDeletingSource] = useState(false);
  
  // --- EXPIRY REMINDER STATES ---
  const [expiryReviewModal, setExpiryReviewModal] = useState({
    isOpen: false,
    isAnalyzing: false,
    files: [] as ExpiryReviewFile[]
  });
  const [reviewFileCount, setReviewFileCount] = useState(0);
  const currentReviewFile = expiryReviewModal.files[0];
  const [uploadError, setUploadError] = useState('');
  const [reviewError, setReviewError] = useState('');
  
  // --- REMINDER EDITOR STATES ---
  const [isEditingReminder, setIsEditingReminder] = useState(false);
  const [manualReminderValue, setManualReminderValue] = useState('30');
  const [manualReminderUnit, setManualReminderUnit] = useState<ReminderUnit>('days');
  const [isSavingReminder, setIsSavingReminder] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  // --- NOTIFICATION STATES ---
  const [notificationState, setNotificationState] = useState<{ company: string; items: DocumentReminder[]; error: string }>({ company: selectedCompany, items: [], error: '' });
  const notifications = notificationState.company === selectedCompany ? notificationState.items.filter(reminder =>
    reminder.isTriggered && ['PENDING', 'PROCESSING'].includes(reminder.status)
    && !files.some(file => file.reminderDisabled && (file.documentId === reminder.documentId && reminder.documentId !== undefined || file.id === reminder.driveFileId))) : [];
  const notificationError = notificationState.company === selectedCompany ? notificationState.error : '';
  const [openNotificationCompany, setOpenNotificationCompany] = useState<string | null>(null);
  const isNotifOpen = openNotificationCompany === selectedCompany;
  const setIsNotifOpen = (open: boolean) => setOpenNotificationCompany(open ? selectedCompany : null);

  const fetchDocApi = useCallback(async (url: string, options?: RequestInit) => {
    const generation = workspaceRef.current.generation;
    const response = await fetch(url, options);
    if (response.status === 401 && mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === generation) expireApiSession();
    return response;
  }, [workspaceKey]);

  const fetchNotifications = useCallback(async (force = false) => {
    if (!force && (document.visibilityState === 'hidden' || navigator.onLine === false || Date.now() < notificationRetryRef.current.retryAt || notificationAbortRef.current)) return;
    notificationAbortRef.current?.abort();
    const controller = new AbortController();
    notificationAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const workspaceGeneration = workspaceRef.current.generation;
    const mutationRevision = mutationRevisionRef.current;
    const requestId = ++notificationRequestRef.current;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration && mutationRevisionRef.current === mutationRevision && notificationRequestRef.current === requestId;
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/notifications`, {
        headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany, 'x-username': loginUsername }, signal: controller.signal,
      });
      if (res.status === 401) return;
      if (!res.ok) throw new Error('Could not refresh expiry reminders.');
      const data: DocumentReminder[] = await res.json();
      if (!isCurrent()) return;
      notificationRetryRef.current = { failures: 0, retryAt: 0 };
      setNotificationState({ company: selectedCompany, items: data, error: '' });
    } catch {
      if (isCurrent()) {
        const failures = Math.min(notificationRetryRef.current.failures + 1, 5);
        notificationRetryRef.current = { failures, retryAt: Date.now() + Math.min(300_000, 30_000 * 2 ** failures) };
        setNotificationState(prev => ({ company: selectedCompany, items: prev.company === selectedCompany ? prev.items : [], error: 'Reminders could not be refreshed. Check your connection and retry.' }));
      }
    } finally {
      clearTimeout(timeout);
      if (notificationAbortRef.current === controller) notificationAbortRef.current = null;
    }
  }, [API_BASE_URL, selectedCompany, loginUsername, workspaceKey, fetchDocApi]);

  useEffect(() => {
    setOpenNotificationCompany(null);
    const initialRefresh = setTimeout(() => void fetchNotifications(), 0);
    const interval = setInterval(() => void fetchNotifications(), 30000);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') fetchNotifications(); };
    const refreshOnFocus = () => void fetchNotifications();
    const refreshOnline = () => void fetchNotifications(true);
    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener('online', refreshOnline);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      clearTimeout(initialRefresh);
      clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener('online', refreshOnline);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [fetchNotifications, selectedCompany]);

  const handleUpdateNotif = async (id: number, status: string) => {
    if (isReplacing || isProcessing || isUploading || isSavingReminder || isReanalyzing || isDeletingSource) return;
    const target = notifications.find(item => item.id === id);
    const workspaceGeneration = workspaceRef.current.generation;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    setIsProcessing(true);
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/notifications/${id}/status`, {
        method: 'PATCH',
        headers: { ...getApiAuthHeaders(), 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername },
        body: JSON.stringify({ status, expectedExpiryDate: target?.expiryDate, expectedDriveFileId: target?.driveFileId })
      });
      if (!res.ok) throw new Error('Could not update reminder');
      if (!isCurrent()) return;
      mutationRevisionRef.current += 1;
      setNotificationState(previous => ({ ...previous, items: previous.items.filter(item => item.id !== id) }));
      if (target) {
        const matches = (file: DriveFile) => target.documentId !== undefined && file.documentId === target.documentId || !!target.driveFileId && file.id === target.driveFileId;
        const patch = (file: DriveFile): DriveFile => ({ ...file, reminder: { ...(file.reminder || target), status, isTriggered: false } });
        setFiles(previous => previous.map(file => matches(file) ? patch(file) : file));
        setSelectedFile(previous => previous && matches(previous) ? patch(previous) : previous);
      }
      void fetchNotifications(true);
    } catch {
      if (isCurrent()) showToast("Failed to update status", "error");
    } finally {
      if (isCurrent()) setIsProcessing(false);
    }
  };

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [aiQuery, setAiQuery] = useState('');
  const [localQuery, setLocalQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash-lite');
  const [isSearchingAi, setIsSearchingAi] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);

  const invalidateAiSearch = useCallback(() => {
    sourceRevisionRef.current += 1;
    searchRequestRef.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setAiAnswer(null);
    setIsSearchingAi(false);
  }, []);

  useEffect(() => {
    mutationRevisionRef.current += 1;
    directoryAbortRef.current?.abort();
    notificationAbortRef.current?.abort();
    replacementRequestRef.current?.abort();
    replacementRequestRef.current = null;
    replacementPickerTargetRef.current = null;
    previewIntentRef.current?.();
    previewIntentRef.current = null;
    clearDocumentPreviews();
    directoryAbortRef.current = null;
    notificationAbortRef.current = null;
    directoryRetryRef.current = { failures: 0, retryAt: 0 };
    notificationRetryRef.current = { failures: 0, retryAt: 0 };
    setDirectoryError('');
    sourceFingerprintRef.current = null;
    invalidateAiSearch();
    setFiles([]);
    setFolders([]);
    setRootFolderId(null);
    setActiveFolderId(null);
    setSelectedFile(null);
    setSelectedItems(new Set());
    setExpandedFolders(new Set());
    setSourcePreview(null);
    setExpiryReviewModal({ isOpen: false, isAnalyzing: false, files: [] });
    setReviewFileCount(0);
    setIsEditingReminder(false);
    setIsDeletingSource(false);
    setIsUploading(false);
    setIsProcessing(false);
    setIsSavingReminder(false);
    setIsReanalyzing(false);
    setReplacementDraft(null);
    setReplacementProgress(null);
    setReplacementError('');
    setIsReplacing(false);
    setUploadProgress([]);
    setUploadBatch(null);
    setNotificationState({ company: selectedCompany, items: [], error: '' });
  }, [workspaceKey, selectedCompany, invalidateAiSearch]);

  const [aiPanelHeight, setAiPanelHeight] = useState(300);
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);
  const rightPaneRef = useRef<HTMLElement>(null);

  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ id: string, name: string } | null>(null);
  const [newRenameValue, setNewRenameValue] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handlePreviewSource = (source: DocumentSource, name: string) => {
    const matchingFile = files.find(file => source.documentId !== undefined && file.documentId === source.documentId)
      || files.find(file => !!source.driveFileId && file.id === source.driveFileId);
    const sourceUrl = matchingFile?.webViewLink || source.sourceUrl || source.googleDriveLink
      || (source.driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(source.driveFileId)}/view` : '');
    try {
      const link = safeDocumentLink(sourceUrl);
      if (!link) throw new Error('Unsupported document link');
      const driveFileId = matchingFile?.id || source.driveFileId || link.driveFileId;
      const documentId = matchingFile?.documentId ?? source.documentId;
      if (!driveFileId && documentId === undefined) throw new Error('Missing document source');
      if (matchingFile) {
        setSelectedFile(matchingFile);
        setIsEditingReminder(false);
        setActiveFolderId(matchingFile.parents?.[0] || rootFolderId);
        setExpandedFolders(prev => new Set([...prev, ...(matchingFile.parents || [])]));
      }
      setIsNotifOpen(false);
      setSourcePreview({ name: matchingFile?.name || name, url: link.href, documentId, driveFileId, version: matchingFile ? previewVersion(matchingFile) : undefined });
    } catch {
      showToast('The source document link is unavailable. Refresh the directory and try again.', 'error');
    }
  };

  const beginPreviewIntent = (file: DriveFile, immediate = false) => {
    previewIntentRef.current = prefetchDocumentPreview({
      apiBaseUrl: API_BASE_URL, company: selectedCompany, username: loginUsername,
      id: file.documentId !== undefined ? String(file.documentId) : file.id,
      source: file.documentId !== undefined ? 'document' : 'drive',
      version: previewVersion(file), mimeType: file.mimeType,
    }, immediate);
  };
  const endPreviewIntent = () => { previewIntentRef.current?.(); previewIntentRef.current = null; };
  const sourceFile = (source: DocumentSource) => files.find(file => source.documentId !== undefined && file.documentId === source.documentId)
    || files.find(file => !!source.driveFileId && file.id === source.driveFileId);
  const beginSourcePreviewIntent = (source: DocumentSource, immediate = false) => {
    const file = sourceFile(source);
    if (file) beginPreviewIntent(file, immediate);
  };

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingResizer(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsDraggingResizer(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isDraggingResizer && rightPaneRef.current) {
      const paneRect = rightPaneRef.current.getBoundingClientRect();
      let newHeight = e.clientY - paneRect.top;
      if (newHeight < 150) newHeight = 150;
      if (newHeight > paneRect.height - 200) newHeight = paneRect.height - 200;
      setAiPanelHeight(newHeight);
    }
  }, [isDraggingResizer]);

  useEffect(() => {
    if (isDraggingResizer) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingResizer, resize, stopResizing]);

  const fetchDirectory = useCallback(async (isSilent = false, force = false) => {
    if (!force && isSilent && (document.visibilityState === 'hidden' || navigator.onLine === false || Date.now() < directoryRetryRef.current.retryAt || directoryAbortRef.current)) return;
    directoryAbortRef.current?.abort();
    const controller = new AbortController();
    directoryAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    const workspaceGeneration = workspaceRef.current.generation;
    const mutationRevision = mutationRevisionRef.current;
    const requestId = ++directoryRequestRef.current;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration && mutationRevisionRef.current === mutationRevision && directoryRequestRef.current === requestId;
    if (!isSilent) setIsLoading(true);
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/directory`, {
        headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany, 'x-username': loginUsername }, signal: controller.signal,
      });
      if (res.status === 401) return;
      if (!res.ok) throw new Error('Failed to load directory');
      const data = await res.json();
      
      const nextFolders: DriveFolder[] = data.folders || [];
      const nextFiles: DriveFile[] = data.files || [];
      if (!isCurrent()) return;
      directoryRetryRef.current = { failures: 0, retryAt: 0 };
      setDirectoryError('');
      const fingerprint = JSON.stringify({
        root: data.companyFolderId,
        folders: nextFolders.map(folder => [folder.id, folder.name, [...(folder.parents || [])].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        files: nextFiles.map(file => [file.id, file.documentId ?? null, file.name, [...(file.parents || [])].sort(), file.expiryDate ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      });
      if (sourceFingerprintRef.current !== fingerprint) {
        sourceFingerprintRef.current = fingerprint;
        invalidateAiSearch();
      }

      setRootFolderId(data.companyFolderId);
      setFolders(nextFolders);
      setFiles(nextFiles);
      
      setSelectedFile(prev => {
        if (!prev) return null;
        const updatedFile = nextFiles.find(f => f.id === prev.id);
        return updatedFile ? updatedFile : null;
      });

      if (data.storageQuota) setStorageData(data.storageQuota);
      
      setActiveFolderId(prev => {
        if (!prev) {
          setExpandedFolders(exp => new Set(exp).add(data.companyFolderId));
          return data.companyFolderId;
        }
        const exists = prev === data.companyFolderId || nextFolders.some(f => f.id === prev);
        return exists ? prev : data.companyFolderId;
      });
    } catch (err: any) {
      if (isCurrent()) {
        const failures = Math.min(directoryRetryRef.current.failures + 1, 5);
        directoryRetryRef.current = { failures, retryAt: Date.now() + Math.min(120_000, 5_000 * 2 ** failures) };
        setDirectoryError('The workspace could not be refreshed. Your last loaded files are shown. Check your connection and retry.');
      }
    } finally {
      clearTimeout(timeout);
      if (directoryAbortRef.current === controller) directoryAbortRef.current = null;
      if (!isSilent && mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration) setIsLoading(false);
    }
  }, [API_BASE_URL, selectedCompany, loginUsername, workspaceKey, invalidateAiSearch, fetchDocApi]);

  useEffect(() => {
    fetchDirectory(); 
    const syncInterval = setInterval(() => { void fetchDirectory(true); }, 30000);
    const refreshOnline = () => void fetchDirectory(true, true);
    window.addEventListener('online', refreshOnline);
    return () => { clearInterval(syncInterval); window.removeEventListener('online', refreshOnline); };
  }, [fetchDirectory]);

  const formatBytes = (bytes: string | number) => {
    const b = Number(bytes);
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleGeminiSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const requestId = ++searchRequestRef.current;
    const sourceRevision = sourceRevisionRef.current;
    const workspaceGeneration = workspaceRef.current.generation;
    const isCurrent = () => mountedRef.current && !controller.signal.aborted && searchRequestRef.current === requestId && sourceRevisionRef.current === sourceRevision && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    setIsSearchingAi(true);
    setAiAnswer(null);
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/search`, {
        method: 'POST',
        signal: controller.signal,
        headers: { ...getApiAuthHeaders(), 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername },
        body: JSON.stringify({ query: aiQuery, model: selectedModel })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'AI Search failed');
      if (isCurrent()) setAiAnswer(data.answer);
    } catch (err: any) {
      if (isCurrent()) setAiAnswer(`Error: ${err.message}`);
    } finally {
      if (isCurrent()) {
        setIsSearchingAi(false);
        searchAbortRef.current = null;
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesArray = Array.from(e.target.files || []);
    e.target.value = '';
    if (filesArray.length === 0 || isUploading || isProcessing) return;
    setUploadError('');
    setIsUploading(true);
    setIsProcessing(true);
    setUploadBatch({ completed: 0, total: filesArray.length });
    const uploadedDocs: (UploadedDocument | undefined)[] = new Array(filesArray.length);
    const failedFiles: (string | undefined)[] = new Array(filesArray.length);

    const workspaceGeneration = workspaceRef.current.generation;
    const uploadContextActive = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    const uploadOneFile = async (i: number) => {
       const file = filesArray[i];
       const uploadStart = Date.now();
       const category = processingCategory(file);
       const estimate = processingEstimate(category);
       let analysisStartedAt: number | null = null;
       setUploadProgress(prev => [...prev, { current: i + 1, total: filesArray.length, filename: file.name, progressPct: 0, phase: 'uploading' as const, phaseStartedAt: uploadStart, elapsedMs: 0, remainingMs: null, analysisEstimateMs: estimate.averageMs, estimateBasedOnHistory: estimate.samples > 0 }].sort((a, b) => a.current - b.current));
       const formData = new FormData();
       formData.append('file', file);
       formData.append('reminderSetup', 'after-upload');
       if (activeFolderId && activeFolderId !== rootFolderId) {
         formData.append('targetFolderId', activeFolderId); 
       }

       try {
         const uploadedDoc = await new Promise<UploadedDocument>((resolve, reject) => {
             const xhr = new XMLHttpRequest();
             xhr.open('POST', `${API_BASE_URL}/api/docs/upload`);
             xhr.setRequestHeader('x-company', selectedCompany);
             xhr.setRequestHeader('x-username', loginUsername);
             for (const [name, value] of Object.entries(getApiAuthHeaders())) xhr.setRequestHeader(name, value);

             xhr.upload.onprogress = (event) => {
                 if (event.lengthComputable && uploadContextActive()) {
                     const actualPct = (event.loaded / event.total) * 100;
                     const elapsedMs = Date.now() - uploadStart;
                     const remainingMs = event.loaded > 0 && elapsedMs > 0 ? (event.total - event.loaded) * elapsedMs / event.loaded : null;
                     setUploadProgress(prev => prev.map(progress => progress.current === i + 1 ? { ...progress, progressPct: Math.min(actualPct, 100), elapsedMs, remainingMs } : progress));
                 }
             };

             xhr.upload.onload = () => {
               if (!uploadContextActive()) return;
               const startedAt = Date.now();
               analysisStartedAt = startedAt;
               setUploadProgress(prev => prev.map(progress => progress.current === i + 1 ? { ...progress, phase: 'analyzing', progressPct: 100, phaseStartedAt: startedAt, elapsedMs: 0, remainingMs: estimate.averageMs } : progress));
             };

             xhr.onload = () => {
                 if (xhr.status === 401 && uploadContextActive()) expireApiSession();
                 try {
                   const response = JSON.parse(xhr.responseText);
                   if (xhr.status >= 200 && xhr.status < 300) {
                     if (analysisStartedAt !== null) recordProcessingDuration(category, Date.now() - analysisStartedAt);
                     resolve(response);
                   }
                   else reject(new Error(response.message || 'Upload failed'));
                 } catch {
                   reject(new Error('The upload returned an invalid response'));
                 }
             };
             xhr.onerror = () => reject(new Error('Network error'));
             xhr.send(formData);
         });
         uploadedDocs[i] = uploadedDoc;
         if (uploadContextActive()) {
           mutationRevisionRef.current += 1;
           invalidateAiSearch();
         }
       } catch (err) {
         failedFiles[i] = `${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`;
       } finally {
         if (uploadContextActive()) {
           setUploadProgress(prev => prev.filter(progress => progress.current !== i + 1));
           setUploadBatch(prev => prev ? { ...prev, completed: prev.completed + 1 } : prev);
         }
       }
    };
    let nextIndex = 0;
    const uploadWorker = async () => {
      while (nextIndex < filesArray.length && uploadContextActive()) {
        const index = nextIndex++;
        await uploadOneFile(index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, filesArray.length) }, uploadWorker));
    if (!uploadContextActive()) return;
    const successfulDocs = uploadedDocs.filter((doc): doc is UploadedDocument => doc !== undefined);
    const uploadFailures = failedFiles.filter((failure): failure is string => failure !== undefined);
    setUploadProgress([]);
    setUploadBatch(null);
    setIsUploading(false);
    setIsProcessing(false);
    if (uploadFailures.length > 0) setUploadError(uploadFailures.join('\n'));

    if (successfulDocs.length > 0) {
       const reviewFiles: ExpiryReviewFile[] = successfulDocs.map(doc => ({
         id: doc.id,
         documentId: doc.id,
         driveFileId: doc.driveFileId,
         sourceUrl: doc.sourceUrl,
         googleDriveLink: doc.googleDriveLink,
         name: doc.originalName || doc.filename || 'Document',
         expiryDate: dateInputValue(doc.expiryDate),
         reminderValue: String(doc.reminder?.reminderValue ?? doc.reminder?.reminderDays ?? 30),
         reminderUnit: doc.reminder?.reminderUnit || 'days',
         expiryStatus: doc.expiryStatus,
         warning: [doc.detectionWarning, doc.reminderWarning, doc.indexingWarning].filter(Boolean).join(' '),
         hasReminder: Boolean(doc.reminder),
         expiryDateText: doc.expiryDateText,
         expiryEvidence: doc.expiryEvidence || doc.evidence,
       }));
       setReviewError('');
       setReviewFileCount(reviewFiles.length);
       setExpiryReviewModal({ isOpen: true, isAnalyzing: false, files: reviewFiles });
       await Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
    } else {
       showToast("Failed to upload files.", "error");
    }
  };

  const advanceExpiryReview = (documentId: number) => {
    setReviewError('');
    setExpiryReviewModal(prev => {
      if (prev.files[0]?.id !== documentId) return prev;
      const remainingFiles = prev.files.slice(1);
      return { ...prev, files: remainingFiles, isOpen: remainingFiles.length > 0 };
    });
  };

  const requestDocumentReplacement = (target: DriveFile) => {
    if (target.documentId === undefined || !canScheduleReminder(target) || isUploading || isProcessing || isSavingReminder || isReanalyzing || isDeletingSource || replacementDraft || expiryReviewModal.isOpen) return;
    replacementPickerTargetRef.current = { file: target, generation: workspaceRef.current.generation };
    replacementInputRef.current?.click();
  };

  const handleReplacementFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const target = replacementPickerTargetRef.current;
    replacementPickerTargetRef.current = null;
    if (!file || !target || !mountedRef.current || target.generation !== workspaceRef.current.generation || isProcessing || isUploading) return;
    if (file.size === 0 || file.size > 50 * 1024 * 1024) {
      showToast('Choose a non-empty replacement file up to 50 MB.', 'error');
      return;
    }
    setReplacementError('');
    setReplacementProgress(null);
    setReplacementDraft({ target: target.file, file, generation: target.generation });
  };

  const handleReplaceDocument = async () => {
    const draft = replacementDraft;
    if (!draft || isReplacing || isProcessing || isUploading || isSavingReminder || isReanalyzing || isDeletingSource) return;
    const { target, file, generation } = draft;
    if (generation !== workspaceRef.current.generation || target.documentId === undefined || !files.some(item => item.id === target.id && item.documentId === target.documentId)) {
      setReplacementError('This document changed. Close this dialog, refresh the directory, and choose it again.');
      return;
    }
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === generation;
    const category = processingCategory(file);
    const estimate = processingEstimate(category);
    const uploadStart = Date.now();
    let analysisStartedAt: number | null = null;
    let request: XMLHttpRequest | null = null;
    setIsReplacing(true);
    setIsProcessing(true);
    setReplacementError('');
    setReplacementProgress({ current: 1, total: 1, filename: file.name, progressPct: 0, phase: 'uploading', phaseStartedAt: uploadStart, elapsedMs: 0, remainingMs: null, analysisEstimateMs: estimate.averageMs, estimateBasedOnHistory: estimate.samples > 0 });
    try {
      const document = await new Promise<ReplacedDocument>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        request = xhr;
        replacementRequestRef.current = xhr;
        xhr.open('POST', `${API_BASE_URL}/api/docs/${encodeURIComponent(String(target.documentId))}/replace`);
        xhr.timeout = 300_000;
        xhr.setRequestHeader('x-company', selectedCompany);
        xhr.setRequestHeader('x-username', loginUsername);
        for (const [name, value] of Object.entries(getApiAuthHeaders())) xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = event => {
          if (!event.lengthComputable || !isCurrent()) return;
          const elapsedMs = Date.now() - uploadStart;
          setReplacementProgress(progress => progress ? { ...progress, progressPct: Math.min(100, event.loaded / event.total * 100), elapsedMs, remainingMs: event.loaded > 0 ? (event.total - event.loaded) * elapsedMs / event.loaded : null } : progress);
        };
        xhr.upload.onload = () => {
          if (!isCurrent()) return;
          analysisStartedAt = Date.now();
          setReplacementProgress(progress => progress ? { ...progress, phase: 'analyzing', progressPct: 100, phaseStartedAt: analysisStartedAt!, elapsedMs: 0, remainingMs: estimate.averageMs } : progress);
        };
        xhr.onload = () => {
          if (xhr.status === 401 && isCurrent()) expireApiSession();
          try {
            const response = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(response);
            else reject(new Error(typeof response.message === 'string' ? response.message : 'The document could not be replaced.'));
          } catch {
            reject(new Error('The replacement returned an invalid response. Refresh the directory before trying again.'));
          }
        };
        xhr.onerror = () => reject(new Error('The replacement connection failed. Refresh the directory before trying again.'));
        xhr.ontimeout = () => reject(new Error('The replacement took too long. Refresh the directory before trying again.'));
        xhr.onabort = () => reject(new Error('The replacement request was cancelled.'));
        const formData = new FormData();
        formData.append('file', file);
        formData.append('expectedDriveFileId', target.id);
        xhr.send(formData);
      });
      if (!isCurrent()) return;
      if (document.id !== target.documentId || !document.driveFileId || !/^[A-Za-z0-9_-]+$/.test(document.driveFileId)) {
        throw new Error('The replacement returned an incomplete response. Refresh the directory before trying again.');
      }
      if (analysisStartedAt !== null) recordProcessingDuration(category, Date.now() - analysisStartedAt);
      const warnings = [document.detectionWarning, document.reminderWarning, document.indexingWarning, document.cleanupWarning].filter(Boolean).join(' ');
      const updated: DriveFile = {
        ...target,
        id: document.driveFileId,
        name: document.originalName || document.filename || file.name,
        mimeType: document.mimeType || file.type,
        size: document.size || String(file.size),
        webViewLink: document.sourceUrl || document.googleDriveLink || `https://drive.google.com/file/d/${encodeURIComponent(document.driveFileId)}/view`,
        modifiedTime: document.modifiedTime || new Date().toISOString(),
        md5Checksum: document.md5Checksum,
        documentId: document.id,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        expiryDate: document.expiryDate,
        expiryStatus: document.expiryStatus,
        expiryDetectionMethod: document.expiryDetectionMethod,
        expiryConfidence: document.expiryConfidence,
        expiryDateText: document.expiryDateText,
        expiryEvidence: document.expiryEvidence || document.evidence,
        daysRemaining: document.daysRemaining,
        expires: undefined,
        reminder: document.reminder || null,
        reminderDisabled: document.reminderDisabled ?? target.reminderDisabled,
        reminderSetupPending: document.reminderSetupPending ?? target.reminderSetupPending,
        reminderValue: document.reminderValue ?? document.reminder?.reminderValue ?? document.reminder?.reminderDays ?? null,
        reminderWarning: warnings || undefined,
      };
      mutationRevisionRef.current += 1;
      directoryAbortRef.current?.abort();
      notificationAbortRef.current?.abort();
      invalidateDocumentPreviews(selectedCompany, new Set([document.id]), new Set([target.id]));
      invalidateAiSearch();
      setFiles(previous => previous.map(item => item.documentId === document.id || item.id === target.id ? updated : item));
      setSelectedFile(previous => previous && (previous.documentId === document.id || previous.id === target.id) ? updated : previous);
      setSelectedItems(previous => new Set([...previous].map(id => id === target.id ? updated.id : id)));
      setSourcePreview(previous => previous && (previous.documentId === document.id || previous.driveFileId === target.id) ? null : previous);
      setNotificationState(previous => ({ ...previous, items: previous.items.filter(item => item.documentId !== document.id && item.driveFileId !== target.id) }));
      setIsEditingReminder(false);
      setIsNotifOpen(false);
      setReplacementDraft(null);
      setReviewError('');
      setReviewFileCount(1);
      setExpiryReviewModal({ isOpen: true, isAnalyzing: false, files: [{
        id: document.id, documentId: document.id, driveFileId: document.driveFileId,
        sourceUrl: updated.webViewLink, googleDriveLink: document.googleDriveLink,
        name: updated.name, expiryDate: dateInputValue(document.expiryDate), expiryStatus: document.expiryStatus,
        expiryDateText: document.expiryDateText, expiryEvidence: document.expiryEvidence || document.evidence,
        reminderValue: String(document.reminder?.reminderValue ?? document.reminder?.reminderDays ?? target.reminder?.reminderValue ?? target.reminder?.reminderDays ?? 30),
        reminderUnit: document.reminder?.reminderUnit || target.reminder?.reminderUnit || 'days',
        hasReminder: Boolean(document.reminder) && !updated.reminderDisabled,
        warning: [warnings, updated.reminderDisabled ? 'Reminders are disabled. Save Reminder to enable one, or close without a reminder to keep all alerts disabled.' : !document.reminder ? 'No reminder is scheduled. Choose Save Reminder or Close Without Reminder for this replacement.' : undefined].filter(Boolean).join(' '),
      }] });
      showToast('Document replaced. Review its detected expiry and reminder choice.', 'success');
      void Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
    } catch (error) {
      if (isCurrent()) {
        setReplacementError(error instanceof Error ? error.message : 'The document could not be replaced.');
        void Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
      }
    } finally {
      if (replacementRequestRef.current === request) replacementRequestRef.current = null;
      if (isCurrent()) {
        setIsReplacing(false);
        setIsProcessing(false);
        setReplacementProgress(null);
      }
    }
  };

  const handleSkipReminder = async () => {
    const file = currentReviewFile;
    if (!file || isProcessing || isReanalyzing || isDeletingSource) return;
    const workspaceGeneration = workspaceRef.current.generation;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    setReviewError('');
    setIsProcessing(true);
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/${encodeURIComponent(String(file.id))}/reminder`, {
        method: 'DELETE', headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany, 'x-username': loginUsername },
      });
      const data = await res.json();
      if (!isCurrent()) return;
      if (!res.ok) throw new Error(data.message || 'Could not close without a reminder. Please retry.');
      mutationRevisionRef.current += 1;
      const isThisFile = (source: DocumentSource) => source.documentId === file.id || !!file.driveFileId && source.driveFileId === file.driveFileId;
      setFiles(prev => prev.map(item => item.documentId === file.id || !!file.driveFileId && item.id === file.driveFileId
        ? { ...item, reminder: null, reminderValue: null, reminderDisabled: true, reminderSetupPending: false, reminderWarning: data.reminderWarning } : item));
      setSelectedFile(prev => prev && (prev.documentId === file.id || !!file.driveFileId && prev.id === file.driveFileId)
        ? { ...prev, reminder: null, reminderValue: null, reminderDisabled: true, reminderSetupPending: false, reminderWarning: data.reminderWarning } : prev);
      setNotificationState(prev => ({ ...prev, items: prev.items.filter(item => !isThisFile(item)) }));
      setManualReminderValue('');
      advanceExpiryReview(file.id);
      void Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
    } catch (err) {
      if (isCurrent()) setReviewError(err instanceof Error ? err.message : 'Could not close without a reminder. Please retry.');
    } finally {
      if (isCurrent()) setIsProcessing(false);
    }
  };

  const handleSaveReviewReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = currentReviewFile;
    if (!file || isProcessing || isReanalyzing || isDeletingSource) return;
    if (!canScheduleReminder(file)) {
      setReviewError('A trusted expiry date is required. Re-analyze the document before setting a reminder.');
      return;
    }
    if (!isValidReminder(file.reminderValue, file.reminderUnit)) {
      setReviewError('Reminder amounts must be whole numbers: 0–36500 days or 0–1200 months.');
      return;
    }
    setReviewError('');
    setIsProcessing(true);
    const workspaceGeneration = workspaceRef.current.generation;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/save-reminders`, {
        method: 'POST',
        headers: { ...getApiAuthHeaders(), 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername },
        body: JSON.stringify({ reminders: [{ id: file.id, reminderValue: Number(file.reminderValue), reminderUnit: file.reminderUnit }] })
      });
      const data = await res.json();
      if (!isCurrent()) return;
      if (!res.ok) throw new Error(data.message || 'Failed to save reminder.');
      showToast(`Reminder saved for ${file.name}.`, 'success');
      advanceExpiryReview(file.id);
      void Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
    } catch (err) {
      if (isCurrent()) setReviewError(err instanceof Error ? err.message : 'Failed to save reminder.');
    } finally {
      if (isCurrent()) setIsProcessing(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || isCreatingFolder || isReplacing) return;
    setIsCreatingFolder(true);
    try {
      const targetId = activeFolderId && activeFolderId !== rootFolderId ? activeFolderId : undefined;
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/folder`, {
        method: 'POST',
        headers: { ...getApiAuthHeaders(), 'Content-Type': 'application/json', 'x-company': selectedCompany },
        body: JSON.stringify({ folderName: newFolderName.trim(), targetFolderId: targetId, parentFolderId: targetId })
      });
      if (!res.ok) throw new Error();
      setNewFolderName('');
      setIsNewFolderModalOpen(false);
      showToast('Folder created', 'success');
      if (targetId) setExpandedFolders(prev => new Set(prev).add(targetId));
      void fetchDirectory(true, true);
    } catch {
      showToast('Could not create folder', 'error');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !newRenameValue.trim() || isReplacing) return;
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/folder/${renameTarget.id}/rename`, {
        method: 'PATCH',
        headers: { ...getApiAuthHeaders(), 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername },
        body: JSON.stringify({ newName: newRenameValue.trim() })
      });
      if (!res.ok) throw new Error();
      showToast('Renamed successfully', 'success');
      setRenameTarget(null);
      if (selectedFile?.id === renameTarget.id) setSelectedFile({ ...selectedFile, name: newRenameValue.trim() });
      void fetchDirectory(true, true);
    } catch {
      showToast('Failed to rename', 'error');
    }
  };

  const removeDocumentsFromView = (driveIds: Set<string>, documentIds: Set<number>) => {
    if (driveIds.size === 0 && documentIds.size === 0) return;
    invalidateDocumentPreviews(selectedCompany, documentIds, driveIds);
    mutationRevisionRef.current += 1;
    invalidateAiSearch();
    setReviewError('');
    const matches = (source: DocumentSource) => source.documentId !== undefined && documentIds.has(source.documentId) || !!source.driveFileId && driveIds.has(source.driveFileId);
    setFiles(prev => prev.filter(file => !driveIds.has(file.id) && !(file.documentId !== undefined && documentIds.has(file.documentId))));
    setSelectedFile(prev => prev && (driveIds.has(prev.id) || prev.documentId !== undefined && documentIds.has(prev.documentId)) ? null : prev);
    setSelectedItems(prev => new Set([...prev].filter(id => !driveIds.has(id))));
    setExpiryReviewModal(prev => {
      const remaining = prev.files.filter(file => !documentIds.has(file.id) && !matches(file));
      return { ...prev, files: remaining, isOpen: prev.isOpen && remaining.length > 0 };
    });
    setSourcePreview(prev => prev && matches(prev) ? null : prev);
    setNotificationState(prev => ({ ...prev, items: prev.items.filter(reminder => !matches(reminder)) }));
    if (activeFolderId && driveIds.has(activeFolderId)) setActiveFolderId(rootFolderId);
  };

  const handleDeleteSource = async () => {
    if (!sourcePreview || isDeletingSource || isProcessing || isSavingReminder || isReanalyzing) return;
    const target = sourcePreview;
    const id = target.documentId ?? target.driveFileId;
    if (id === undefined) {
      showToast('This document has no deletion identifier. Refresh the directory and try again.', 'error');
      return;
    }
    if (!window.confirm(`Permanently delete "${target.name}" and its expiry reminders? The source file will be removed from Google Drive.`)) return;
    const workspaceGeneration = workspaceRef.current.generation;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    setIsDeletingSource(true);
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/${encodeURIComponent(String(id))}`, { method: 'DELETE', headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany, 'x-username': loginUsername } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'The document could not be deleted.');
      }
      if (!isCurrent()) return;
      removeDocumentsFromView(new Set(target.driveFileId ? [target.driveFileId] : []), new Set(target.documentId !== undefined ? [target.documentId] : []));
      setIsEditingReminder(false);
      setSourcePreview(null);
      showToast('Document and reminders deleted.', 'success');
      await Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
    } catch (err) {
      if (isCurrent()) showToast(err instanceof Error ? err.message : 'The document could not be deleted.', 'error');
    } finally {
      if (isCurrent()) setIsDeletingSource(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0 || isUploading || isProcessing || isSavingReminder || isReanalyzing || isDeletingSource) return;
    if (!window.confirm(`Permanently delete ${selectedItems.size} selected item(s)?`)) return;
    const workspaceGeneration = workspaceRef.current.generation;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    setIsLoading(true); 
    try {
      const nestedIds = new Set<string>();
      folders.filter(folder => selectedItems.has(folder.id)).forEach(folder => getAllDescendants(folder.id).forEach(id => nestedIds.add(id)));
      const targets = [...selectedItems].filter(id => !nestedIds.has(id));
      const results = await Promise.allSettled(targets.map(async id => {
        const res = await fetchDocApi(`${API_BASE_URL}/api/docs/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany, 'x-username': loginUsername } });
        if (!res.ok) throw new Error('Delete failed');
        return id;
      }));
      if (!isCurrent()) return;
      const deletedIds = new Set<string>();
      results.forEach(result => { if (result.status === 'fulfilled') { deletedIds.add(result.value); getAllDescendants(result.value).forEach(id => deletedIds.add(id)); } });
      const documentIds = new Set(files.flatMap(file => deletedIds.has(file.id) && file.documentId !== undefined ? [file.documentId] : []));
      removeDocumentsFromView(deletedIds, documentIds);
      const failures = results.filter(result => result.status === 'rejected').length;
      showToast(failures ? `${failures} selected item(s) could not be deleted. Try again.` : `Deleted ${selectedItems.size} item(s)`, failures ? 'error' : 'success');
      await Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
    } catch {
      if (isCurrent()) {
        showToast('Failed to delete some items', 'error');
        await fetchDirectory(true);
      }
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  };

  // --- EXPIRY & REMINDER LOGIC ---
  const calculateDaysRemaining = (expiryStr?: string, serverDays?: number | null) => {
    if (typeof serverDays === 'number' && Number.isFinite(serverDays)) return serverDays;
    if (!expiryStr) return null;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const todayDate = Date.UTC(Number(parts.find(part => part.type === 'year')?.value), Number(parts.find(part => part.type === 'month')?.value) - 1, Number(parts.find(part => part.type === 'day')?.value));
    const expiryDate = new Date(`${dateInputValue(expiryStr)}T00:00:00Z`).getTime();
    return Number.isFinite(expiryDate) ? Math.round((expiryDate - todayDate) / 86400000) : null;
  };
  const selectedDaysRemaining = selectedFile ? calculateDaysRemaining(selectedFile.expiryDate, selectedFile.daysRemaining ?? selectedFile.expires?.daysRemaining) : null;

  const handleSaveSelectedReminder = async () => {
    if (!selectedFile || isSavingReminder || isProcessing || isUploading || isReanalyzing || isDeletingSource) return;
    if (!canScheduleReminder(selectedFile) || !isValidReminder(manualReminderValue, manualReminderUnit)) {
      showToast('A trusted detected expiry date and a valid reminder amount are required.', 'error');
      return;
    }
    const workspaceGeneration = workspaceRef.current.generation;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    setIsSavingReminder(true);
    try {
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/save-reminders`, {
        method: 'POST',
        headers: { ...getApiAuthHeaders(), 'Content-Type': 'application/json', 'x-company': selectedCompany, 'x-username': loginUsername },
        body: JSON.stringify({ reminders: [{ id: selectedFile.documentId ?? selectedFile.id, reminderValue: Number(manualReminderValue), reminderUnit: manualReminderUnit }] })
      });
      const data = await res.json();
      if (!isCurrent()) return;
      if (!res.ok) throw new Error(data.message || 'Failed to save reminder.');
      mutationRevisionRef.current += 1;
      showToast('Reminder saved.', 'success');
      setIsEditingReminder(false);
      await Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
    } catch (err) {
      if (isCurrent()) showToast(err instanceof Error ? err.message : 'Failed to save reminder.', 'error');
    } finally {
      if (isCurrent()) setIsSavingReminder(false);
    }
  };

  const handleReanalyze = async (reviewFile?: ExpiryReviewFile) => {
    const id = reviewFile?.id ?? selectedFile?.documentId ?? selectedFile?.id;
    if (id === undefined || isReanalyzing || isProcessing || isUploading || isSavingReminder || isDeletingSource) return;
    const workspaceGeneration = workspaceRef.current.generation;
    const isCurrent = () => mountedRef.current && workspaceRef.current.key === workspaceKey && workspaceRef.current.generation === workspaceGeneration;
    setIsReanalyzing(true);
    try {
      showToast("Re-analyzing document with AI...", "success");
      const res = await fetchDocApi(`${API_BASE_URL}/api/docs/${encodeURIComponent(String(id))}/reanalyze`, {
        method: 'POST',
        headers: { ...getApiAuthHeaders(), 'x-company': selectedCompany, 'x-username': loginUsername }
      });
      const data = await res.json();
      if (!isCurrent()) return;
      if (!res.ok) throw new Error(data.message || 'Failed to re-analyze.');
      mutationRevisionRef.current += 1;
      invalidateAiSearch();
      setExpiryReviewModal(prev => ({ ...prev, files: prev.files.map(file => file.id === data.id ? { ...file, expiryDate: dateInputValue(data.expiryDate), expiryStatus: data.expiryStatus, expiryDateText: data.expiryDateText, expiryEvidence: data.expiryEvidence || data.evidence, warning: [data.detectionWarning, data.reminderWarning, data.indexingWarning].filter(Boolean).join(' '), hasReminder: Boolean(data.reminder) } : file) }));
      showToast(data.detectionWarning || data.reminderWarning || (data.expiryStatus === 'NEEDS_REVIEW' ? 'The detected expiry needs your review.' : 'Re-analysis complete.'), data.detectionWarning || data.reminderWarning ? 'error' : 'success');
      await Promise.all([fetchDirectory(true, true), fetchNotifications(true)]);
    } catch (err) {
      if (isCurrent()) showToast(err instanceof Error ? err.message : 'Failed to re-analyze.', 'error');
    } finally {
      if (isCurrent()) setIsReanalyzing(false);
    }
  };

  const renderStatusBadge = (status?: string, pulse = true) => {
    switch (status) {
      case 'ACTIVE': return <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-[10px] font-bold">ACTIVE</span>;
      case 'EXPIRING_SOON': return <span className={`bg-amber-100 text-amber-800 px-2 py-1 rounded text-[10px] font-bold ${pulse ? 'animate-pulse' : ''}`}>EXPIRING SOON</span>;
      case 'EXPIRES_TODAY': return <span className="bg-rose-100 text-rose-800 px-2 py-1 rounded text-[10px] font-bold">EXPIRES TODAY</span>;
      case 'EXPIRED': return <span className="bg-rose-100 text-rose-800 px-2 py-1 rounded text-[10px] font-bold">EXPIRED</span>;
      case 'NEEDS_REVIEW': return <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded text-[10px] font-bold">NEEDS REVIEW</span>;
      case 'NO_EXPIRY': return <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-[10px] font-bold">NO EXPIRY FOUND</span>;
      default: return null;
    }
  };

  const activeFiles = useMemo(() => {
    if (!localQuery.trim()) return files;
    const q = localQuery.toLowerCase();
    return files.filter(f => f.name.toLowerCase().includes(q));
  }, [files, localQuery]);

  const getAllDescendants = useCallback((parentId: string, currentDescendants = new Set<string>()) => {
    const childFolders = folders.filter(f => f.parents?.includes(parentId));
    const childFiles = files.filter(f => f.parents?.includes(parentId));
    childFolders.forEach(f => {
      currentDescendants.add(f.id);
      getAllDescendants(f.id, currentDescendants);
    });
    childFiles.forEach(f => currentDescendants.add(f.id));
    return currentDescendants;
  }, [folders, files]);

  const toggleSelection = (id: string, e: React.MouseEvent, isFolder: boolean = false) => {
    e.stopPropagation();
    const newSet = new Set(selectedItems);
    const isSelected = newSet.has(id);
    if (isSelected) {
      newSet.delete(id);
      if (isFolder) {
        const descendants = getAllDescendants(id);
        descendants.forEach(descId => newSet.delete(descId));
      }
    } else {
      newSet.add(id);
      if (isFolder) {
        const descendants = getAllDescendants(id);
        descendants.forEach(descId => newSet.add(descId));
      }
    }
    setSelectedItems(newSet);
  };

  const totalSelectableItems = folders.length + files.length;
  const isAllSelected = totalSelectableItems > 0 && selectedItems.size === totalSelectableItems;

  const handleSelectAllToggle = () => {
    if (isAllSelected) setSelectedItems(new Set());
    else {
      const allIds = new Set([...folders.map(f => f.id), ...files.map(f => f.id)]);
      setSelectedItems(allIds);
    }
  };

  const toggleFolderExpand = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const newSet = new Set(expandedFolders);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedFolders(newSet);
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('document') || mimeType.includes('word')) return <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    if (mimeType.includes('pdf')) return <svg className="w-4 h-4 text-rose-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
    return <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>;
  };

  const renderFormattedText = (text: string) => {
    const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, i) => {
      const match = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        const linkText = match[1];
        const link = safeDocumentLink(match[2]);
        const foundFile = link?.driveFileId ? files.find(file => file.id === link.driveFileId) : undefined;
        if (!link || !foundFile) return <span key={i}>{linkText}</span>;
        return (
          <a key={i} href={link.href} target="_blank" rel="noopener noreferrer"
            onPointerEnter={() => beginPreviewIntent(foundFile)} onPointerLeave={endPreviewIntent}
            onFocus={() => beginPreviewIntent(foundFile, true)} onBlur={endPreviewIntent}
            onPointerDown={() => beginPreviewIntent(foundFile, true)}
            onClick={(e) => {
              e.preventDefault();
              handlePreviewSource({ documentId: foundFile.documentId, driveFileId: foundFile.id }, foundFile.name);
            }}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 mb-1 bg-indigo-50 border border-indigo-200 rounded text-indigo-700 font-bold text-xs hover:bg-indigo-100 transition-colors no-underline"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            {linkText}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const renderTree = useCallback((parentId: string, depth: number = 0) => {
    const childFolders = folders.filter(f => f.parents?.includes(parentId));
    const childFiles = files.filter(f => f.parents?.includes(parentId));

    return (
      <div className="flex flex-col w-full" key={`group-${parentId}`}>
        {childFolders.map(folder => (
          <React.Fragment key={folder.id}>
            <div 
              onClick={() => { setActiveFolderId(folder.id); toggleFolderExpand(folder.id); }}
              className={`group flex items-center w-full px-2 py-1.5 cursor-pointer text-sm transition-colors border-l-2 ${activeFolderId === folder.id ? 'bg-indigo-50/50 border-indigo-500' : 'border-transparent hover:bg-slate-100'}`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <div onClick={(e) => toggleSelection(folder.id, e, true)} className={`w-4 h-4 mr-2 border rounded flex items-center justify-center shrink-0 transition-colors ${selectedItems.has(folder.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
                {selectedItems.has(folder.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
              </div>
              <button onClick={(e) => toggleFolderExpand(folder.id, e)} className="p-0.5 text-slate-400 hover:text-slate-700 shrink-0 mr-1 transition-transform" style={{ transform: expandedFolders.has(folder.id) ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg>
              </button>
              <svg className={`w-4 h-4 mr-2 shrink-0 ${activeFolderId === folder.id ? 'text-indigo-500' : 'text-blue-400'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
              <span className={`truncate flex-1 ${activeFolderId === folder.id ? 'font-bold text-indigo-900' : 'font-medium text-slate-700'}`}>{folder.name}</span>
            </div>
            {expandedFolders.has(folder.id) && renderTree(folder.id, depth + 1)}
          </React.Fragment>
        ))}

        {childFiles.map(file => (
          <div 
            key={file.id}
            role="button" tabIndex={0} aria-label={`Open ${file.name}`}
            onPointerEnter={() => beginPreviewIntent(file)} onPointerLeave={endPreviewIntent}
            onFocus={() => beginPreviewIntent(file, true)} onBlur={endPreviewIntent}
            onPointerDown={() => beginPreviewIntent(file, true)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedFile(file); setIsEditingReminder(false); setActiveFolderId(parentId); if (window.innerWidth < 1024) setIsMobileNavOpen(false); } }}
            onClick={() => { setSelectedFile(file); setIsEditingReminder(false); setActiveFolderId(parentId); if (window.innerWidth < 1024) setIsMobileNavOpen(false); }}
            className={`group flex items-center w-full px-2 py-1.5 cursor-pointer text-sm transition-colors border-l-2 ${selectedFile?.id === file.id ? 'bg-indigo-50/50 border-indigo-500' : 'border-transparent hover:bg-slate-100'}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <div onClick={(e) => toggleSelection(file.id, e, false)} className={`w-4 h-4 mr-2 border rounded flex items-center justify-center shrink-0 transition-colors ${selectedItems.has(file.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
              {selectedItems.has(file.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
            </div>
            <div className="w-4 shrink-0 mr-1"></div>
            <div className="mr-2 shrink-0">{getFileIcon(file.mimeType)}</div>
            <span className={`truncate flex-1 ${selectedFile?.id === file.id ? 'font-bold text-indigo-900' : 'font-medium text-slate-600'}`}>{file.name}</span>
            
            {/* Expiry dot indicator on file tree */}
            {!file.reminderDisabled && file.reminder?.status !== 'FULFILLED' && file.expiryStatus === 'EXPIRING_SOON' && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 ml-2 animate-pulse"></span>}
            {!file.reminderDisabled && file.reminder?.status !== 'FULFILLED' && (file.expiryStatus === 'EXPIRED' || file.expiryStatus === 'EXPIRES_TODAY') && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 ml-2"></span>}
            {file.expiryStatus === 'NEEDS_REVIEW' && <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0 ml-2"></span>}
          </div>
        ))}
      </div>
    );
  }, [folders, files, activeFolderId, expandedFolders, selectedItems, selectedFile, toggleSelection]);

  return (
    <div className="flex flex-col h-screen w-full bg-[#FBFBFC] font-sans text-slate-800 overflow-hidden relative">
      
      {toast && (
        <div role="status" className={`fixed bottom-24 right-6 z-[250] max-w-sm px-5 py-3 rounded-lg shadow-lg font-bold text-sm border ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* TOP HEADER */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 shrink-0 z-30 shadow-sm relative">
        <div className="flex items-center gap-4 w-auto lg:w-1/4 shrink-0">
          <button onClick={() => setIsMobileNavOpen(!isMobileNavOpen)} className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          
          <div className="hidden lg:flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center shadow-md shrink-0">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900 leading-tight truncate">{selectedCompany}</h2>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Workspace Directory</p>
            </div>
          </div>
        </div>

        {/* GEMINI AI SEARCH BAR */}
        <div className="flex-1 min-w-0 mx-3 flex justify-center max-w-3xl">
          <form onSubmit={handleGeminiSearch} className="relative w-full flex bg-[#F4F5F7] rounded-lg border border-transparent focus-within:border-indigo-300 focus-within:bg-white transition-all overflow-hidden shadow-sm">
            <div className="pl-4 flex items-center shrink-0">
              {isSearchingAi ? (
                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              )}
            </div>
            <input 
              type="text" 
              placeholder="Ask AI to analyze across all folders..." 
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              className="w-full bg-transparent text-sm px-3 py-2.5 outline-none placeholder:text-slate-400 font-medium"
            />
            <select 
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              className="hidden md:block bg-slate-200/50 hover:bg-slate-200 text-[10px] font-bold text-slate-600 border-l border-slate-300 outline-none px-3 cursor-pointer transition-colors"
            >
              <option value="gemini-3.6-flash">⚡ 3.6 Flash (Fast)</option>
              <option value="gemini-3.5-flash-lite">🪙 3.5 Flash-Lite</option>
            </select>
          </form>
        </div>

        <div className="w-auto lg:w-1/4 flex justify-end items-center gap-2 lg:gap-4 shrink-0">
          <button onClick={onBack} disabled={isUploading || isProcessing || isSavingReminder || isReanalyzing || isDeletingSource} title={isUploading ? 'Wait for the upload and reminder review to finish' : undefined} className="flex items-center gap-2 px-4 lg:px-5 py-2 lg:py-2.5 bg-slate-900 text-white rounded-xl text-[10px] lg:text-xs font-bold uppercase tracking-widest shadow-sm hover:bg-slate-800 transition-all disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
            <span className="hidden sm:inline">Gateway</span>
          </button>
          <button type="button" onClick={() => { setIsNotifOpen(!isNotifOpen); if (!isNotifOpen) void fetchNotifications(true); }}
            aria-label={`Expiry reminders: ${notifications.filter(n => n.isTriggered && n.status !== 'FULFILLED').length} due`}
            aria-controls="expiry-reminders-panel" aria-expanded={isNotifOpen}
            className="relative w-10 h-10 lg:w-11 lg:h-11 shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-sm flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
            {notifications.some(n => n.isTriggered && n.status !== 'FULFILLED') && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-rose-600 border-2 border-white text-[10px] font-extrabold flex items-center justify-center rounded-full">{notifications.filter(n => n.isTriggered && n.status !== 'FULFILLED').length}</span>}
          </button>
        </div>
      </header>
      {directoryError && <div role="alert" className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 flex items-center justify-between gap-3">
        <span>{directoryError}</span>
        <button type="button" onClick={() => void fetchDirectory(true, true)} className="shrink-0 underline font-bold">Retry connection</button>
      </div>}

      {/* MAIN 2-PANE WORKSPACE */}
      <main className="flex flex-1 overflow-hidden relative">
        
        {/* PANE 1: UNIFIED LEFT SIDEBAR */}
        {isMobileNavOpen && (
          <div className="absolute inset-0 bg-slate-900/20 z-30 lg:hidden" onClick={() => setIsMobileNavOpen(false)} />
        )}
        <aside className={`absolute lg:relative inset-y-0 left-0 z-40 h-full w-[85%] sm:w-[320px] bg-[#FBFBFC] border-r border-slate-200 flex flex-col shrink-0 shadow-2xl lg:shadow-none transition-transform duration-300 ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          <div className="px-4 py-4 border-b border-slate-100 flex flex-col gap-3 shrink-0 bg-white">
            <div className="flex items-center justify-between flex-wrap gap-2">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Workspace Actions</span>
               <div className="flex gap-2">
                 <button onClick={handleSelectAllToggle} className="text-[10px] font-bold text-slate-600 hover:text-slate-900 uppercase tracking-widest bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded transition-colors">
                   {isAllSelected ? 'Deselect All' : 'Select All'}
                 </button>
                 <button onClick={() => { setActiveFolderId(rootFolderId); setSelectedFile(null); setSelectedItems(new Set()); }} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-widest bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded transition-colors">
                   Root Dir
                 </button>
               </div>
            </div>

            {isUploading && uploadBatch && (
              <div className="text-[10px] font-bold text-slate-500 mt-2">Completed {uploadBatch.completed} of {uploadBatch.total} files · {uploadProgress.length} in progress</div>
            )}
            {isUploading && uploadProgress.map(progress => (
              <div key={progress.current} className="flex flex-col mt-2 mb-3 bg-white p-3.5 rounded-2xl border border-indigo-100 shadow-sm animate-in fade-in">
                <div className="flex justify-between items-end mb-2 px-1">
                  <div className="flex flex-col min-w-0 pr-4">
                    <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest flex items-center gap-2">
                      {progress.phase === 'analyzing' ? 'Reading expiry & saving' : 'Uploading'} ({progress.current}/{progress.total})
                    </span>
                    <span className="text-xs font-bold text-slate-600 truncate mt-0.5">
                      {progress.filename}
                    </span>
                  </div>
                  <span className="text-xl font-black text-indigo-600 shrink-0 tabular-nums">
                    {progress.phase === 'analyzing' ? <span className="block w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> : `${Math.round(progress.progressPct)}%`}
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner relative border border-slate-200">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-all duration-300 ease-out relative" style={{ width: `${progress.progressPct}%` }}>
                    <div className="absolute inset-0 bg-white/20" style={{ backgroundImage: 'linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent)', backgroundSize: '1rem 1rem' }}></div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] font-medium text-indigo-700" aria-live="polite">
                  {progress.phase === 'uploading'
                    ? progress.remainingMs === null ? 'Estimating transfer time…' : `About ${approximateDuration(progress.remainingMs + progress.analysisEstimateMs)} remaining for this file`
                    : progress.remainingMs && progress.remainingMs > 0 ? `About ${approximateDuration(progress.remainingMs)} remaining · ${approximateDuration(progress.elapsedMs)} elapsed` : `Taking longer than estimated · ${approximateDuration(progress.elapsedMs)} elapsed`}
                </p>
                <p className="mt-1 text-[10px] text-slate-400">
                  {progress.estimateBasedOnHistory ? 'Estimate uses recent processing times; completion time may vary.' : 'Rough processing estimate; completion time may vary.'}
                </p>
              </div>
            ))}
            
            {selectedItems.size > 0 ? (
              <button onClick={handleBulkDelete} disabled={isLoading || isUploading || isProcessing || isSavingReminder || isReanalyzing || isDeletingSource} className="text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-2 rounded-lg transition-colors flex items-center gap-1 shadow-sm w-full justify-center disabled:opacity-50">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> Delete Selected ({selectedItems.size})
              </button>
            ) : (
              <div className="flex gap-2 w-full">
                <button onClick={() => setIsNewFolderModalOpen(true)} className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg> Folder
                </button>
                <button onClick={() => fileInputRef.current?.click()} disabled={isUploading || isProcessing} className="flex-1 bg-indigo-600 text-white hover:bg-indigo-700 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg> Upload
                </button>
              </div>
            )}

            <div className="relative w-full flex bg-slate-100 rounded-lg overflow-hidden border border-transparent focus-within:border-indigo-300 focus-within:bg-white transition-all shadow-inner mt-2">
              <div className="pl-3 flex items-center shrink-0">
                <svg className="w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
              <input 
                value={localQuery} 
                onChange={e => setLocalQuery(e.target.value)} 
                placeholder="Filter files locally..." 
                className="w-full bg-transparent text-xs px-2 py-2 outline-none placeholder:text-slate-400 font-bold text-slate-700" 
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {isLoading ? (
              <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>
            ) : localQuery.trim() ? (
              <div className="px-2 space-y-1">
                {activeFiles.length === 0 ? (
                  <p className="text-center text-xs font-bold text-slate-400 py-10">No matching files locally.</p>
                ) : (
                  activeFiles.map(file => (
                    <div 
                      key={file.id}
                      role="button" tabIndex={0} aria-label={`Open ${file.name}`}
                      onPointerEnter={() => beginPreviewIntent(file)} onPointerLeave={endPreviewIntent}
                      onFocus={() => beginPreviewIntent(file, true)} onBlur={endPreviewIntent}
                      onPointerDown={() => beginPreviewIntent(file, true)}
                      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedFile(file); setIsEditingReminder(false); if (window.innerWidth < 1024) setIsMobileNavOpen(false); } }}
                      onClick={() => { setSelectedFile(file); if (window.innerWidth < 1024) setIsMobileNavOpen(false); }}
                      className={`flex items-center w-full px-2 py-1.5 cursor-pointer text-sm rounded-lg transition-colors border-l-2 ${selectedFile?.id === file.id ? 'bg-indigo-50 border-indigo-500 shadow-sm' : 'border-transparent hover:bg-slate-100'}`}
                    >
                      <div onClick={(e) => toggleSelection(file.id, e, false)} className={`w-4 h-4 mr-3 border rounded flex items-center justify-center shrink-0 transition-colors ${selectedItems.has(file.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white'}`}>
                        {selectedItems.has(file.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
                      </div>
                      <div className="mr-3 shrink-0">{getFileIcon(file.mimeType)}</div>
                      <span className={`truncate flex-1 ${selectedFile?.id === file.id ? 'font-bold text-indigo-900' : 'font-medium text-slate-600'}`}>{file.name}</span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="px-2">
                {rootFolderId && renderTree(rootFolderId, 0)}
              </div>
            )}
          </div>

          <div className="p-5 shrink-0 border-t border-slate-200/60 bg-white">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
              <div className="flex-1">
                <div className="flex justify-between items-end mb-1">
                  <p className="text-[11px] font-black text-slate-700">Storage Sync</p>
                  <p className="text-[10px] font-bold text-slate-500">
                    {storageData && Number(storageData.limit) > 0 
                      ? `${formatBytes(storageData.usage)} / ${formatBytes(storageData.limit)}` 
                      : storageData ? `${formatBytes(storageData.usage)} Used` : 'Syncing...'}
                  </p>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden shadow-inner">
                  <div 
                    className="bg-indigo-500 h-full rounded-full transition-all duration-700 ease-out" 
                    style={{ 
                      width: storageData && Number(storageData.limit) > 0 
                        ? `${Math.min((Number(storageData.usage) / Number(storageData.limit)) * 100, 100)}%` 
                        : '100%' 
                    }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* PANE 2: DOCUMENT PREVIEW & DASHBOARD */}
        <section 
          ref={rightPaneRef} 
          className="w-full lg:w-auto h-full flex-1 bg-white lg:rounded-tl-[32px] lg:border-t lg:border-l border-slate-200 lg:shadow-[-4px_4px_24px_rgba(0,0,0,0.02)] flex flex-col z-20 lg:z-auto"
        >
          <div className="lg:hidden p-4 bg-white border-b border-slate-200 flex items-center shrink-0">
            <button onClick={() => setIsMobileNavOpen(true)} className="flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-indigo-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              Back to Directory
            </button>
          </div>         
          
          {aiAnswer && (
           <div 
              style={selectedFile ? { height: `${aiPanelHeight}px` } : {}}
              className={`flex flex-col ${selectedFile ? 'shrink-0 bg-slate-50/40' : 'flex-1 min-h-0'}`}
            >
              <div className={`flex-1 overflow-y-auto ${selectedFile ? 'p-4 lg:p-6' : 'p-4 lg:p-8'}`}>
                <div className={`bg-white border border-indigo-100 rounded-2xl shadow-sm relative animate-in fade-in slide-in-from-top-4 ${selectedFile ? 'p-5 min-h-full' : 'p-6'}`}>
                  <button onClick={() => setAiAnswer(null)} className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-700 bg-white border border-slate-200 rounded-md shadow-sm transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full"></span>
                    <span className="text-[11px] font-black uppercase tracking-widest text-indigo-700">
                      GEMINI {selectedModel.includes('3.6') ? '3.6 FLASH' : '3.5 FLASH-LITE'} ANSWER
                    </span>
                  </div>
                  <div className="text-sm font-medium text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {renderFormattedText(aiAnswer)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {aiAnswer && selectedFile && (
            <div 
              onMouseDown={startResizing}
              className="h-3 w-full bg-slate-100 hover:bg-indigo-100 border-y border-slate-200 cursor-row-resize flex items-center justify-center shrink-0 z-30 transition-colors group"
              title="Drag to resize panels"
            >
              <div className="w-12 h-1 bg-slate-300 group-hover:bg-indigo-400 rounded-full pointer-events-none transition-colors"></div>
            </div>
          )}

          {selectedFile ? (
            <div className="flex-1 flex flex-col min-h-0 relative bg-white">
              <div className="px-6 py-3 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                <span className="text-sm font-bold text-slate-800 truncate pr-4">{selectedFile.name}</span>
                <a 
                  href={`https://drive.google.com/uc?export=download&id=${encodeURIComponent(selectedFile.id)}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shrink-0 shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>
              </div>

              {/* PHASE 7: NEW EXPIRY DASHBOARD WIDGET */}
              <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
                <div className="flex justify-between items-start flex-wrap gap-4">
                  <div>
                    <h2 className="text-sm font-black text-slate-900">
                      {selectedFile.documentType || 'Document'} {selectedFile.documentNumber ? `#${selectedFile.documentNumber}` : ''}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      {renderStatusBadge(selectedFile.reminderDisabled ? undefined : selectedFile.expiryStatus, selectedFile.reminder?.status !== 'FULFILLED')}
                      
                      {selectedFile.expiryDate && (
                        <span className="text-xs font-medium text-slate-600">
                          Expires: <span className="font-bold">{displayDate(selectedFile.expiryDate)}</span>
                          {!selectedFile.reminderDisabled && selectedDaysRemaining !== null && (
                            <span className={`ml-2 ${selectedDaysRemaining < 30 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                              ({expiryCountdownText(selectedDaysRemaining)})
                            </span>
                          )}
                        </span>
                      )}
                      
                      {selectedFile.expiryDetectionMethod === 'MANUAL' && (
                        <span className="text-[10px] font-bold text-indigo-600 border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 rounded ml-1 uppercase tracking-wider">
                          Verified ✓
                        </span>
                      )}
                    </div>
                    {selectedFile.expiryDateText && <p className="text-xs font-medium text-slate-500 mt-2 max-w-lg">Detected on document: {selectedFile.expiryDateText}</p>}
                    {selectedFile.reminder && (
                      <p className="text-xs font-medium text-indigo-700 mt-2">
                        Reminder: {selectedFile.reminder.reminderValue ?? selectedFile.reminder.reminderDays} {selectedFile.reminder.reminderUnit || 'days'} before expiry
                        {selectedFile.reminder.status === 'FULFILLED' ? ' · Inactive' : ` · ${displayDate(selectedFile.reminder.triggerDate)}${selectedFile.reminder.isTriggered ? ' · Due now' : ''}`}
                      </p>
                    )}
                    {(selectedFile.reminderWarning || (!selectedFile.reminder && (!selectedFile.expiryDate || selectedFile.expiryStatus === 'NEEDS_REVIEW'))) && (
                      <p className="text-xs font-medium text-amber-700 mt-2 max-w-lg">{selectedFile.reminderWarning || 'No reminder is scheduled. Re-analyze the document to detect a trusted expiry date.'}</p>
                    )}
                  </div>
                  
                  {/* PHASE 8: MANUAL ACTIONS */}
                  <div className="flex gap-2 flex-wrap">
                    {isEditingReminder ? (
                      <div className="flex gap-3 flex-wrap items-end bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
                        <div className="flex flex-col gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Detected expiry
                          <span className="px-2 py-2 text-xs font-bold text-slate-800">{selectedFile.expiryDate ? displayDate(selectedFile.expiryDate) : 'Not detected'}</span>
                        </div>
                        <ReminderLeadTimeInput value={manualReminderValue} unit={manualReminderUnit} disabled={isSavingReminder || !canScheduleReminder(selectedFile)} onChange={(value, unit) => { setManualReminderValue(value); setManualReminderUnit(unit); }} />
                        <button onClick={handleSaveSelectedReminder} disabled={isSavingReminder || !canScheduleReminder(selectedFile)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 text-xs font-bold rounded transition-colors disabled:opacity-50">{isSavingReminder ? 'Saving...' : 'Save'}</button>
                        <button onClick={() => setIsEditingReminder(false)} disabled={isSavingReminder} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-xs font-bold rounded transition-colors">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => {
                          setManualReminderValue(selectedFile.reminder ? String(selectedFile.reminder.reminderValue ?? selectedFile.reminder.reminderDays) : '');
                          setManualReminderUnit(selectedFile.reminder?.reminderUnit || 'days');
                          setIsEditingReminder(true);
                        }} disabled={!canScheduleReminder(selectedFile) || isReanalyzing || isProcessing || isUploading || isDeletingSource} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-bold shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
                          Edit Reminder
                        </button>
                        <button onClick={() => handleReanalyze()} disabled={isReanalyzing || isSavingReminder || isProcessing || isUploading || isDeletingSource} className="px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded-lg text-xs font-bold shadow-sm hover:bg-indigo-50 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                          {isReanalyzing ? (
                             <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          )}
                          Re-analyze
                        </button>
                        {selectedFile.documentId !== undefined && canScheduleReminder(selectedFile) && (
                          <button type="button" onClick={() => requestDocumentReplacement(selectedFile)} disabled={isUploading || isProcessing || isSavingReminder || isReanalyzing || isDeletingSource} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow-sm hover:bg-indigo-700 transition-colors disabled:opacity-50">
                            Replace Document
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 bg-white flex flex-col w-full">
                <div className="flex-1 min-h-0 w-full flex flex-col">
                  <div className="flex-1 bg-white overflow-hidden flex flex-col min-h-0">
                    <DocumentPreview apiBaseUrl={API_BASE_URL} company={selectedCompany} username={loginUsername} documentId={selectedFile.documentId} driveFileId={selectedFile.id} sourceName={selectedFile.name} sourceVersion={previewVersion(selectedFile)} externalUrl={selectedFile.webViewLink} />
                  </div>
                </div>
              </div>
            </div>
          ) : !aiAnswer ? (
            <div className="flex-1 flex flex-col items-center justify-center px-4 bg-white">
              <div className="w-24 h-24 mb-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-center shadow-inner">
                <svg className="w-12 h-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">Select a document</h3>
              <p className="text-sm font-medium text-slate-400 mt-2 text-center max-w-xs">Choose a file from the directory tree to preview it securely.</p>
            </div>
          ) : null}
        </section>

      </main>

      {/* --- MODALS --- */}

      {replacementDraft && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[230] flex justify-center items-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="document-replacement-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto p-6">
            <h3 id="document-replacement-title" className="text-lg font-black text-slate-900">Replace Document</h3>
            <p className="text-sm text-slate-700 mt-3 leading-6 break-words">Replace <strong>{replacementDraft.target.name}</strong> with <strong>{replacementDraft.file.name}</strong>?</p>
            <p className="text-sm text-slate-600 mt-3 leading-6">The new file stays in the same folder. Gemini reads its expiry date, which remains read-only. Your current document stays available until the new expiry is verified and saved.</p>
            <p className="text-sm font-semibold text-indigo-700 mt-3 leading-6">
              {replacementDraft.target.reminderDisabled ? 'Reminders will remain disabled for the replacement.' : replacementDraft.target.reminder
                ? `Your reminder of ${replacementDraft.target.reminder.reminderValue ?? replacementDraft.target.reminder.reminderDays} ${replacementDraft.target.reminder.reminderUnit || 'days'} before expiry will use the new expiry date.`
                : 'No reminder will be added automatically. You can choose one after replacement.'}
            </p>
            {replacementProgress && (
              <div role="status" aria-live="polite" className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-sm font-bold text-slate-800">{replacementProgress.phase === 'uploading' ? `Uploading replacement · ${Math.round(replacementProgress.progressPct)}%` : 'Verifying the new expiry and saving replacement…'}</p>
                <div role="progressbar" aria-label="Replacement upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(replacementProgress.progressPct)} className="h-2 rounded-full bg-slate-200 overflow-hidden mt-2"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${replacementProgress.progressPct}%` }} /></div>
                <p className="text-xs font-medium text-slate-600 mt-2">
                  {replacementProgress.remainingMs !== null && replacementProgress.remainingMs > 0 ? `About ${approximateDuration(replacementProgress.remainingMs)} remaining` : replacementProgress.phase === 'analyzing' ? 'Finishing analysis and saving…' : 'Estimating time remaining…'}
                  {replacementProgress.phase === 'analyzing' && !replacementProgress.estimateBasedOnHistory ? ' · Rough estimate' : ''}
                </p>
              </div>
            )}
            {replacementError && <p role="alert" className="text-sm font-medium text-rose-700 mt-4 leading-6">{replacementError}</p>}
            <div className="flex flex-wrap justify-end gap-3 mt-6">
              <button type="button" disabled={isReplacing} onClick={() => { setReplacementDraft(null); setReplacementError(''); }} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
              <button type="button" disabled={isReplacing} onClick={() => void handleReplaceDocument()} className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{isReplacing ? 'Replacing…' : 'Replace Document'}</button>
            </div>
          </div>
        </div>
      )}

      {uploadError && !expiryReviewModal.isOpen && (
        <div role="alert" className="fixed top-20 right-4 z-[160] max-w-md bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 shadow-lg">
          <div className="flex justify-between gap-4 items-start">
            <p className="text-xs whitespace-pre-line">Some files could not be uploaded. Select them again to retry.{`\n${uploadError}`}</p>
            <button onClick={() => setUploadError('')} aria-label="Dismiss upload error" className="font-bold">×</button>
          </div>
        </div>
      )}
      
      {isNewFolderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-base font-black text-slate-800 tracking-tight mb-4">Create New Folder</h3>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input type="text" placeholder="Folder name..." autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-indigo-500 focus:bg-white transition-colors" required />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsNewFolderModalOpen(false)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50" disabled={isCreatingFolder}>Cancel</button>
                <button type="submit" disabled={isCreatingFolder || !newFolderName.trim()} className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white text-sm font-bold shadow-sm">
                  {isCreatingFolder ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-base font-black text-slate-800 tracking-tight mb-4">Rename Document</h3>
            <form onSubmit={handleRename} className="space-y-4">
              <input type="text" placeholder="New name..." autoFocus value={newRenameValue} onChange={(e) => setNewRenameValue(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-amber-500 focus:bg-white transition-colors" required />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setRenameTarget(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50">Cancel</button>
                <button type="submit" className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold shadow-sm">Rename</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI EXPIRY & REMINDER REVIEW MODAL */}
      {expiryReviewModal.isOpen && currentReviewFile && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[200] flex justify-center items-center p-4">
           <form onSubmit={handleSaveReviewReminder} role="dialog" aria-modal="true" aria-labelledby="expiry-review-title" className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-indigo-100 flex justify-between items-center bg-indigo-600 text-white shrink-0">
                 <div>
                    <h3 id="expiry-review-title" className="text-xl font-black uppercase tracking-tight">Review Expiry & Reminder</h3>
                    <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest mt-1">File {reviewFileCount - expiryReviewModal.files.length + 1} of {reviewFileCount}</p>
                 </div>
                 {!expiryReviewModal.isAnalyzing && (
                   <button type="button" disabled={isProcessing || isReanalyzing || isDeletingSource} aria-label="Skip this file without a reminder" title="Close this file without a reminder and continue" onClick={handleSkipReminder} className="p-1.5 bg-black/10 hover:bg-black/20 rounded-full transition-colors disabled:opacity-50">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                   </button>
                 )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50 flex flex-col gap-4">
                 <div className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
                    Choose a reminder for this file, or close without a reminder. The next file appears after your choice. Expiry dates cannot be edited; use the eye icon to view the source.
                 </div>
                 {uploadError && <p role="alert" className="text-xs text-rose-700 whitespace-pre-line">Some uploads failed:{`\n${uploadError}`}</p>}
                 
                 {[currentReviewFile].map(file => (
                    <div key={file.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
                       <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-3">
                            <div className="text-sm font-black uppercase text-slate-900 truncate">{file.name}</div>
                            <button type="button" title="Compare with original document" aria-label={`View source document for ${file.name}`} onPointerEnter={() => beginSourcePreviewIntent(file)} onPointerLeave={endPreviewIntent} onFocus={() => beginSourcePreviewIntent(file, true)} onBlur={endPreviewIntent} onPointerDown={() => beginSourcePreviewIntent(file, true)} onClick={() => handlePreviewSource(file, file.name)} className="shrink-0 p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg"><SourceEyeIcon /></button>
                          </div>
                          {file.hasReminder ? (
                             <div className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded inline-block mt-1 uppercase tracking-wider">
                                Reminder scheduled
                             </div>
                          ) : (
                             <div className={`text-[10px] font-bold px-2 py-1 rounded inline-block mt-1 uppercase tracking-wider ${file.expiryDate && file.expiryStatus !== 'NEEDS_REVIEW' ? 'text-emerald-700 bg-emerald-100' : 'text-amber-700 bg-amber-100'}`}>
                                {file.expiryStatus === 'NEEDS_REVIEW' ? 'Re-analysis needed' : file.expiryDate ? 'Expiry detected' : 'No expiry detected'}
                             </div>
                          )}
                          {(file.expiryDateText || file.expiryEvidence) && <p className="text-xs text-slate-600 mt-2">Detected on document: {file.expiryDateText || file.expiryEvidence}</p>}
                          {file.warning && <p className="text-xs text-amber-700 mt-2">{file.warning}</p>}
                       </div>
                       
                       <div className="flex flex-wrap items-end gap-4 w-full">
                          <div className="flex flex-col gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Detected expiry
                            <span className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-800">{file.expiryDate ? displayDate(file.expiryDate) : 'Not detected'}</span>
                          </div>
                          <ReminderLeadTimeInput value={file.reminderValue} unit={file.reminderUnit} disabled={isProcessing || isReanalyzing || isDeletingSource || !canScheduleReminder(file)} onChange={(value, unit) => setExpiryReviewModal(prev => ({ ...prev, files: prev.files.map(item => item.id === file.id ? { ...item, reminderValue: value, reminderUnit: unit } : item) }))} />
                          {!canScheduleReminder(file) && <button type="button" disabled={isReanalyzing || isProcessing} onClick={() => handleReanalyze(file)} className="px-3 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg disabled:opacity-50">{isReanalyzing ? 'Analyzing...' : 'Re-analyze'}</button>}
                       </div>
                    </div>
                 ))}
                 
                 {reviewError && <p role="alert" className="text-xs font-medium text-rose-700">{reviewError}</p>}
                 <div className="mt-2 pt-4 border-t border-slate-200 flex flex-wrap justify-end gap-3 sticky bottom-0 bg-slate-50 pb-2">
                    <button type="button" disabled={isProcessing || isReanalyzing || isDeletingSource} onClick={handleSkipReminder} className="px-5 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors text-xs shadow-sm disabled:opacity-50">Close Without Reminder</button>
                    <button type="submit" disabled={isProcessing || isReanalyzing || isDeletingSource || !canScheduleReminder(currentReviewFile)} className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-md disabled:opacity-50 text-xs">{isProcessing ? 'Saving...' : 'Save Reminder'}</button>
                 </div>
              </div>
           </form>
        </div>
      )}

      {sourcePreview && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[220] flex justify-center items-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="source-preview-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <h3 id="source-preview-title" className="text-sm font-bold text-slate-800 truncate">{sourcePreview.name}</h3>
              <div className="flex items-center gap-3 shrink-0">
                <a href={sourcePreview.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-indigo-600 hover:underline">Open in Drive</a>
                <button type="button" onClick={handleDeleteSource} disabled={isDeletingSource || isProcessing || isSavingReminder || isReanalyzing || sourcePreview.documentId === undefined && !sourcePreview.driveFileId} className="px-3 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg disabled:opacity-50">{isDeletingSource ? 'Deleting...' : 'Delete'}</button>
                <button type="button" disabled={isDeletingSource} aria-label="Close source preview" onClick={() => setSourcePreview(null)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">×</button>
              </div>
            </div>
            <DocumentPreview apiBaseUrl={API_BASE_URL} company={selectedCompany} username={loginUsername} documentId={sourcePreview.documentId} driveFileId={sourcePreview.driveFileId} sourceName={sourcePreview.name} sourceVersion={sourcePreview.version} externalUrl={sourcePreview.url} />
          </div>
        </div>
      )}

      <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
      <input type="file" ref={replacementInputRef} onChange={handleReplacementFile} accept=".pdf,.docx,.txt,.csv,.json,.html,.htm,.xml,.jpg,.jpeg,.png,.webp,.heic,.heif" aria-label="Choose replacement document" className="hidden" />

      {/* HEADER NOTIFICATION PANEL */}
      <div className="fixed top-20 right-4 lg:right-8 z-[150] flex flex-col items-end">
        {isNotifOpen && (
          <div id="expiry-reminders-panel" role="region" aria-label="Expiry reminders" aria-live="polite" className="w-96 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 p-4 flex justify-between items-center text-white">
              <h3 className="font-black text-sm uppercase tracking-wider">Expiry Reminders</h3>
              <button onClick={() => setIsNotifOpen(false)} className="text-slate-400 hover:text-white"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="max-h-[min(32rem,calc(100dvh-10rem))] overflow-y-auto p-3 bg-slate-50">
              {notificationError && (
                <div role="alert" className="p-3 mb-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg">
                  {notificationError}
                  <button onClick={() => void fetchNotifications(true)} className="block mt-2 font-bold underline">Retry</button>
                </div>
              )}
              <p className="px-2 py-2 text-sm text-slate-600 leading-5">Due reminders appear here while this workspace is open.</p>
              {notifications.length === 0 ? (
                <div className="p-4 text-center text-xs font-bold text-slate-400">No reminders due.</div>
              ) : (
                notifications.map(n => {
                  const daysRemaining = calculateDaysRemaining(n.expiryDate, n.daysRemaining ?? n.expires?.daysRemaining);
                  const replacementTarget = sourceFile(n);
                  return (
                  <div key={n.id} className="p-3 mb-2 rounded-xl border shadow-sm bg-white border-rose-200">
                    <div className="flex justify-between items-start mb-1.5">
                       <div className="text-sm font-extrabold text-slate-900 pr-2 leading-5 flex-1">{n.title || n.fileName || 'Expiry reminder'}</div>
                       <button type="button" title="View source document" aria-label={`View source document for ${n.fileName}`} onPointerEnter={() => beginSourcePreviewIntent(n)} onPointerLeave={endPreviewIntent} onFocus={() => beginSourcePreviewIntent(n, true)} onBlur={endPreviewIntent} onPointerDown={() => beginSourcePreviewIntent(n, true)} onClick={() => handlePreviewSource(n, n.fileName)} className="shrink-0 p-1 text-indigo-600 hover:bg-indigo-50 rounded mr-1"><SourceEyeIcon /></button>
                       <span className="text-[9px] font-bold text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0 animate-pulse">Active</span>
                    </div>
                    {n.message && <div className="text-sm font-semibold text-slate-900 leading-6 mb-2 break-words">{n.message}</div>}
                    <div className="text-sm font-semibold text-slate-800 leading-6 mb-2">Expires: {displayDate(n.expiryDate)} · {n.reminderValue ?? n.reminderDays} {n.reminderUnit || 'days'} before</div>
                    {daysRemaining !== null && <div className={`text-sm font-bold mb-2 ${daysRemaining <= 0 ? 'text-rose-700' : 'text-indigo-700'}`}>{expiryCountdownText(daysRemaining)}</div>}
                    
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => handleUpdateNotif(n.id, 'FULFILLED')} disabled={isUploading || isProcessing || isSavingReminder || isReanalyzing || isDeletingSource} className="flex-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50">Mark Handled</button>
                      {replacementTarget?.documentId !== undefined && canScheduleReminder(replacementTarget) && <button type="button" disabled={isUploading || isProcessing || isSavingReminder || isReanalyzing || isDeletingSource} onClick={() => requestDocumentReplacement(replacementTarget)} className="flex-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50">Replace Document</button>}
                    </div>
                  </div>
                ); })
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
