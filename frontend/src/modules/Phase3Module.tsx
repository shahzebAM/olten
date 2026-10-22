import type { ErpUser, Phase3View } from '../lib/phase3Access';
import { hasPhase3Access, phase3Scope } from '../lib/phase3Access';
import FinanceWorkspace from './phase3/FinanceWorkspace';
import BooksWorkspace from './phase3/BooksWorkspace';
import {
  AiWorkspace,
  ExecutiveWorkspace,
  ServiceWorkspace,
} from './phase3/InsightsWorkspace';
import { secondary } from './phase3/api';

const titles: Record<Phase3View, string> = {
  finance: 'Landed Cost, Invoicing & Finance',
  books: 'Books & Reconciliation',
  service: 'Medical Device Service',
  executive: 'Executive Dashboard & Reports',
  ai_assistant: 'Executive AI & Invoice OCR',
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-5 py-6 sm:px-10">
        <button
          className="mb-3 text-sm font-semibold text-cyan-700"
          onClick={onBack}
        >
          ← Workspace
        </button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{titles[view]}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {selectedCompany} · Company and role scoped workspace
            </p>
          </div>
          {currentUser?.modules?.erpRoles?.includes('Auditor') && (
            <span className={secondary}>Auditor · read only</span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-5 p-5 sm:p-8">
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
          <ExecutiveWorkspace api={API_BASE_URL} company={selectedCompany} />
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
