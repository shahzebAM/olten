import type { ErpUser, Phase3View } from '../lib/phase3Access';
import {
  canManageLedgerAccounts,
  hasPhase3Access,
  phase3Scope,
} from '../lib/phase3Access';
import FinanceWorkspace from './phase3/FinanceWorkspace';
import BooksWorkspace from './phase3/BooksWorkspace';
import {
  AiWorkspace,
  ExecutiveWorkspace,
  ServiceWorkspace,
} from './phase3/InsightsWorkspace';
import { secondary } from './phase3/api';
import './phase3/workspace.css';

const titles: Record<Phase3View, string> = {
  finance: 'Landed Cost, Invoicing & Finance',
  books: 'Books & Reconciliation',
  service: 'Medical Device Service',
  executive: 'Executive Dashboard & Reports',
  ai_assistant: 'Executive AI & Invoice OCR',
};
const descriptions: Record<Phase3View, string> = {
  finance: 'Manage shipment costs, customer billing and supplier payments.',
  books: 'Review accounts, journal entries and bank reconciliation in one place.',
  service: 'Keep delivered devices, warranties and service schedules connected.',
  executive: 'See your company’s current position and explore source reports.',
  ai_assistant: 'Explore company records and review information from invoices.',
};
export default function Phase3Module({
  selectedCompany,
  API_BASE_URL,
  currentUser,
  view,
  onBack,
  initialDeliveryId,
  onOpenFinance,
}: {
  selectedCompany: string;
  API_BASE_URL: string;
  currentUser?: ErpUser;
  view: Phase3View;
  onBack: () => void;
  initialDeliveryId?: string;
  onOpenFinance?: () => void;
}) {
  const allowed =
    hasPhase3Access(currentUser, selectedCompany, phase3Scope(view)) ||
    (view === 'finance' &&
      hasPhase3Access(currentUser, selectedCompany, 'landed'));
  return (
    <div className="phase3-workspace min-h-screen bg-slate-50 text-slate-900">
      <header className="phase3-header border-b border-slate-200 bg-white px-5 py-6 sm:px-10">
        <button
          className="phase3-back mb-3 text-sm font-semibold text-cyan-700"
          onClick={onBack}
        >
          ← Workspace
        </button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="phase3-eyebrow">
              {selectedCompany} / {view === 'books' ? 'Accounting' : view === 'executive' ? 'Business overview' : 'Operations'}
            </p>
            <h1 className="text-2xl font-bold">{titles[view]}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              {descriptions[view]}
            </p>
          </div>
          {currentUser?.modules?.erpRoles?.includes('Auditor') && (
            <span className={`${secondary} phase3-readonly`}>
              Auditor · read only
            </span>
          )}
        </div>
      </header>
      <main className="phase3-main mx-auto max-w-[1600px] space-y-5 p-5 sm:p-8">
        {!allowed ? (
          <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-800">
            Your account does not have access to this module.
          </p>
        ) : view === 'finance' ? (
          <FinanceWorkspace
            api={API_BASE_URL}
            company={selectedCompany}
            user={currentUser}
            initialDeliveryId={initialDeliveryId}
          />
        ) : view === 'books' ? (
          <BooksWorkspace
            api={API_BASE_URL}
            company={selectedCompany}
            canReconcileInventory={hasPhase3Access(currentUser, selectedCompany, 'finance')}
            canManageAccounts={canManageLedgerAccounts(
              currentUser,
              selectedCompany,
            )}
            canWrite={hasPhase3Access(
              currentUser,
              selectedCompany,
              'books',
              true,
            )}
          />
        ) : view === 'service' ? (
          <ServiceWorkspace
            api={API_BASE_URL}
            company={selectedCompany}
            canWrite={hasPhase3Access(
              currentUser,
              selectedCompany,
              'service',
              true,
            )}
          />
        ) : view === 'executive' ? (
          <ExecutiveWorkspace api={API_BASE_URL} company={selectedCompany} canReadBooks={hasPhase3Access(currentUser, selectedCompany, 'books')} />
        ) : (
          <AiWorkspace
            api={API_BASE_URL}
            company={selectedCompany}
            user={currentUser}
            onOpenFinance={onOpenFinance}
          />
        )}
      </main>
    </div>
  );
}
