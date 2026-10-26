import * as XLSX from "xlsx";
import { DataTable, Notice, Panel } from "./shared";
import { secondary, usePhase3Data } from "./api";
import type { JsonRow } from "./api";
import { ReportMoney } from "./FinancialReports";

type Reconciliation = {
  company: string;
  generatedAt: string;
  ledgerAsOf: string;
  note: string;
  comparisonAvailable: boolean;
  inventoryAccounts: string[];
  issues: {
    invalidCosts: number;
    zeroCosts: number;
    negativeQuantities: number;
  };
  rows: JsonRow[];
  totals: Record<string, string | null>;
};
export default function InventoryReconciliation({
  api,
  company,
}: {
  api: string;
  company: string;
}) {
  const state = usePhase3Data<Reconciliation>(
    api,
    company,
    "/books/inventory-reconciliation",
  );
  const data = !state.loading && !state.error ? state.data : null;
  function download() {
    if (!data) return;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(data.rows),
      "Stock references",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        Object.entries({
          company: data.company,
          generatedAt: data.generatedAt,
          ledgerAsOf: data.ledgerAsOf,
          inventoryAccounts: data.inventoryAccounts.join(", "),
          comparisonAvailable: data.comparisonAvailable,
          ...data.issues,
          ...data.totals,
          note: data.note,
        }).map(([field, value]) => ({ field, value })),
      ),
      "Scope and totals",
    );
    XLSX.writeFile(
      workbook,
      `inventory_reconciliation_${data.ledgerAsOf}.xlsx`,
    );
  }
  return (
    <Panel
      title="Inventory reference vs posted ledger"
      actions={
        <div className="flex gap-2">
          <button
            className={secondary}
            disabled={state.loading}
            onClick={state.refresh}
          >
            Refresh snapshot
          </button>
          <button className={secondary} disabled={!data} onClick={download}>
            Export reconciliation
          </button>
        </div>
      }
    >
      <Notice {...state} />
      {data && (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Current physical snapshot · Ledger through {data.ledgerAsOf}{" "}
            (Asia/Manila) · Controls {data.inventoryAccounts.join(", ")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(data.totals).map(([label, value]) => (
              <div key={label} className="phase3-metric">
                <p className="phase3-metric-label">
                  {(
                    {
                      officeReference: "Office reference value",
                      warehouseReference: "Warehouse reference value",
                      knownCombinedReference: "Combined known reference value",
                      inventoryLedger: "Posted Inventory ledger",
                      difference: "Reference vs ledger difference",
                    } as Record<string, string>
                  )[label] ?? label}
                </p>
                <p className="phase3-metric-value">
                  <ReportMoney value={value} />
                </p>
              </div>
            ))}
          </div>
          {(!data.comparisonAvailable || data.issues.zeroCosts > 0) && (
            <p
              role="alert"
              className="my-4 rounded bg-amber-50 p-3 text-amber-900"
            >
              Finance review needed: {data.issues.invalidCosts} missing/invalid
              cost references, {data.issues.zeroCosts} zero cost references and{" "}
              {data.issues.negativeQuantities} negative physical balances.
              Unknown values are excluded from known totals and cannot be
              treated as zero.
            </p>
          )}
          <p className="my-4 text-sm text-slate-600">{data.note}</p>
          <DataTable
            rows={data.rows}
            columns={[
              "sku",
              "productName",
              "officeQuantity",
              "warehouseQuantity",
              "unitCost",
              "costBasis",
              "officeValue",
              "warehouseValue",
              "referenceValue",
              "issue",
            ]}
            searchLabel="Search inventory reconciliation"
          />
          <p className="mt-4 text-xs text-slate-500">
            Review receipt/bill timing, approved opening balances and cost
            evidence before using Accounts & journals to post a
            Finance-authorized correction. This report never posts an
            adjustment.
          </p>
        </>
      )}
    </Panel>
  );
}
