import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

// --- INTERFACES ---
interface Product { id: number; company: string; name: string; sku: string; category: string; purchasePrice: number; sellingPrice: number; minQuantity: number; reorderLevel: number; unit: string; isActive: boolean; vatSetting: string; imageUrl: string; barcode: string; currentStock: number; createdAt: string; deletedAt: string | null; }
interface Movement { id: string; productId: number; productName: string; sku: string; type: 'RECEIVE' | 'ISSUE' | 'ADJUST' | 'RETURN' | 'TRANSFER' | 'DELETE'; quantity: number; previousStock: number; newStock: number; reference: string; remarks: string; date: string; user: string; warehouseId?: string; batchNumber?: string | null; expirationDate?: string | null; warehouse?: { id: number; name: string; }; employee?: { firstName: string; lastName: string; }; }
interface Warehouse { id: string; name: string; address: string; status: string; }
interface WarehouseStock { id: string; warehouseId: string; productId: number; sku: string; quantity: number; }

// --- PERSISTENT CACHE & VAULT ---
let globalImageVault: Record<string, string> = {}; 
let currentValidImages: Record<string, string> = {};

export default function MasterInventory({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  
  const isAuthorizedAdmin = loginUsername?.toLowerCase() === 'admin' || loginUsername?.toLowerCase() === 'ali' || loginUsername?.toLowerCase() === 'super admin';

  const [activeView, setActiveView] = useState<'products' | 'movements' | 'warehouses'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [hubStock, setHubStock] = useState<WarehouseStock[]>([]);
  
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [ledgerFilterType, setLedgerFilterType] = useState('ALL');
  const [ledgerStartDate, setLedgerStartDate] = useState('');
  const [ledgerEndDate, setLedgerEndDate] = useState('');

  const [productModal, setProductModal] = useState<{ isOpen: boolean; editingId: number | null }>({ isOpen: false, editingId: null });
  const [txModal, setTxModal] = useState<{ isOpen: boolean; products: Product[]; type: 'RECEIVE' | 'ISSUE' | 'ADJUST' | 'RETURN' | 'TRANSFER' }>({ isOpen: false, products: [], type: 'RECEIVE' });

  const initialProductForm: any = { name: '', sku: '', category: 'General', purchasePrice: 0, sellingPrice: 0, minQuantity: 10, reorderLevel: 20, unit: 'pcs', isActive: true, vatSetting: 'Vatable', imageUrl: '', barcode: '', previousImageUrl: '', initialQuantity: 0, warehouseId: '', batchNumber: '', expirationDate: '' };
  const [productForm, setProductForm] = useState(initialProductForm);
  const [txForm, setTxForm] = useState({ reference: '', remarks: '', batchNumber: '', expirationDate: '' });
  
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [adjustQty, setAdjustQty] = useState<number | ''>('');
  const [transferForm, setTransferForm] = useState({ source: '', destination: '', quantity: '' });

  const [bulkForm, setBulkForm] = useState({ warehouseId: '', sourceId: '', destId: '' });
  const [bulkQtys, setBulkQtys] = useState<Record<number, string>>({});
  
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);
  const [warehouseForm, setWarehouseForm] = useState({ name: '', address: '', status: 'Active' });

  const [directStockForm, setDirectStockForm] = useState({ warehouseId: '', productId: '', quantity: '' });
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const updateImageVault = (data: Product[]) => {
    data.forEach(p => {
      if (!p.sku) return;
      const current = currentValidImages[p.sku];
      if ((!p.imageUrl || !p.imageUrl.startsWith('data:image')) && current) globalImageVault[p.sku] = current;
      else if (p.imageUrl && p.imageUrl.startsWith('data:image')) {
        if (current && current !== p.imageUrl) globalImageVault[p.sku] = current;
        currentValidImages[p.sku] = p.imageUrl;
      }
    });
  };

  const fetchAllData = async () => {
    try {
      const [prodRes, movRes, whRes, stkRes] = await Promise.all([
        fetch(`${API_BASE_URL}/products?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/inventory-movements?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/warehouses?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/warehouse-stock?company=${selectedCompany}`)
      ]);
      if (prodRes.ok) { const p = await prodRes.json(); updateImageVault(p); setProducts(p); }
      if (movRes.ok) setMovements(await movRes.json());
      if (whRes.ok) setWarehouses(await whRes.json());
      if (stkRes.ok) setHubStock(await stkRes.json());
    } catch (e) { console.error("API Error", e); }
  };

  useEffect(() => { fetchAllData(); }, [selectedCompany]);

  const toggleSelection = (id: number) => setSelectedProductIds((prev: number[]) => prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]);
  const toggleSelectAll = (filtered: Product[]) => {
    if (selectedProductIds.length === filtered.length) setSelectedProductIds([]);
    else setSelectedProductIds(filtered.map(p => p.id));
  };

  const openSingleTx = (product: Product, type: any) => {
    setTxModal({ isOpen: true, products: [product], type });
    setAllocations({}); setTxForm({ reference: '', remarks: '', batchNumber: '', expirationDate: '' });
    setTransferForm({ source: '', destination: '', quantity: '' });
  };

  const openBulkTx = (type: any) => {
    const prods = products.filter(p => selectedProductIds.includes(p.id));
    setTxModal({ isOpen: true, products: prods, type });
    setBulkForm({ warehouseId: '', sourceId: '', destId: '' });
    setBulkQtys({}); setTxForm({ reference: '', remarks: '', batchNumber: '', expirationDate: '' });
  };

  const handleModalImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const rawBase64 = reader.result as string;
      setProductForm((prev: any) => ({
        ...prev,
        previousImageUrl: prev.imageUrl ? prev.imageUrl : (prev.previousImageUrl || ''),
        imageUrl: rawBase64
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    const { previousImageUrl, ...cleanFormData } = productForm;
    const finalData = { ...cleanFormData, company: selectedCompany, barcode: cleanFormData.barcode || cleanFormData.sku.toUpperCase(), username: loginUsername };

    const tempId = productModal.editingId || Date.now();
    setProducts((prev: Product[]) => {
      if (productModal.editingId) return prev.map(p => p.id === tempId ? { ...p, ...finalData } as Product : p);
      return [{ ...finalData, id: tempId, currentStock: finalData.initialQuantity || 0 } as Product, ...prev];
    });
    setProductModal({ isOpen: false, editingId: null });
    setProductForm(initialProductForm);
    showToast("Saving to database...", "success");

    Promise.resolve().then(async () => {
      try {
        const url = productModal.editingId ? `${API_BASE_URL}/products/${productModal.editingId}` : `${API_BASE_URL}/products`;
        const res = await fetch(url, { method: productModal.editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalData) });
        if (!res.ok) throw new Error("Database rejected payload.");
        fetchAllData(); 
      } catch (error) { 
        showToast("Sync Error. Request rejected by server.", "error"); 
        fetchAllData(); 
      }
    }).finally(() => setIsProcessing(false));
  };

  const handleBulkDelete = () => {
    if (!window.confirm(`Permanently delete ${selectedProductIds.length} items?`)) return;
    const prodsToDelete = products.filter(p => selectedProductIds.includes(p.id));
    
    setProducts((prev: Product[]) => prev.filter(p => !selectedProductIds.includes(p.id)));
    
    Promise.all(selectedProductIds.map(id => fetch(`${API_BASE_URL}/products/${id}`, { method: 'DELETE' })))
      .then(() => {
        showToast("Products deleted silently.", "success");
        setSelectedProductIds([]);
        fetchAllData();
      })
      .catch(() => showToast("Sync Error.", "error"));
  };

  const handleProductDelete = (id: number) => {
    if (!window.confirm("Permanently delete this product?")) return;
    setProducts((prev: Product[]) => prev.filter(p => p.id !== id));
    setSelectedProductIds((prev: number[]) => prev.filter(pid => pid !== id));
    showToast("Product deleted silently.", "success");
    
    fetch(`${API_BASE_URL}/products/${id}`, { method: 'DELETE' }).then(() => {
      fetchAllData();
    }).catch(() => { showToast("Sync Error.", "error"); fetchAllData(); });
  };

  const processDirectWarehouseAdjustment = async (warehouseId: string, prod: Product, deltaQty: number, remarks: string) => {
    setIsProcessing(true);
    const isAdd = deltaQty > 0;
    const absQty = Math.abs(deltaQty);

    const currentHubStock = hubStock.find(h => String(h.warehouseId) === String(warehouseId) && Number(h.productId) === Number(prod.id))?.quantity || 0;
    if (!isAdd && currentHubStock < absQty) {
      setIsProcessing(false); return showToast("Insufficient stock in this specific warehouse.", "error");
    }

    setHubStock((prev: WarehouseStock[]) => {
      const next = [...prev];
      const idx = next.findIndex(h => String(h.warehouseId) === String(warehouseId) && Number(h.productId) === Number(prod.id));
      if (idx > -1) next[idx].quantity += deltaQty;
      else if (isAdd) next.push({ id: 'temp', warehouseId: warehouseId, productId: prod.id, sku: prod.sku, quantity: deltaQty });
      return next;
    });

    try {
      await Promise.all([
        fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: warehouseId, productId: prod.id, sku: prod.sku, quantity: deltaQty }) }),
        // FORCE THE TYPE TO 'ADJUST' IN THE LEDGER
        fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: 'ADJUST', quantity: absQty, previousStock: currentHubStock, newStock: currentHubStock + deltaQty, reference: 'Direct Hub Adjustment', remarks: remarks, user: loginUsername, company: selectedCompany, warehouseId: warehouseId }) })
      ]);
      showToast("Warehouse stock successfully adjusted.", "success");
      fetchAllData();
    } catch (e) {
      showToast("Failed to adjust warehouse stock.", "error");
      fetchAllData();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDirectStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directStockForm.warehouseId || !directStockForm.productId || !directStockForm.quantity || directStockForm.quantity === '0') {
      return showToast("Please enter a valid non-zero quantity.", "error");
    }
    const prod = products.find(p => String(p.id) === String(directStockForm.productId));
    if (!prod) return showToast("Selected product not found.", "error");
    
    await processDirectWarehouseAdjustment(directStockForm.warehouseId, prod, Number(directStockForm.quantity), 'Adjusted via Warehouse module');
    setDirectStockForm({ warehouseId: '', productId: '', quantity: '' });
    setProductSearchTerm('');
  };

  const handleEditWarehouseStock = async (warehouseId: string, product: Product, currentQty: number) => {
    const input = window.prompt(`Adjust stock for [${product.sku}] ${product.name}\nCurrent quantity: ${currentQty}\n\nEnter the NEW TOTAL quantity for this facility:`, String(currentQty));
    if (input === null || input.trim() === '') return;
    
    const newQty = Number(input);
    if (isNaN(newQty) || newQty < 0) return showToast("Enter a valid positive number or 0.", "error");
    
    const delta = newQty - currentQty;
    if (delta === 0) return;
    await processDirectWarehouseAdjustment(warehouseId, product, delta, 'Inline Stock Revision');
  };

  const handleDeleteWarehouseStock = async (warehouseId: string, product: Product, currentQty: number) => {
    if (!window.confirm(`Remove all ${currentQty} units of [${product.sku}] from this facility?`)) return;
    await processDirectWarehouseAdjustment(warehouseId, product, -currentQty, 'Inline Stock Deletion');
  };

  const handleWarehouseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      const url = editingWarehouseId ? `${API_BASE_URL}/warehouses/${editingWarehouseId}` : `${API_BASE_URL}/warehouses`;
      const method = editingWarehouseId ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...warehouseForm, company: selectedCompany })
      });
      if (response.ok) {
        showToast(`Warehouse ${editingWarehouseId ? 'updated' : 'registered'}.`, "success");
        setWarehouseForm({ name: '', address: '', status: 'Active' });
        setEditingWarehouseId(null);
        fetchAllData();
      }
    } catch (e) { showToast("Failed to process warehouse.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleWarehouseDelete = async (id: string) => {
    if (!window.confirm("Permanently delete this warehouse? All stock will be wiped.")) return;
    setIsProcessing(true);
    try {
      await fetch(`${API_BASE_URL}/warehouses/${id}`, { method: 'DELETE' });
      showToast("Warehouse and internal stocks deleted.", "success");
      fetchAllData();
    } catch (e) { showToast("Failed to delete warehouse.", "error"); }
    finally { setIsProcessing(false); }
  };

  const executeTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (txModal.products.length === 0) return;
    setIsProcessing(true);

    const isBulk = txModal.products.length > 1;
    const apiPromises: Promise<any>[] = []; 
    
    let nextProducts = [...products];
    let nextHubStock = [...hubStock];

    try {
      for (const prod of txModal.products) {
        let currentMasterStock = Number(prod.currentStock) || 0;
        const pIdx = nextProducts.findIndex(p => p.id === prod.id);

        if (txModal.type === 'ADJUST') {
          const adjQ = isBulk ? Number(bulkQtys[prod.id]) : Number(adjustQty);
          if (isNaN(adjQ) || adjQ < 0) { if (!isBulk) throw new Error("Invalid count."); else continue; }
          const delta = Math.abs(adjQ - currentMasterStock);
          if (delta === 0) continue;

          currentMasterStock = adjQ;
          if(pIdx > -1) nextProducts[pIdx].currentStock = currentMasterStock;

          apiPromises.push(fetch(`${API_BASE_URL}/products/${prod.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentStock: currentMasterStock }) }));
          apiPromises.push(fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: 'ADJUST', quantity: delta, previousStock: prod.currentStock, newStock: currentMasterStock, reference: txForm.reference, remarks: txForm.remarks, user: loginUsername, company: selectedCompany, warehouseId: null }) }));
          continue;
        }

        let movementsToProcess: {source: string, dest: string, qty: number}[] = [];

        if (txModal.type === 'TRANSFER' || txModal.type === 'RETURN') {
          const sId = isBulk ? bulkForm.sourceId : transferForm.source;
          const dId = isBulk ? bulkForm.destId : transferForm.destination;
          const q = Number(isBulk ? bulkQtys[prod.id] : transferForm.quantity) || 0;

          if (!sId || !dId || sId === dId) throw new Error("Source and Destination must be valid and distinct.");
          if (q > 0) movementsToProcess.push({ source: sId, dest: dId, qty: q });
        } else {
          const isIssue = txModal.type === 'ISSUE';
          if (isBulk) {
            const locId = bulkForm.warehouseId;
            const q = Number(bulkQtys[prod.id]) || 0;
            if (!locId) throw new Error("Target location required.");
            if (q > 0) movementsToProcess.push({ source: isIssue ? locId : 'EXTERNAL', dest: isIssue ? 'EXTERNAL' : locId, qty: q });
          } else {
            if (Object.keys(allocations).length === 0) throw new Error("Allocate quantity to a location.");
            Object.entries(allocations).forEach(([locId, q]) => {
              if (q > 0) movementsToProcess.push({ source: isIssue ? locId : 'EXTERNAL', dest: isIssue ? 'EXTERNAL' : locId, qty: q });
            });
          }
        }

        for (const mov of movementsToProcess) {
          const prevMasterForLog = currentMasterStock;

          if (mov.source === 'MASTER') {
            if (currentMasterStock < mov.qty) throw new Error(`Not enough Master / Office Stock for ${prod.sku}.`);
            currentMasterStock -= mov.qty;
          } else if (mov.source !== 'EXTERNAL') {
            const sourceStock = hubStock.find(h => String(h.warehouseId) === String(mov.source) && Number(h.productId) === Number(prod.id))?.quantity || 0;
            if (sourceStock < mov.qty) throw new Error(`Not enough stock of ${prod.sku} in Source Location.`);
            const sIdx = nextHubStock.findIndex(h => String(h.warehouseId) === String(mov.source) && Number(h.productId) === Number(prod.id));
            if(sIdx > -1) nextHubStock[sIdx].quantity -= mov.qty;
            apiPromises.push(fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: mov.source, productId: prod.id, sku: prod.sku, quantity: -mov.qty }) }));
          }

          if (mov.dest === 'MASTER') {
            currentMasterStock += mov.qty;
          } else if (mov.dest !== 'EXTERNAL') {
            const dIdx = nextHubStock.findIndex(h => String(h.warehouseId) === String(mov.dest) && Number(h.productId) === Number(prod.id));
            if(dIdx > -1) nextHubStock[dIdx].quantity += mov.qty;
            else nextHubStock.push({ id: 'temp', warehouseId: mov.dest, productId: prod.id, sku: prod.sku, quantity: mov.qty });
            apiPromises.push(fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: mov.dest, productId: prod.id, sku: prod.sku, quantity: mov.qty }) }));
          }

          const logWarehouseId = (mov.dest !== 'MASTER' && mov.dest !== 'EXTERNAL') ? mov.dest : ((mov.source !== 'MASTER' && mov.source !== 'EXTERNAL') ? mov.source : null);
          apiPromises.push(fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: txModal.type, quantity: mov.qty, previousStock: prevMasterForLog, newStock: currentMasterStock, reference: txForm.reference, remarks: txForm.remarks, user: loginUsername, company: selectedCompany, warehouseId: logWarehouseId, batchNumber: txForm.batchNumber, expirationDate: txForm.expirationDate }) }));
        }

        if (currentMasterStock !== (Number(prod.currentStock) || 0)) {
          if(pIdx > -1) nextProducts[pIdx].currentStock = currentMasterStock;
          apiPromises.push(fetch(`${API_BASE_URL}/products/${prod.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentStock: currentMasterStock }) }));
        }
      }

      setProducts(nextProducts);
      setHubStock(nextHubStock);
      setTxModal({ isOpen: false, products: [], type: 'RECEIVE' });
      setSelectedProductIds([]);
      showToast(`Transactions successfully logged.`, "success");

      Promise.all(apiPromises).then(() => fetchAllData()).catch(() => {
        showToast("Warning: Background sync delay. Verifying data.", "error");
        fetchAllData(); 
      });

    } catch (e: any) { showToast(e.message || "Validation failed.", "error"); } 
    finally { setIsProcessing(false); }
  };

  const handleBulkPrintReceipt = (type: string, receiptProducts: Product[], qtys: Record<number, string>, form: any, bForm: any) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return showToast("Pop-ups blocked. Allow them to print receipts.", "error");

    const destName = type === 'TRANSFER' || type === 'RETURN'
      ? (bForm.destId === 'MASTER' ? 'Master Office Stock' : bForm.destId === 'EXTERNAL' ? 'External / Client' : warehouses.find(w => String(w.id) === String(bForm.destId))?.name) 
      : (bForm.warehouseId === 'MASTER' || !bForm.warehouseId ? 'Master Office Stock' : warehouses.find(w => String(w.id) === String(bForm.warehouseId))?.name);

    const rowsHtml = receiptProducts.map(p => {
       const q = Number(qtys[p.id]) || 0;
       if (q <= 0 && type !== 'DELETE') return '';
       return `
        <tr>
          <td>${p.name}</td>
          <td>${p.sku}</td>
          <td style="text-align: right; font-size: 16px; font-weight: 900;">${type === 'DELETE' ? p.currentStock : q}</td>
        </tr>
       `;
    }).join('');

    const html = `
      <html>
        <head>
          <title>Document: BATCH-${Date.now().toString().substring(7)}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;900&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Inter', sans-serif; padding: 50px; color: #0f172a; max-width: 900px; margin: 0 auto; }
            .header { display: flex; justify-content: space-between; border-bottom: 4px solid #0f172a; padding-bottom: 24px; margin-bottom: 32px; align-items: flex-end; }
            .company-name { font-size: 36px; font-weight: 900; text-transform: uppercase; letter-spacing: -1px; margin: 0; }
            .doc-type { font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 3px; margin-top: 4px; }
            .receipt-title { font-size: 28px; font-weight: 900; margin: 0; text-align: right; text-transform: uppercase; letter-spacing: 1px; 
                             color: ${type === 'RECEIVE' ? '#059669' : type === 'RETURN' ? '#0284c7' : type === 'ISSUE' || type === 'DELETE' ? '#e11d48' : type === 'ADJUST' ? '#4f46e5' : '#d97706'}; }
            .tx-details { font-size: 13px; color: #64748b; text-align: right; font-weight: 600; margin-top: 6px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 40px; background: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; }
            .info-block span { display: block; font-size: 11px; text-transform: uppercase; font-weight: 900; color: #94a3b8; margin-bottom: 6px; letter-spacing: 1px; }
            .info-block strong { font-size: 16px; font-weight: 600; color: #0f172a; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 50px; }
            .table th { text-align: left; padding: 14px 16px; border-bottom: 3px solid #cbd5e1; font-size: 12px; font-weight: 900; text-transform: uppercase; color: #475569; letter-spacing: 1px; }
            .table td { padding: 16px; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 600; color: #0f172a; }
            .signature-area { margin-top: 80px; display: flex; justify-content: space-between; }
            .sig-line { width: 250px; border-top: 2px solid #cbd5e1; padding-top: 10px; font-size: 13px; font-weight: 600; text-align: center; color: #64748b; text-transform: uppercase; letter-spacing: 1px;}
            .footer-tag { margin-top: 60px; text-align: center; font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px;}
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="company-name">${selectedCompany}</h1>
              <p class="doc-type">Official Stock Ledger Document</p>
            </div>
            <div>
              <h2 class="receipt-title">${receiptProducts.length > 1 ? 'BULK ' : ''}${type}</h2>
              <p class="tx-details">TX-${Date.now().toString().substring(5)} | ${new Date().toLocaleString()}</p>
            </div>
          </div>
          <div class="info-grid">
            <div class="info-block"><span>Facility / Location</span><strong>${type === 'DELETE' ? 'Master Registry' : destName || 'Master Office Stock'}</strong></div>
            <div class="info-block"><span>Processed By</span><strong>${loginUsername}</strong></div>
            <div class="info-block"><span>Reference Code</span><strong>${form.reference || 'N/A'}</strong></div>
            <div class="info-block"><span>Batch & Expiration</span><strong>${form.batchNumber ? `Batch: ${form.batchNumber}` : 'N/A'} ${form.expirationDate ? ` | Exp: ${form.expirationDate.split('T')[0]}` : ''}</strong></div>
          </div>
          <table class="table">
            <thead><tr><th>Item Description</th><th>SKU</th><th style="text-align: right;">Quantity</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div style="font-size: 14px; color: #475569; line-height: 1.6; background: #f8fafc; padding: 16px; border-left: 4px solid #cbd5e1;">
            <strong>Remarks:</strong> ${form.remarks || 'No additional remarks provided for this transaction.'}
          </div>
          <div class="signature-area">
            <div class="sig-line">Prepared By</div>
            <div class="sig-line">Received / Verified By</div>
          </div>
          <div class="footer-tag">System Generated Digital Ledger Receipt</div>
          <script>window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 500); }</script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handlePrintReceipt = (m: Movement) => {
    const related = movements.filter(mov => 
      mov.type === m.type && 
      mov.user === m.user &&
      Math.abs(new Date(mov.date).getTime() - new Date(m.date).getTime()) < 5000
    );

    const receiptProds = related.map(r => ({ id: r.productId, name: r.productName, sku: r.sku, currentStock: r.newStock } as any));
    const qtys = Object.fromEntries(related.map(r => [r.productId, String(r.quantity)]));
    const bForm = { destId: m.warehouseId, warehouseId: m.warehouseId };
    const form = { reference: m.reference, remarks: m.remarks, batchNumber: m.batchNumber, expirationDate: m.expirationDate };

    handleBulkPrintReceipt(m.type, receiptProds, qtys, form, bForm);
  };

  const handleClearHistory = async () => {
    if (!window.confirm("CRITICAL WARNING: Permanently wipe the audit trail? Physical balances remain unchanged.")) return;
    setIsProcessing(true);
    try {
      await fetch(`${API_BASE_URL}/inventory-movements/clear/${selectedCompany}`, { method: 'DELETE' });
      showToast("Movement history cleared.", "success");
      fetchAllData();
    } catch (e) { showToast("Failed to clear history.", "error"); }
    finally { setIsProcessing(false); }
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(products);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Catalog");
    XLSX.writeFile(wb, `${selectedCompany}_Master_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredProductsForDropdown = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()) || p.sku.toLowerCase().includes(productSearchTerm.toLowerCase()));

  const filteredMovements = movements.filter(m => {
    let keep = true;
    if (ledgerFilterType !== 'ALL' && m.type !== ledgerFilterType) keep = false;
    if (ledgerStartDate && new Date(m.date) < new Date(ledgerStartDate + 'T00:00:00')) keep = false;
    if (ledgerEndDate && new Date(m.date) > new Date(ledgerEndDate + 'T23:59:59')) keep = false;
    return keep;
  });

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm transition-all ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {/* LIGHTBOX */}
      {previewImage && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-[200] flex items-center justify-center p-8" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-50 bg-[#0F172A] text-slate-300 w-64 transition-transform duration-300 md:relative md:translate-x-0 flex flex-col shadow-xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-[#0B1120]">
          <h1 className="text-xl font-black text-white uppercase tracking-wider truncate">{selectedCompany}</h1>
        </div>
        <div className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 mt-4 ml-2">Core Modules</div>
          {[
            { id: 'products', label: 'Master Catalog' },
            { id: 'movements', label: 'Stock Ledger' },
            { id: 'warehouses', label: 'Warehouses' }
          ].map(view => (
            <button key={view.id} onClick={() => { setActiveView(view.id as any); setIsMobileMenuOpen(false); }} className={`w-full text-left px-4 py-3 text-sm font-bold uppercase tracking-wider transition-all rounded-xl ${activeView === view.id ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              {view.label}
            </button>
          ))}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="md:hidden font-black text-slate-900 px-3 py-1 bg-slate-100 rounded-lg">MENU</button>
            <div>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">
                {activeView === 'products' ? 'Product Catalog' : activeView === 'movements' ? 'Historical Ledger' : 'Warehouses'}
              </h2>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={onBack} className="hidden sm:block px-5 py-2.5 bg-white border border-slate-300 text-slate-700 font-bold uppercase text-xs rounded-xl hover:bg-slate-50 transition-colors shadow-sm">Gateway</button>
            <button onClick={onLogout} className="px-5 py-2.5 bg-rose-500 text-white font-bold uppercase text-xs rounded-xl hover:bg-rose-600 transition-colors shadow-sm">Logout</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 bg-[#F8FAFC]">
          
          {/* VIEW: PRODUCTS */}
          {activeView === 'products' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              <div className="flex flex-col sm:flex-row justify-between gap-4">
                <input type="text" placeholder="SEARCH SKU OR NAME..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full sm:w-96 px-5 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />
                <div className="flex flex-wrap gap-3">
                  {isAuthorizedAdmin && (
                    <button onClick={handleExportExcel} className="px-5 py-3 bg-white border border-slate-200 text-slate-700 font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-slate-50 transition-colors">Export Excel</button>
                  )}
                  <button onClick={() => { setProductForm(initialProductForm); setProductModal({ isOpen: true, editingId: null }); }} className="px-5 py-3 bg-blue-600 text-white font-bold uppercase text-xs rounded-xl shadow-sm hover:bg-blue-700 transition-colors">+ Register Item</button>
                </div>
              </div>

              {selectedProductIds.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                  <div className="font-black text-blue-900 uppercase text-sm tracking-widest px-2">{selectedProductIds.length} ITEMS SELECTED</div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openBulkTx('RECEIVE')} className="px-4 py-2 bg-emerald-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-emerald-600">Receive</button>
                    <button onClick={() => openBulkTx('RETURN')} className="px-4 py-2 bg-sky-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-sky-600">Return / Move</button>
                    <button onClick={() => openBulkTx('ISSUE')} className="px-4 py-2 bg-rose-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-rose-600">Issue</button>
                    <button onClick={() => openBulkTx('TRANSFER')} className="px-4 py-2 bg-amber-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-amber-600">Transfer</button>
                    {isAuthorizedAdmin && (
                      <button onClick={handleBulkDelete} className="px-4 py-2 bg-slate-900 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-slate-800 ml-4">Delete</button>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-left border-collapse min-w-[1100px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-4 px-5 w-12 text-center">
                        <input type="checkbox" checked={selectedProductIds.length === filteredProducts.length && filteredProducts.length > 0} onChange={() => toggleSelectAll(filteredProducts)} className="w-4 h-4 rounded border-slate-300 cursor-pointer" />
                      </th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">SKU / Item</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Pricing</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Master Stock</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Hub Stock</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500 text-right">Settings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducts.map(p => (
                      <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${selectedProductIds.includes(p.id) ? 'bg-blue-50/30' : ''}`}>
                        <td className="py-4 px-5 text-center">
                          <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleSelection(p.id)} className="w-4 h-4 rounded border-slate-300 cursor-pointer" />
                        </td>
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-4">
                            {p.imageUrl && typeof p.imageUrl === 'string' && p.imageUrl.length > 0 ? (
                              <img src={p.imageUrl} alt={p.name} className="w-12 h-12 rounded-xl object-cover border border-slate-200 cursor-pointer shadow-sm" onClick={() => setPreviewImage(p.imageUrl || '')} />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-[8px] font-bold uppercase text-center text-slate-400 cursor-pointer" onClick={() => { if(globalImageVault[p.sku]) setPreviewImage(globalImageVault[p.sku]); }}>No Img</div>
                            )}
                            <div>
                              <div className="font-black text-slate-900 uppercase text-sm">{p.name}</div>
                              <div className="text-xs font-medium text-slate-500 mt-0.5">{p.sku} | {p.category}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-5">
                          <div className="text-sm font-black text-slate-900">₱{p.sellingPrice}</div>
                          <div className="text-xs font-medium text-slate-500">Cost: ₱{p.purchasePrice}</div>
                        </td>
                        <td className="py-4 px-5">
                          <div className={`text-lg font-black ${p.currentStock <= p.reorderLevel ? 'text-rose-600' : 'text-emerald-600'}`}>{p.currentStock} <span className="text-xs text-slate-500">{p.unit}</span></div>
                        </td>
                        <td className="py-4 px-5">
                          {(() => {
                            const totalHubStock = hubStock.filter(h => String(h.productId) === String(p.id) || String(h.sku) === String(p.sku)).reduce((acc, val) => acc + val.quantity, 0);
                            return <div className="text-lg font-black text-slate-700">{totalHubStock} <span className="text-xs text-slate-400">{p.unit}</span></div>;
                          })()}
                        </td>
                        <td className="py-4 px-5 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button onClick={() => openSingleTx(p, 'RECEIVE')} className="px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-100 transition-colors">Recv</button>
                            <button onClick={() => openSingleTx(p, 'RETURN')} className="px-2.5 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-[10px] font-bold uppercase hover:bg-sky-100 transition-colors">Ret</button>
                            <button onClick={() => openSingleTx(p, 'ISSUE')} className="px-2.5 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-[10px] font-bold uppercase hover:bg-rose-100 transition-colors">Iss</button>
                            <button onClick={() => openSingleTx(p, 'TRANSFER')} className="px-2.5 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-bold uppercase hover:bg-amber-100 transition-colors">Trns</button>
                            <button onClick={() => { setProductForm({ ...p, previousImageUrl: globalImageVault[p.sku] || p.imageUrl || '' }); setProductModal({ isOpen: true, editingId: p.id }); }} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-200 transition-colors ml-2">Edit</button>
                            {isAuthorizedAdmin && (
                              <button onClick={() => handleProductDelete(p.id)} className="px-2.5 py-1.5 bg-white border border-rose-200 text-rose-600 rounded-lg text-[10px] font-bold uppercase hover:bg-rose-50 transition-colors">Del</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: MOVEMENTS (LEDGER) */}
          {activeView === 'movements' && (
            <div className="max-w-7xl mx-auto space-y-4">
              
              {/* FILTER BAR */}
              <div className="flex flex-wrap gap-4 items-center bg-white p-5 border border-slate-200 rounded-2xl shadow-sm">
                <div className="flex flex-col gap-1 w-full sm:w-auto">
                  <label className="text-[10px] font-bold uppercase text-slate-500">Transaction Type</label>
                  <select value={ledgerFilterType} onChange={e => setLedgerFilterType(e.target.value)} className="px-4 py-2.5 border border-slate-200 rounded-xl font-bold outline-none text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500">
                    <option value="ALL">All Transactions</option>
                    <option value="RECEIVE">Receives</option>
                    <option value="ISSUE">Issues</option>
                    <option value="RETURN">Returns</option>
                    <option value="TRANSFER">Transfers</option>
                    <option value="ADJUST">Adjustments</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 w-full sm:w-auto">
                  <label className="text-[10px] font-bold uppercase text-slate-500">Start Date</label>
                  <input type="date" value={ledgerStartDate} onChange={e => setLedgerStartDate(e.target.value)} className="px-4 py-2.5 border border-slate-200 rounded-xl font-bold outline-none text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1 w-full sm:w-auto">
                  <label className="text-[10px] font-bold uppercase text-slate-500">End Date</label>
                  <input type="date" value={ledgerEndDate} onChange={e => setLedgerEndDate(e.target.value)} className="px-4 py-2.5 border border-slate-200 rounded-xl font-bold outline-none text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex gap-2 w-full sm:w-auto sm:ml-auto mt-4 sm:mt-0 items-end">
                  <button onClick={() => { setLedgerFilterType('ALL'); setLedgerStartDate(''); setLedgerEndDate(''); }} className="px-5 py-2.5 border border-slate-200 rounded-xl font-bold uppercase text-xs hover:bg-slate-50 transition-colors h-[42px]">Clear Filters</button>
                  {isAuthorizedAdmin && (
                    <button onClick={handleClearHistory} disabled={isProcessing || movements.length === 0} className="px-5 py-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold uppercase text-xs hover:bg-rose-100 transition-colors h-[42px] disabled:opacity-50">Wipe History</button>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Timestamp</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Item</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Type / Qty</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Audit Info</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMovements.map(m => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="py-4 px-5 text-xs font-medium text-slate-500">{new Date(m.date).toLocaleString()}</td>
                        <td className="py-4 px-5">
                          <div className="font-black text-slate-900 text-sm uppercase">{m.productName}</div>
                          <div className="text-[10px] font-bold text-slate-500 mt-0.5">{m.sku}</div>
                        </td>
                        <td className="py-4 px-5">
                          <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase ${m.type === 'RECEIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : m.type === 'RETURN' ? 'bg-sky-50 text-sky-700 border border-sky-200' : m.type === 'ISSUE' ? 'bg-rose-50 text-rose-700 border border-rose-200' : m.type === 'TRANSFER' ? 'bg-amber-50 text-amber-700 border border-amber-200' : m.type === 'ADJUST' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>{m.type}</span>
                          <span className="ml-3 font-black text-slate-900">{m.quantity}</span>
                        </td>
                        <td className="py-4 px-5">
                          <div className="text-xs font-bold text-slate-900">{m.warehouse?.name || (m.type === 'TRANSFER' || m.type === 'RETURN' ? 'Transfer / Return Log' : 'Master Adjustment')}</div>
                          <div className="text-[10px] font-medium text-slate-500 mt-1">Ref: {m.reference || 'N/A'} | User: {m.user} | Bal: {m.previousStock} → {m.newStock}</div>
                          {(m.batchNumber || m.expirationDate) && (
                            <div className="text-[10px] font-bold text-blue-600 mt-1 uppercase">Batch: {m.batchNumber || '-'} | Exp: {m.expirationDate?.split('T')[0] || '-'}</div>
                          )}
                        </td>
                        <td className="py-4 px-5 text-right">
                           <button onClick={() => handlePrintReceipt(m)} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 text-[10px] font-bold uppercase hover:bg-slate-50 hover:text-blue-600 transition-colors opacity-0 group-hover:opacity-100 shadow-sm">PDF Receipt</button>
                        </td>
                      </tr>
                    ))}
                    {filteredMovements.length === 0 && (
                      <tr><td colSpan={5} className="py-12 text-center text-sm font-medium text-slate-400 uppercase">No movements match current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: WAREHOUSES */}
          {activeView === 'warehouses' && (
            <div className="max-w-7xl mx-auto space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* WAREHOUSE REGISTRATION / EDIT FORM */}
                {isAuthorizedAdmin ? (
                  <form onSubmit={handleWarehouseSubmit} className="bg-white border border-slate-200 p-6 sm:p-8 rounded-2xl shadow-sm h-max flex flex-col gap-5">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                      <h3 className="font-black text-slate-900 uppercase tracking-tight">{editingWarehouseId ? 'Edit Warehouse Info' : 'Register Warehouse'}</h3>
                      {editingWarehouseId && <button type="button" onClick={() => { setEditingWarehouseId(null); setWarehouseForm({ name: '', address: '', status: 'Active' }); }} className="text-[10px] font-bold uppercase text-rose-500 hover:text-rose-700 bg-rose-50 px-2 py-1 rounded-md">Cancel Edit</button>}
                    </div>
                    <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Facility Name</label><input required type="text" value={warehouseForm.name} onChange={e=>setWarehouseForm({...warehouseForm, name: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 focus:bg-white transition-all" placeholder="e.g. Main Medical Depot" /></div>
                    <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Physical Address</label><input required type="text" value={warehouseForm.address} onChange={e=>setWarehouseForm({...warehouseForm, address: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 focus:bg-white transition-all" placeholder="Complete address..." /></div>
                    <button type="submit" disabled={isProcessing} className="mt-4 w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50">{editingWarehouseId ? 'Update Warehouse' : 'Save Warehouse'}</button>
                  </form>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 h-max flex flex-col gap-3 justify-center items-center text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Admin Clearance Required to Manage Hubs</p>
                  </div>
                )}

                {/* DIRECT ADD / ADJUST STOCK TO WAREHOUSE FORM */}
                <form onSubmit={handleDirectStockSubmit} className="bg-white border border-slate-200 p-6 sm:p-8 rounded-2xl shadow-sm h-max flex flex-col gap-5">
                  <h3 className="font-black text-slate-900 uppercase tracking-tight border-b border-slate-100 pb-4">Adjust Hub Stock Directly</h3>
                  
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Select Target Warehouse</label>
                    <select required value={directStockForm.warehouseId} onChange={e=>setDirectStockForm({...directStockForm, warehouseId: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none bg-slate-50 focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all cursor-pointer">
                      <option value="">Select Warehouse...</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5 relative">
                    <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Search Product / SKU</label>
                    <input 
                      type="text" 
                      placeholder="Type name or SKU..." 
                      value={productSearchTerm} 
                      onChange={e => { setProductSearchTerm(e.target.value); setIsProductDropdownOpen(true); }}
                      onFocus={() => setIsProductDropdownOpen(true)}
                      className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold uppercase outline-none bg-slate-50 focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" 
                    />
                    {isProductDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 z-50 bg-white border border-slate-200 rounded-xl mt-1 max-h-48 overflow-y-auto shadow-xl">
                        {filteredProductsForDropdown.length === 0 ? (
                          <div className="p-4 text-xs text-slate-400 font-bold uppercase text-center">No matching products found</div>
                        ) : (
                          filteredProductsForDropdown.map(p => (
                            <div 
                              key={p.id} 
                              onClick={() => { setDirectStockForm({...directStockForm, productId: String(p.id)}); setProductSearchTerm(`${p.name} (${p.sku})`); setIsProductDropdownOpen(false); }}
                              className="p-3 hover:bg-slate-50 cursor-pointer border-b last:border-b-0 border-slate-100 text-xs font-bold uppercase flex justify-between items-center transition-colors"
                            >
                              <span className="text-slate-700">{p.name}</span>
                              <span className="text-slate-400 font-mono bg-slate-100 px-2 py-1 rounded">[{p.sku}]</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Quantity (Use Negative to Issue)</label>
                    <input required type="number" placeholder="e.g. 50 or -10" value={directStockForm.quantity} onChange={e=>setDirectStockForm({...directStockForm, quantity: e.target.value})} className="px-4 py-3 border border-blue-200 rounded-xl text-sm font-black outline-none bg-blue-50 focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-blue-900" />
                  </div>

                  <button type="submit" disabled={isProcessing} className="mt-4 w-full py-3.5 bg-blue-600 text-white rounded-xl font-bold uppercase tracking-wider hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50">Apply Stock Adjustment</button>
                </form>

              </div>

              {/* WAREHOUSE DIRECTORY TABLE */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Warehouse / Code</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Location</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Stored Assets</th>
                      {isAuthorizedAdmin && <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {warehouses.map(w => {
                      const whStocks = hubStock.filter(h => String(h.warehouseId) === String(w.id) && h.quantity > 0);
                      return (
                        <tr key={w.id} className="hover:bg-slate-50 transition-colors items-start group">
                          <td className="py-5 px-5 align-top"><div className="font-black text-slate-900 uppercase text-sm">{w.name}</div><div className="text-[10px] font-bold text-slate-400 mt-1">WH-{w.id.toString().padStart(3, '0')}</div></td>
                          <td className="py-5 px-5 text-xs font-medium text-slate-500 align-top max-w-[250px] leading-relaxed">{w.address}</td>
                          <td className="py-5 px-5 align-top">
                            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-2">
                              {whStocks.length === 0 ? <span className="text-xs text-slate-400 font-medium italic">Facility is currently empty</span> : whStocks.map(stk => {
                                const p = products.find(prod => Number(prod.id) === Number(stk.productId) || String(prod.sku) === String(stk.sku));
                                return (
                                  <div key={stk.id} className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm hover:border-blue-300 transition-colors">
                                    <div className="text-[10px] font-bold uppercase text-slate-700 truncate mr-3">{p?.name || stk.sku}</div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <div className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{stk.quantity} {p?.unit}</div>
                                      {isAuthorizedAdmin && p && (
                                        <div className="flex gap-1">
                                          <button onClick={() => handleEditWarehouseStock(w.id, p, stk.quantity)} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Adjust"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button>
                                          <button onClick={() => handleDeleteWarehouseStock(w.id, p, stk.quantity)} className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors" title="Remove"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                          {isAuthorizedAdmin && (
                            <td className="py-5 px-5 text-right align-top">
                              <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => { setEditingWarehouseId(w.id); setWarehouseForm({ name: w.name, address: w.address, status: w.status }); }} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-200 transition-colors">Edit</button>
                                <button onClick={() => handleWarehouseDelete(w.id)} className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-[10px] font-bold uppercase hover:bg-rose-100 transition-colors">Delete</button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* MODAL: ADD/EDIT PRODUCT */}
      {productModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-20">
              <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">{productModal.editingId ? 'Edit Master Record' : 'Register New Item'}</h2>
              <button onClick={() => setProductModal({ isOpen: false, editingId: null })} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleProductSubmit} className="p-8 flex flex-col gap-8 bg-slate-50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Name *</label><input required type="text" value={productForm.name} onChange={e=>setProductForm((prev: any) => ({...prev, name: e.target.value}))} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">SKU *</label><input required type="text" value={productForm.sku} onChange={e=>setProductForm((prev: any) => ({...prev, sku: e.target.value}))} className="px-4 py-3 border border-slate-200 rounded-xl font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Cost Price</label><div className="relative"><span className="absolute left-4 top-3 text-slate-400 font-bold">₱</span><input required type="number" step="0.01" value={productForm.purchasePrice} onChange={e=>setProductForm((prev: any) => ({...prev, purchasePrice: parseFloat(e.target.value)}))} className="w-full pl-8 pr-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" /></div></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Selling Price</label><div className="relative"><span className="absolute left-4 top-3 text-slate-400 font-bold">₱</span><input required type="number" step="0.01" value={productForm.sellingPrice} onChange={e=>setProductForm((prev: any) => ({...prev, sellingPrice: parseFloat(e.target.value)}))} className="w-full pl-8 pr-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" /></div></div>
              </div>
              
              {!productModal.editingId && (
                <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
                  <h3 className="font-black text-slate-900 uppercase mb-5 tracking-tight">Initial Master / Office Audit (Optional)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Starting Qty</label><input type="number" value={productForm.initialQuantity} onChange={e=>setProductForm((prev: any) => ({...prev, initialQuantity: parseInt(e.target.value) || 0}))} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-emerald-500 bg-emerald-50 text-emerald-900" /></div>
                    <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Batch #</label><input type="text" value={productForm.batchNumber} onChange={e=>setProductForm((prev: any) => ({...prev, batchNumber: e.target.value}))} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 uppercase" /></div>
                    <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Exp Date</label><input type="date" value={productForm.expirationDate} onChange={e=>setProductForm((prev: any) => ({...prev, expirationDate: e.target.value}))} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 text-slate-700" /></div>
                  </div>
                </div>
              )}
              
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Product Visual Asset</label>
                <div className="flex gap-3">
                  <label className="bg-white text-slate-700 border border-slate-200 rounded-xl px-5 py-3 font-bold cursor-pointer hover:bg-slate-50 hover:text-blue-600 transition-colors shadow-sm shrink-0 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    Upload Image
                    <input type="file" accept="image/*" className="hidden" onChange={handleModalImageUpload} />
                  </label>
                  <input 
                    type="text" 
                    placeholder="Or Paste HTTPS URL..." 
                    value={typeof productForm.imageUrl === 'string' && productForm.imageUrl.length > 500 ? `[Local Image Attached - ${Math.round(productForm.imageUrl.length / 1024)}KB]` : (productForm.imageUrl || '')} 
                    onChange={e=> {
                      const val = e.target.value;
                      if (val.includes('[Local Image Attached')) {
                        setProductForm((prev: any) => ({...prev, imageUrl: ''}));
                      } else {
                        setProductForm((prev: any) => ({...prev, imageUrl: val}));
                      }
                    }} 
                    className="flex-1 px-4 py-3 border border-slate-200 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" 
                  />
                </div>
                
                {/* VAULT & LIVE PREVIEW INSIDE EDIT MODAL */}
                <div className="flex gap-4 mt-4">
                  {/* Current Active Image */}
                  {typeof productForm.imageUrl === 'string' && productForm.imageUrl.length > 0 && (
                    <div className="relative w-32 h-32 rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 group shrink-0 shadow-sm">
                      <img src={productForm.imageUrl.startsWith('data:') || productForm.imageUrl.startsWith('http') ? productForm.imageUrl : ''} alt="Current Preview" className="w-full h-full object-cover" />
                      <button 
                        type="button" 
                        onClick={() => {
                          const toVault = productForm.imageUrl || '';
                          if (productForm.sku && toVault.length > 5) {
                             globalImageVault[productForm.sku] = toVault;
                          }
                          setProductForm((prev: any) => ({
                            ...prev,
                            previousImageUrl: toVault,
                            imageUrl: ''
                          }));
                        }} 
                        className="absolute top-2 left-2 bg-rose-500/90 backdrop-blur text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-105" 
                        title="Remove Image to Vault"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  )}

                  {/* Vault Fallback Memory */}
                  {typeof productForm.previousImageUrl === 'string' && productForm.previousImageUrl.length > 0 && productForm.previousImageUrl !== productForm.imageUrl && (
                    <div className="relative w-32 h-32 rounded-2xl border-2 border-dashed border-slate-300 overflow-hidden bg-slate-50 shrink-0 group">
                      <img src={productForm.previousImageUrl} alt="Vault" className="w-full h-full object-cover opacity-30 grayscale group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-300" />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none group-hover:bg-slate-900/20 transition-all">
                        <button 
                          type="button" 
                          onClick={() => setProductForm((prev: any) => ({ ...prev, imageUrl: prev.previousImageUrl || '' }))} 
                          className="bg-slate-900 text-white px-3 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 pointer-events-auto shadow-md hover:bg-slate-800 transition-transform hover:scale-105"
                        >
                          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> Restore
                        </button>
                      </div>
                      <div className="absolute bottom-0 inset-x-0 bg-slate-800/80 backdrop-blur text-white text-[9px] font-bold text-center py-1 uppercase tracking-widest">Vault Memory</div>
                    </div>
                  )}
                </div>
              </div>
              <button type="submit" disabled={isProcessing} className="py-4 bg-slate-900 text-white rounded-xl font-black uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-md disabled:opacity-50 mt-4">Save Master Record</button>
            </form>
          </div>
        </div>
      )}

      {/* OMNI MODAL: TRANSACT STOCK (SINGLE & BULK) */}
      {txModal.isOpen && txModal.products.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className={`bg-white rounded-3xl shadow-2xl w-full flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden ${txModal.products.length > 1 ? 'max-w-4xl' : 'max-w-lg'}`}>
            <div className={`p-6 border-b border-white/10 flex justify-between items-center ${txModal.type === 'RECEIVE' ? 'bg-emerald-500 text-white' : txModal.type === 'RETURN' ? 'bg-sky-500 text-white' : txModal.type === 'ISSUE' ? 'bg-rose-500 text-white' : txModal.type === 'TRANSFER' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-900'}`}>
              <h2 className="text-xl font-black uppercase tracking-tight">{txModal.type} BATCH ({txModal.products.length} Items)</h2>
              <button onClick={() => setTxModal({ isOpen: false, products: [], type: 'RECEIVE' })} className="p-1.5 bg-black/10 hover:bg-black/20 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={executeTransaction} className="p-8 flex flex-col gap-6 max-h-[75vh] overflow-y-auto bg-slate-50">
              
              {/* --- MULTIPLE PRODUCTS (BULK UI) --- */}
              {txModal.products.length > 1 ? (
                <>
                  {txModal.type === 'TRANSFER' || txModal.type === 'RETURN' ? (
                    <div className={`grid grid-cols-2 gap-5 p-5 rounded-2xl border ${txModal.type === 'RETURN' ? 'bg-sky-50 border-sky-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div className="flex flex-col gap-1.5">
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${txModal.type === 'RETURN' ? 'text-sky-700' : 'text-amber-700'}`}>From (Source Location)</label>
                        <select required value={bulkForm.sourceId} onChange={e=>setBulkForm({...bulkForm, sourceId: e.target.value})} className="px-4 py-3 border border-white/50 rounded-xl font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-slate-400">
                          <option value="">Select...</option>
                          {bulkForm.destId !== 'EXTERNAL' && <option value="EXTERNAL">External (Client / Supplier)</option>}
                          {bulkForm.destId !== 'MASTER' && <option value="MASTER">Master / Office Stock</option>}
                          {warehouses.filter(w => bulkForm.destId !== String(w.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${txModal.type === 'RETURN' ? 'text-sky-700' : 'text-amber-700'}`}>To (Destination Location)</label>
                        <select required value={bulkForm.destId} onChange={e=>setBulkForm({...bulkForm, destId: e.target.value})} className="px-4 py-3 border border-white/50 rounded-xl font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-slate-400">
                          <option value="">Select...</option>
                          {bulkForm.sourceId !== 'EXTERNAL' && <option value="EXTERNAL">External (Client / Supplier)</option>}
                          {bulkForm.sourceId !== 'MASTER' && <option value="MASTER">Master / Office Stock</option>}
                          {warehouses.filter(w => bulkForm.sourceId !== String(w.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </div>
                    </div>
                  ) : txModal.type !== 'ADJUST' && (
                    <div className="flex flex-col gap-1.5 bg-white p-5 border border-slate-200 rounded-2xl shadow-sm">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Target Location Assignment</label>
                      <select required value={bulkForm.warehouseId} onChange={e=>setBulkForm({...bulkForm, warehouseId: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none bg-slate-50 focus:ring-2 focus:ring-blue-500">
                        <option value="">Select Target Location...</option>
                        <option value="MASTER">Master / Office Stock</option>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </div>
                  )}

                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-2">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="p-4 text-xs font-bold uppercase text-slate-500 tracking-wider">Product</th>
                          <th className="p-4 text-xs font-bold uppercase text-slate-500 tracking-wider">Mst Stock</th>
                          <th className="p-4 text-xs font-bold uppercase text-slate-500 tracking-wider">Hub Stock</th>
                          <th className="p-4 text-xs font-bold uppercase text-slate-500 tracking-wider">Tx Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {txModal.products.map(p => {
                          const totalHubStock = hubStock.filter(h => String(h.productId) === String(p.id) || String(h.sku) === String(p.sku)).reduce((acc, val) => acc + val.quantity, 0);
                          return (
                            <tr key={p.id}>
                              <td className="p-4"><div className="font-black text-sm uppercase text-slate-900">{p.name}</div><div className="text-[10px] font-medium text-slate-500">{p.sku}</div></td>
                              <td className="p-4 text-sm font-bold text-slate-700">{p.currentStock}</td>
                              <td className="p-4 text-sm font-bold text-slate-700">{totalHubStock}</td>
                              <td className="p-4"><input type="number" min="0" placeholder="0" value={bulkQtys[p.id] || ''} onChange={e=>setBulkQtys({...bulkQtys, [p.id]: e.target.value})} className="w-24 px-4 py-2 border border-slate-300 rounded-xl font-black outline-none focus:ring-2 focus:ring-blue-500 text-slate-900" /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                /* --- SINGLE PRODUCT UI --- */
                <>
                  <div className="flex justify-between items-center bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <div><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Item</div><div className="font-black text-slate-900 text-lg uppercase tracking-tight mt-0.5">{txModal.products[0].name}</div></div>
                    <div className="text-right"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Master / Office Stock</div><div className="font-black text-2xl text-blue-600 mt-0.5">{txModal.products[0].currentStock} <span className="text-sm text-slate-400">{txModal.products[0].unit}</span></div></div>
                  </div>

                  {txModal.type === 'TRANSFER' || txModal.type === 'RETURN' ? (
                    <div className={`border border-slate-200 rounded-2xl p-6 flex flex-col gap-5 ${txModal.type === 'RETURN' ? 'bg-sky-50' : 'bg-amber-50'}`}>
                      <div className="flex flex-col gap-1.5">
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${txModal.type === 'RETURN' ? 'text-sky-700' : 'text-amber-700'}`}>From (Source)</label>
                        <select required value={transferForm.source} onChange={e=>setTransferForm({...transferForm, source: e.target.value})} className="px-4 py-3 border border-white/50 rounded-xl font-bold outline-none bg-white focus:ring-2 focus:ring-slate-400 shadow-sm">
                          <option value="">Select Source Location...</option>
                          {transferForm.destination !== 'EXTERNAL' && <option value="EXTERNAL">External (Client / Supplier)</option>}
                          {transferForm.destination !== 'MASTER' && <option value="MASTER">Master / Office Stock (Available: {txModal.products[0].currentStock})</option>}
                          {warehouses.filter(w => transferForm.destination !== String(w.id)).map(w => {
                            const curStk = hubStock.find(h => String(h.warehouseId) === String(w.id) && (String(h.sku) === String(txModal.products[0].sku) || Number(h.productId) === Number(txModal.products[0].id)))?.quantity || 0;
                            return <option key={w.id} value={w.id} disabled={curStk <= 0}>{w.name} (Available: {curStk})</option>
                          })}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={`text-[10px] font-bold uppercase tracking-wider ${txModal.type === 'RETURN' ? 'text-sky-700' : 'text-amber-700'}`}>To (Destination)</label>
                        <select required value={transferForm.destination} onChange={e=>setTransferForm({...transferForm, destination: e.target.value})} className="px-4 py-3 border border-white/50 rounded-xl font-bold outline-none bg-white focus:ring-2 focus:ring-slate-400 shadow-sm">
                          <option value="">Select Destination Location...</option>
                          {transferForm.source !== 'EXTERNAL' && <option value="EXTERNAL">External (Client / Supplier)</option>}
                          {transferForm.source !== 'MASTER' && <option value="MASTER">Master / Office Stock</option>}
                          {warehouses.filter(w => transferForm.source !== String(w.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Transfer Quantity</label><input type="number" required min="1" value={transferForm.quantity} onChange={e=>setTransferForm({...transferForm, quantity: e.target.value})} className="px-4 py-3 border border-slate-300 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm text-lg" /></div>
                    </div>
                  ) : txModal.type !== 'ADJUST' ? (
                    <div className="border border-slate-200 rounded-2xl p-6 bg-white shadow-sm flex flex-col gap-4">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Target Location Assignment</label>

                      {/* MASTER ROW */}
                      <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" checked={!!allocations['MASTER']} onChange={e => {const n = {...allocations}; if(e.target.checked) n['MASTER'] = 1; else delete n['MASTER']; setAllocations(n);}} className="w-5 h-5 rounded text-blue-600 border-slate-300 focus:ring-blue-500" />
                          <div className="font-bold text-sm uppercase text-slate-800">Master / Office Stock <span className="text-[10px] text-slate-400 font-medium ml-1">(Cur: {txModal.products[0].currentStock})</span></div>
                        </label>
                        {allocations['MASTER'] !== undefined && <input type="number" min="1" required value={allocations['MASTER'] || ''} onChange={e=>setAllocations({...allocations, ['MASTER']: Number(e.target.value)})} className="w-24 px-3 py-2 border border-slate-300 rounded-lg font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-blue-500" placeholder="Qty" />}
                      </div>

                      {/* WAREHOUSE ROWS */}
                      {warehouses.map(w => {
                        const curStk = hubStock.find(h => String(h.warehouseId) === String(w.id) && (String(h.sku) === String(txModal.products[0].sku) || Number(h.productId) === Number(txModal.products[0].id)))?.quantity || 0;
                        return (
                          <div key={w.id} className="flex items-center justify-between px-3 py-1">
                            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={!!allocations[w.id]} onChange={e => {const n = {...allocations}; if(e.target.checked) n[w.id] = 1; else delete n[w.id]; setAllocations(n);}} className="w-5 h-5 rounded text-blue-600 border-slate-300 focus:ring-blue-500" /><div className="font-bold text-sm uppercase text-slate-700">{w.name} <span className="text-[10px] text-slate-400 font-medium ml-1">(Cur: {curStk})</span></div></label>
                            {allocations[w.id] !== undefined && <input type="number" min="1" required value={allocations[w.id] || ''} onChange={e=>setAllocations({...allocations, [w.id]: Number(e.target.value)})} className="w-24 px-3 py-2 border border-slate-300 rounded-lg font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-blue-500" placeholder="Qty" />}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase tracking-wider text-amber-700">True Physical Count (Master/Office Stock Only)</label><input type="number" required min="0" value={adjustQty} onChange={e=>setAdjustQty(e.target.value === '' ? '' : Number(e.target.value))} className="px-5 py-4 border border-amber-300 rounded-xl text-xl font-black outline-none bg-amber-50 focus:ring-2 focus:ring-amber-500 text-amber-900 shadow-sm" /></div>
                  )}
                </>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 border-t border-slate-200 pt-6 mt-2">
                <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ref #</label><input type="text" value={txForm.reference} onChange={e=>setTxForm({...txForm, reference: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-blue-500" /></div>
                <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Remarks</label><input type="text" value={txForm.remarks} onChange={e=>setTxForm({...txForm, remarks: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-blue-500" /></div>
                {txModal.type !== 'ADJUST' && (
                  <>
                    <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Batch</label><input type="text" value={txForm.batchNumber} onChange={e=>setTxForm({...txForm, batchNumber: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-blue-500 uppercase" /></div>
                    <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Exp Date</label><input type="date" value={txForm.expirationDate} onChange={e=>setTxForm({...txForm, expirationDate: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-blue-500 text-slate-700" /></div>
                  </>
                )}
              </div>
              <button type="submit" disabled={isProcessing} className="py-4 bg-slate-900 text-white rounded-xl font-black uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-md disabled:opacity-50 mt-4">Confirm {txModal.type}</button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}