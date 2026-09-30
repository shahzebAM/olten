import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

// --- INTERFACES ---
interface Product { id: number; company: string; name: string; sku: string; category: string; purchasePrice: number; sellingPrice: number; minQuantity: number; reorderLevel: number; unit: string; isActive: boolean; vatSetting: string; imageUrl: string; barcode: string; currentStock: number; createdAt: string; deletedAt: string | null; }
interface Movement { id: string; productId: number; productName: string; sku: string; type: 'RECEIVE' | 'ISSUE' | 'ADJUST' | 'RETURN' | 'TRANSFER' | 'DELETE'; quantity: number; previousStock: number; newStock: number; reference: string; remarks: string; date: string; user: string; warehouseId?: string; batchNumber?: string | null; expirationDate?: string | null; warehouse?: { id: number; name: string; }; }
interface Warehouse { id: string; name: string; address: string; status: string; }
interface WarehouseStock { id: string; warehouseId: string; productId: number; sku: string; quantity: number; }

// --- PERSISTENT CACHE & VAULT ---
let globalImageVault: Record<string, string> = {}; 
let currentValidImages: Record<string, string> = {};
let deletedImageVault: Record<string, string> = {}; 

export default function MasterInventory({ selectedCompany, loginUsername, API_BASE_URL, onLogout, onBack }: any) {
  const isAuthorizedAdmin = loginUsername?.toLowerCase() === 'admin' || loginUsername?.toLowerCase() === 'ali' || loginUsername?.toLowerCase() === 'super admin';

  const [activeView, setActiveView] = useState<'products' | 'movements' | 'warehouses' | 'receiving'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [hubStock, setHubStock] = useState<WarehouseStock[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]); // New state for POs
  
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // --- HUB FILTER STATES ---
  const [selectedHubFilter, setSelectedHubFilter] = useState<string>('ALL');
  const [warehouseSearchQuery, setWarehouseSearchQuery] = useState('');

  // --- MODAL CONTROLLERS ---
  const [activeWarehouseModal, setActiveWarehouseModal] = useState<'REGISTER' | 'ADJUST' | 'TRANSFER' | null>(null);
  const [ledgerFilterType, setLedgerFilterType] = useState('ALL');
  const [ledgerStartDate, setLedgerStartDate] = useState('');
  const [ledgerEndDate, setLedgerEndDate] = useState('');

  const [productModal, setProductModal] = useState<{ isOpen: boolean; editingId: number | null }>({ isOpen: false, editingId: null });
  const [txModal, setTxModal] = useState<{ isOpen: boolean; products: Product[]; type: 'RECEIVE' | 'ISSUE' | 'ADJUST' | 'RETURN' }>({ isOpen: false, products: [], type: 'RECEIVE' });

  // --- RECEIVING MODAL STATES ---
  const [placementPo, setPlacementPo] = useState<any>(null);
  const [placementDestinations, setPlacementDestinations] = useState<Record<string, string>>({});

  const initialProductForm: any = { name: '', sku: '', category: 'General', purchasePrice: 0, sellingPrice: 0, minQuantity: 10, reorderLevel: 20, unit: 'pcs', isActive: true, vatSetting: 'Vatable', imageUrl: '', barcode: '', previousImageUrl: '', initialQuantity: 0, warehouseId: '', batchNumber: '', expirationDate: '' };
  const [productForm, setProductForm] = useState(initialProductForm);
  const [txForm, setTxForm] = useState({ reference: '', remarks: '', batchNumber: '', expirationDate: '' });
  
  const [movForm, setMovForm] = useState({ sourceId: '', destId: '' });
  const [movQtys, setMovQtys] = useState<Record<number, string>>({});
  
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);
  const [warehouseForm, setWarehouseForm] = useState({ name: '', address: '', status: 'Active' });

  const [directStockForm, setDirectStockForm] = useState({ warehouseId: '', productId: '', quantity: '' });
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);

  const [hubTransferForm, setHubTransferForm] = useState({ sourceId: '', destId: '', productId: '', quantity: '' });
  const [hubTransferSearch, setHubTransferSearch] = useState('');
  const [isHubDropdownOpen, setIsHubDropdownOpen] = useState(false);

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
      const [prodRes, movRes, whRes, stkRes, poRes] = await Promise.all([
        fetch(`${API_BASE_URL}/products?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/inventory-movements?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/warehouses?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/warehouse-stock?company=${selectedCompany}`),
        fetch(`${API_BASE_URL}/procurement/purchase-orders?company=${selectedCompany}`)
      ]);
      if (prodRes.ok) { const p = await prodRes.json(); updateImageVault(p); setProducts(p); }
      if (movRes.ok) setMovements(await movRes.json());
      if (whRes.ok) setWarehouses(await whRes.json());
      if (stkRes.ok) setHubStock(await stkRes.json());
      if (poRes.ok) setPurchaseOrders(await poRes.json());
    } catch (e) { console.error("API Error", e); }
  };

  useEffect(() => { fetchAllData(); }, [selectedCompany]);

  const pendingReceivables = purchaseOrders.filter(po => po.status === 'Received' || po.status === 'Partially Received');

  const toggleSelection = (id: number) => setSelectedProductIds((prev: number[]) => prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]);
  const toggleSelectAll = (filtered: Product[]) => {
    if (selectedProductIds.length === filtered.length) setSelectedProductIds([]);
    else setSelectedProductIds(filtered.map(p => p.id));
  };

  const openTx = (prods: Product[], type: string) => {
    setTxModal({ isOpen: true, products: prods, type: type as any });
    setTxForm({ reference: '', remarks: '', batchNumber: '', expirationDate: '' });
    
    let initialSource = '';
    let initialDest = '';
    
    if (type === 'RECEIVE') { initialSource = 'EXTERNAL'; initialDest = 'MASTER'; }
    if (type === 'RETURN') { initialSource = 'MASTER'; }
    if (type === 'ISSUE') { initialDest = 'EXTERNAL'; }

    setMovForm({ sourceId: initialSource, destId: initialDest });
    
    const initialQtys: Record<number, string> = {};
    prods.forEach(p => {
      initialQtys[p.id] = type === 'ADJUST' ? String(p.currentStock) : '';
    });
    setMovQtys(initialQtys);
  };

  const openBulkTx = (type: any) => {
    const prods = products.filter(p => selectedProductIds.includes(p.id));
    openTx(prods, type);
  };

  const handleModalImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1200; 

        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; } 
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
          setProductForm((prev: any) => ({ ...prev, previousImageUrl: prev.imageUrl || prev.previousImageUrl || '', imageUrl: compressedBase64 }));
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    const cleanPayload: any = {
      name: productForm.name, sku: productForm.sku, category: productForm.category || 'General',
      purchasePrice: parseFloat(productForm.purchasePrice) || 0, sellingPrice: parseFloat(productForm.sellingPrice) || 0,
      minQuantity: parseInt(productForm.minQuantity) || 10, reorderLevel: parseInt(productForm.reorderLevel) || 20,
      unit: productForm.unit || 'pcs', vatSetting: productForm.vatSetting || 'NONE', imageUrl: productForm.imageUrl || null,
      barcode: productForm.barcode || productForm.sku.toUpperCase(), company: selectedCompany,
    };

    if (!productModal.editingId) {
      cleanPayload.initialQuantity = parseInt(productForm.initialQuantity) || 0;
      cleanPayload.batchNumber = productForm.batchNumber || null;
      cleanPayload.expirationDate = productForm.expirationDate || null;
      cleanPayload.username = loginUsername;
    }

    const tempId = productModal.editingId || Date.now();
    setProducts((prev: Product[]) => {
      if (productModal.editingId) return prev.map(p => p.id === tempId ? { ...p, ...cleanPayload } as Product : p);
      return [{ ...cleanPayload, id: tempId, currentStock: cleanPayload.initialQuantity || 0 } as Product, ...prev];
    });

    if (cleanPayload.sku && cleanPayload.imageUrl) globalImageVault[cleanPayload.sku] = cleanPayload.imageUrl;

    setProductModal({ isOpen: false, editingId: null });
    setProductForm(initialProductForm);
    showToast("Saving to database...", "success");

    Promise.resolve().then(async () => {
      try {
        const url = productModal.editingId ? `${API_BASE_URL}/products/${productModal.editingId}` : `${API_BASE_URL}/products`;
        const res = await fetch(url, { method: productModal.editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanPayload) });
        if (!res.ok) throw new Error(`Server rejected request (${res.status})`);
        fetchAllData(); 
      } catch (error: any) { 
        showToast(`Sync Error: ${error.message}`, "error"); fetchAllData(); 
      }
    }).finally(() => setIsProcessing(false));
  };

  const processDirectWarehouseAdjustment = async (warehouseId: string, prod: Product, deltaQty: number, remarks: string) => {
    setIsProcessing(true);
    const isAdd = deltaQty > 0;
    const absQty = Math.abs(deltaQty);

    const currentHubStock = hubStock.find(h => String(h.warehouseId) === String(warehouseId) && Number(h.productId) === Number(prod.id))?.quantity || 0;
    if (!isAdd && currentHubStock < absQty) { setIsProcessing(false); return showToast("Insufficient stock in this specific warehouse.", "error"); }

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
        fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: 'ADJUST', quantity: absQty, previousStock: currentHubStock, newStock: currentHubStock + deltaQty, reference: 'Direct Hub Adjustment', remarks: remarks, user: loginUsername, company: selectedCompany, warehouseId: warehouseId }) })
      ]);
      showToast("Warehouse stock successfully adjusted.", "success");
      fetchAllData();
    } catch (e) { showToast("Failed to adjust warehouse stock.", "error"); fetchAllData(); } finally { setIsProcessing(false); }
  };

  // --- NEW: HANDLE PHYSICAL PLACEMENT OF P.O. ITEMS ---
  const handlePlacePoItems = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!placementPo) return;
    setIsProcessing(true);

    const apiPromises: Promise<any>[] = []; 
    let nextProducts = [...products];
    let nextHubStock = [...hubStock];

    try {
      for (const item of placementPo.items) {
        if (!item.confirmedQty || item.confirmedQty <= 0) continue; // Skip unreceived items

        const prod = products.find(p => p.sku === item.sku || String(p.id) === String(item.productId));
        if (!prod) continue; // Skip items not registered in Master Catalog

        const destId = placementDestinations[item.id] || 'MASTER';
        const q = item.confirmedQty;
        
        let currentMasterStock = Number(prod.currentStock) || 0;
        const pIdx = nextProducts.findIndex(p => p.id === prod.id);

        if (destId === 'MASTER') {
          const prevMaster = currentMasterStock;
          currentMasterStock += q;
          if(pIdx > -1) nextProducts[pIdx].currentStock = currentMasterStock;
          
          apiPromises.push(fetch(`${API_BASE_URL}/products/${prod.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentStock: currentMasterStock }) }));
          apiPromises.push(fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: 'RECEIVE', quantity: q, previousStock: prevMaster, newStock: currentMasterStock, reference: placementPo.poNumber, remarks: `Supplier: ${placementPo.supplierName || 'Unknown'}`, user: loginUsername, company: selectedCompany, warehouseId: null }) }));
        } else {
          const dIdx = nextHubStock.findIndex(h => String(h.warehouseId) === String(destId) && Number(h.productId) === Number(prod.id));
          const prevHubStock = dIdx > -1 ? nextHubStock[dIdx].quantity : 0;
          const newHubStock = prevHubStock + q;

          if(dIdx > -1) nextHubStock[dIdx].quantity = newHubStock;
          else nextHubStock.push({ id: 'temp', warehouseId: destId, productId: prod.id, sku: prod.sku, quantity: q });

          apiPromises.push(fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: destId, productId: prod.id, sku: prod.sku, quantity: q }) }));
          apiPromises.push(fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: 'RECEIVE', quantity: q, previousStock: prevHubStock, newStock: newHubStock, reference: placementPo.poNumber, remarks: `Supplier: ${placementPo.supplierName || 'Unknown'}`, user: loginUsername, company: selectedCompany, warehouseId: destId }) }));
        }
      }

      // Mark PO as physically stocked
      apiPromises.push(fetch(`${API_BASE_URL}/procurement/purchase-orders/${placementPo.id}/status`, { 
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Stocked', user: loginUsername }) 
      }));

      setProducts(nextProducts);
      setHubStock(nextHubStock);
      setPlacementPo(null);
      setPlacementDestinations({});
      showToast(`P.O. successfully routed to inventory.`, "success");

      await Promise.all(apiPromises);
      fetchAllData();

    } catch (e: any) { 
      showToast("Error placing stock.", "error"); 
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
    setActiveWarehouseModal(null);
  };

  const handleHubTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hubTransferForm.sourceId || !hubTransferForm.destId || !hubTransferForm.productId || !hubTransferForm.quantity || hubTransferForm.quantity === '0') return showToast("Please fill all fields with a valid quantity.", "error");
    if (hubTransferForm.sourceId === hubTransferForm.destId) return showToast("Source and Destination cannot be the same.", "error");
    
    const prod = products.find(p => String(p.id) === String(hubTransferForm.productId));
    if (!prod) return showToast("Product not found.", "error");

    const qty = Number(hubTransferForm.quantity);
    if (qty < 0) return showToast("Transfer quantity must be positive.", "error");

    const currentSourceStock = hubStock.find(h => String(h.warehouseId) === hubTransferForm.sourceId && Number(h.productId) === Number(prod.id))?.quantity || 0;
    if (currentSourceStock < qty) return showToast("Insufficient stock in Source Warehouse.", "error");

    setIsProcessing(true);
    setHubStock(prev => {
       const next = [...prev];
       const sIdx = next.findIndex(h => String(h.warehouseId) === hubTransferForm.sourceId && Number(h.productId) === Number(prod.id));
       if (sIdx > -1) next[sIdx].quantity -= qty;
       
       const dIdx = next.findIndex(h => String(h.warehouseId) === hubTransferForm.destId && Number(h.productId) === Number(prod.id));
       if (dIdx > -1) next[dIdx].quantity += qty;
       else next.push({ id: 'temp', warehouseId: hubTransferForm.destId, productId: prod.id, sku: prod.sku, quantity: qty });
       return next;
    });

    try {
       await Promise.all([
          fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: hubTransferForm.sourceId, productId: prod.id, sku: prod.sku, quantity: -qty }) }),
          fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: hubTransferForm.destId, productId: prod.id, sku: prod.sku, quantity: qty }) }),
          fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: 'TRANSFER', quantity: qty, previousStock: currentSourceStock, newStock: currentSourceStock - qty, reference: 'Inter-Hub Transfer', remarks: `From WH-${hubTransferForm.sourceId.padStart(3,'0')} to WH-${hubTransferForm.destId.padStart(3,'0')}`, user: loginUsername, company: selectedCompany, warehouseId: hubTransferForm.destId }) })
       ]);
       showToast("Transfer successful.", "success");
       setHubTransferForm({ sourceId: '', destId: '', productId: '', quantity: '' });
       setHubTransferSearch('');
       setActiveWarehouseModal(null);
       fetchAllData();
    } catch (e) { showToast("Transfer failed.", "error"); fetchAllData(); } finally { setIsProcessing(false); }
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
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...warehouseForm, company: selectedCompany }) });
      if (response.ok) {
        showToast(`Warehouse ${editingWarehouseId ? 'updated' : 'registered'}.`, "success");
        setWarehouseForm({ name: '', address: '', status: 'Active' });
        setEditingWarehouseId(null);
        setActiveWarehouseModal(null);
        fetchAllData();
      }
    } catch (e) { showToast("Failed to process warehouse.", "error"); } finally { setIsProcessing(false); }
  };

  const handleWarehouseDelete = async (id: string) => {
    if (!window.confirm("Permanently delete this warehouse? All stock will be wiped.")) return;
    setIsProcessing(true);
    try {
      await fetch(`${API_BASE_URL}/warehouses/${id}`, { method: 'DELETE' });
      showToast("Warehouse and internal stocks deleted.", "success");
      fetchAllData();
    } catch (e) { showToast("Failed to delete warehouse.", "error"); } finally { setIsProcessing(false); }
  };

  const executeTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (txModal.products.length === 0) return;
    setIsProcessing(true);

    const apiPromises: Promise<any>[] = []; 
    let nextProducts = [...products];
    let nextHubStock = [...hubStock];

    try {
      for (const prod of txModal.products) {
        let currentMasterStock = Number(prod.currentStock) || 0;
        const pIdx = nextProducts.findIndex(p => p.id === prod.id);

        if (txModal.type === 'ADJUST') {
          const adjQ = Number(movQtys[prod.id]);
          if (isNaN(adjQ) || adjQ < 0) continue;
          const delta = Math.abs(adjQ - currentMasterStock);
          if (delta === 0) continue;

          currentMasterStock = adjQ;
          if(pIdx > -1) nextProducts[pIdx].currentStock = currentMasterStock;

          apiPromises.push(fetch(`${API_BASE_URL}/products/${prod.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentStock: currentMasterStock }) }));
          apiPromises.push(fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: 'ADJUST', quantity: delta, previousStock: prod.currentStock, newStock: currentMasterStock, reference: txForm.reference, remarks: txForm.remarks, user: loginUsername, company: selectedCompany, warehouseId: null }) }));
          continue;
        }

        const q = Number(movQtys[prod.id]) || 0;
        if (q <= 0) continue;

        const source = movForm.sourceId;
        const dest = movForm.destId;

        if (!source || !dest) throw new Error("Source and Destination must be fully assigned.");
        if (source === dest) throw new Error("Cannot move stock to the exact same location.");

        const prevMasterForLog = currentMasterStock;

        // 1. DEDUCT FROM SOURCE
        if (source === 'MASTER') {
          if (currentMasterStock < q) throw new Error(`Not enough Master Stock for ${prod.sku}.`);
          currentMasterStock -= q;
        } else if (source !== 'EXTERNAL') {
          const sourceStock = hubStock.find(h => String(h.warehouseId) === String(source) && Number(h.productId) === Number(prod.id))?.quantity || 0;
          if (sourceStock < q) throw new Error(`Not enough stock of ${prod.sku} in Source Location.`);
          const sIdx = nextHubStock.findIndex(h => String(h.warehouseId) === String(source) && Number(h.productId) === Number(prod.id));
          if(sIdx > -1) nextHubStock[sIdx].quantity -= q;
          apiPromises.push(fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: source, productId: prod.id, sku: prod.sku, quantity: -q }) }));
        }

        // 2. ADD TO DESTINATION
        if (dest === 'MASTER') {
          currentMasterStock += q;
        } else if (dest !== 'EXTERNAL') {
          const dIdx = nextHubStock.findIndex(h => String(h.warehouseId) === String(dest) && Number(h.productId) === Number(prod.id));
          if(dIdx > -1) nextHubStock[dIdx].quantity += q;
          else nextHubStock.push({ id: 'temp', warehouseId: dest, productId: prod.id, sku: prod.sku, quantity: q });
          apiPromises.push(fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: dest, productId: prod.id, sku: prod.sku, quantity: q }) }));
        }

        // 3. LOG MOVEMENT
        const logWarehouseId = (dest !== 'MASTER' && dest !== 'EXTERNAL') ? dest : ((source !== 'MASTER' && source !== 'EXTERNAL') ? source : null);
        apiPromises.push(fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: txModal.type, quantity: q, previousStock: prevMasterForLog, newStock: currentMasterStock, reference: txForm.reference, remarks: txForm.remarks, user: loginUsername, company: selectedCompany, warehouseId: logWarehouseId, batchNumber: txForm.batchNumber, expirationDate: txForm.expirationDate }) }));

        // 4. MASTER STOCK PATCH
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

  const handleExportExcel = () => {
    try {
      const exportData = products.map(p => ({
        "SKU": p.sku, "Product Name": p.name, "Category": p.category,
        "Cost Price (₱)": p.purchasePrice, "Selling Price (₱)": p.sellingPrice,
        "Master Stock": p.currentStock, "Unit": p.unit, "Reorder Level": p.reorderLevel,
        "Barcode": p.barcode || 'N/A', "Status": p.isActive ? "Active" : "Inactive"
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Master Catalog");
      XLSX.writeFile(wb, `${selectedCompany}_Master_${new Date().toISOString().split('T')[0]}.xlsx`);
      showToast("Excel exported successfully.", "success");
    } catch (error) { showToast("Failed to export Excel file.", "error"); }
  };

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredProductsForDropdown = products.filter(p => p.name.toLowerCase().includes(productSearchTerm.toLowerCase()) || p.sku.toLowerCase().includes(productSearchTerm.toLowerCase()));
  const filteredProductsForHubDropdown = products.filter(p => p.name.toLowerCase().includes(hubTransferSearch.toLowerCase()) || p.sku.toLowerCase().includes(hubTransferSearch.toLowerCase()));

  const filteredMovements = movements.filter(m => {
    let keep = true;
    if (ledgerFilterType !== 'ALL' && m.type !== ledgerFilterType) keep = false;
    if (ledgerStartDate && new Date(m.date) < new Date(ledgerStartDate + 'T00:00:00')) keep = false;
    if (ledgerEndDate && new Date(m.date) > new Date(ledgerEndDate + 'T23:59:59')) keep = false;
    return keep;
  });

  const displayedWarehouses = warehouses.filter(w => {
    if (!warehouseSearchQuery) return true;
    const q = warehouseSearchQuery.toLowerCase();
    if (w.name.toLowerCase().includes(q) || w.address.toLowerCase().includes(q)) return true;
    const wStocks = hubStock.filter(h => String(h.warehouseId) === String(w.id) && h.quantity > 0);
    return wStocks.some(stk => {
       const p = products.find(prod => Number(prod.id) === Number(stk.productId) || String(prod.sku) === String(stk.sku));
       return p?.name.toLowerCase().includes(q) || stk.sku.toLowerCase().includes(q);
    });
  });

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-5 py-3.5 rounded-xl shadow-xl font-bold text-sm transition-all ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          {toast.message}
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-[200] flex items-center justify-center p-8" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* SIDEBAR NAVIGATION */}
      <aside className={`fixed inset-y-0 left-0 z-50 bg-[#0F172A] text-slate-300 w-64 transition-transform duration-300 md:relative md:translate-x-0 flex flex-col shadow-xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-20 flex items-center px-6 border-b border-slate-800 bg-[#0B1120]">
          <h1 className="text-xl font-black text-white uppercase tracking-wider truncate">{selectedCompany}</h1>
        </div>
        <div className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 mt-4 ml-2">Core Modules</div>
          {[
            { id: 'products', label: 'Master Catalog' },
            { id: 'movements', label: 'Stock Ledger' },
            { id: 'warehouses', label: 'Warehouses' },
            { id: 'receiving', label: 'Receiving', badge: pendingReceivables.length } // NEW MENU ITEM
          ].map(view => (
            <button key={view.id} onClick={() => { setActiveView(view.id as any); setIsMobileMenuOpen(false); }} className={`w-full text-left px-4 py-3 text-sm font-bold uppercase tracking-wider transition-all rounded-xl flex justify-between items-center ${activeView === view.id ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              {view.label}
              {view.badge !== undefined && view.badge > 0 && (
                <span className="animate-pulse bg-rose-500 text-white px-2 py-0.5 rounded-full text-[10px] font-black">{view.badge}</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* RESPONSIVE HEADER - FIXED HIDDEN BUTTONS */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 shrink-0 shadow-sm z-10 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="md:hidden font-black text-slate-900 px-3 py-2 bg-slate-100 rounded-lg text-xs shrink-0">MENU</button>
            <div className="truncate hidden sm:block">
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tighter truncate">
                {activeView === 'products' ? 'Product Catalog' : activeView === 'movements' ? 'Historical Ledger' : activeView === 'warehouses' ? 'Warehouses' : 'Physical Receiving'}
              </h2>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={onBack} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 font-bold uppercase text-[10px] sm:text-xs rounded-xl hover:bg-slate-50 transition-colors shadow-sm">Gateway</button>
            <button onClick={onLogout} className="px-4 py-2 bg-rose-500 text-white font-bold uppercase text-[10px] sm:text-xs rounded-xl hover:bg-rose-600 transition-colors shadow-sm">Logout</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 bg-[#F8FAFC]">
          
          {/* VIEW: PRODUCTS */}
          {activeView === 'products' && (
            <div className="space-y-6 max-w-7xl mx-auto">
              <div className="flex flex-col sm:flex-row justify-between gap-4">
                <div className="flex flex-1 flex-col sm:flex-row gap-3">
                  <input type="text" placeholder="SEARCH SKU OR NAME..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full sm:w-80 px-5 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />
                  <select value={selectedHubFilter} onChange={(e) => setSelectedHubFilter(e.target.value)} className="px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer text-slate-700 w-full sm:w-auto">
                    <option value="ALL">All Hubs (Combined)</option>
                    {warehouses.map(w => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
                  </select>
                </div>
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
                    <button onClick={() => openBulkTx('RETURN')} className="px-4 py-2 bg-sky-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-sky-600">Return to Hub</button>
                    <button onClick={() => openBulkTx('ISSUE')} className="px-4 py-2 bg-rose-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-rose-600">Issue</button>
                    <button onClick={() => openBulkTx('ADJUST')} className="px-4 py-2 bg-indigo-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-indigo-600">Adjust Master</button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-4 px-5 w-12 text-center">
                        <input type="checkbox" checked={selectedProductIds.length === filteredProducts.length && filteredProducts.length > 0} onChange={() => toggleSelectAll(filteredProducts)} className="w-4 h-4 rounded border-slate-300 cursor-pointer" />
                      </th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">SKU / Item</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Category</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Pricing</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Master Stock</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">
                        {selectedHubFilter === 'ALL' ? 'Hub Stock (All)' : `Hub: ${warehouses.find(w => String(w.id) === selectedHubFilter)?.name || 'Selected'}`}
                      </th>
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
                              <div className="text-xs font-medium text-slate-500 mt-0.5">{p.sku}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-5"><span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[10px] font-black uppercase rounded-md border border-slate-200">{p.category}</span></td>
                        <td className="py-4 px-5">
                          <div className="text-sm font-black text-slate-900">₱{p.sellingPrice}</div>
                          <div className="text-xs font-medium text-slate-500">Cost: ₱{p.purchasePrice}</div>
                        </td>
                        <td className="py-4 px-5">
                          <div className={`text-lg font-black ${p.currentStock <= p.reorderLevel ? 'text-rose-600' : 'text-emerald-600'}`}>{p.currentStock} <span className="text-xs text-slate-500">{p.unit}</span></div>
                        </td>
                        <td className="py-4 px-5">
                          {(() => {
                            const filteredHubList = hubStock.filter(h => {
                              const isMatch = (String(h.productId) === String(p.id) || String(h.sku) === String(p.sku));
                              if (!isMatch) return false;
                              if (selectedHubFilter === 'ALL') return warehouses.some(w => String(w.id) === String(h.warehouseId));
                              return String(h.warehouseId) === String(selectedHubFilter);
                            });
                            const displayQty = filteredHubList.reduce((acc, val) => acc + val.quantity, 0);
                            return <div className="text-lg font-black text-slate-700">{displayQty} <span className="text-xs text-slate-400">{p.unit}</span></div>;
                          })()}
                        </td>
                        <td className="py-4 px-5 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button onClick={() => openTx([p], 'RECEIVE')} className="px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-100 transition-colors" title="Receive into Master Stock">Recv</button>
                            <button onClick={() => openTx([p], 'RETURN')} className="px-2.5 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-[10px] font-bold uppercase hover:bg-sky-100 transition-colors" title="Return to Warehouse Hub">Ret</button>
                            <button onClick={() => openTx([p], 'ISSUE')} className="px-2.5 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-[10px] font-bold uppercase hover:bg-rose-100 transition-colors" title="Issue to External Client">Iss</button>
                            <button onClick={() => openTx([p], 'ADJUST')} className="px-2.5 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-bold uppercase hover:bg-indigo-100 transition-colors" title="Adjust Physical Master Stock">Adj</button>
                            <button onClick={() => { setProductForm({ ...p, previousImageUrl: deletedImageVault[p.sku] || globalImageVault[p.sku] || '' }); setProductModal({ isOpen: true, editingId: p.id }); }} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-200 transition-colors ml-2">Edit</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: RECEIVING (NEW P.O. PLACEMENT QUEUE) */}
          {activeView === 'receiving' && (
            <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden relative">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                  <div>
                    <h3 className="font-bold text-slate-800 uppercase tracking-widest text-sm">Delivery Placement Queue</h3>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">Assign delivered P.O. items to physical facilities</p>
                  </div>
                </div>
                <div className="flex-1 overflow-auto w-full">
                  <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px] border-collapse">
                    <thead className="bg-white shadow-sm sticky top-0 z-20">
                      <tr>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Ref / P.O. Number</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] border-b border-slate-200">Supplier Origin</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Items to Place</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-center border-b border-slate-200">Delivery Status</th>
                        <th className="py-4 px-6 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right border-b border-slate-200">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {pendingReceivables.length === 0 ? (
                        <tr><td colSpan={5} className="py-20 text-center text-slate-400 font-medium">No verified deliveries pending placement.</td></tr>
                      ) : (
                        pendingReceivables.map(po => {
                          const itemsToPlace = po.items?.filter((i: any) => i.confirmedQty && i.confirmedQty > 0) || [];
                          return (
                            <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                              <td className="py-4 px-6">
                                <div className="font-mono text-sm font-black text-sky-700">{po.poNumber}</div>
                                <div className="text-[10px] font-bold text-slate-400 mt-0.5">Ref: {po.osReference || 'N/A'}</div>
                              </td>
                              <td className="py-4 px-6 font-bold text-slate-700 uppercase">{po.supplierName || 'Unknown Vendor'}</td>
                              <td className="py-4 px-6 text-center font-black text-slate-700">
                                {itemsToPlace.length} Lines
                              </td>
                              <td className="py-4 px-6 text-center">
                                <span className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-md ${po.status === 'Partially Received' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                                  {po.status}
                                </span>
                              </td>
                              <td className="py-4 px-6 text-right">
                                <button onClick={() => { 
                                    setPlacementPo(po); 
                                    const initDest: Record<string, string> = {};
                                    itemsToPlace.forEach((i: any) => initDest[i.id] = 'MASTER');
                                    setPlacementDestinations(initDest);
                                  }} 
                                  className="px-4 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-sm"
                                >
                                  Place Stock
                                </button>
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

          {/* VIEW: MOVEMENTS (LEDGER) */}
          {activeView === 'movements' && (
            <div className="max-w-7xl mx-auto space-y-4">
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMovements.map(m => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
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
                          <div className="text-xs font-bold text-slate-900">{m.warehouse?.name || (m.type === 'TRANSFER' || m.type === 'RETURN' ? 'Transfer / Return Log' : 'Master Placement')}</div>
                          <div className="text-[10px] font-medium text-slate-500 mt-1">Ref: {m.reference || 'N/A'} | User: {m.user} | Bal: {m.previousStock} → {m.newStock}</div>
                          {m.remarks && <div className="text-[10px] font-bold text-sky-700 mt-1 uppercase bg-sky-50 inline-block px-1.5 py-0.5 rounded">{m.remarks}</div>}
                        </td>
                      </tr>
                    ))}
                    {filteredMovements.length === 0 && <tr><td colSpan={4} className="py-12 text-center text-sm font-medium text-slate-400 uppercase">No movements match current filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: WAREHOUSES */}
          {activeView === 'warehouses' && (
            <div className="max-w-7xl mx-auto space-y-8">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
                 <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Warehouse Control Center</h2>
                 <div className="flex items-center gap-3 w-full sm:w-auto">
                   <div className="relative w-full sm:w-80">
                     <svg className="w-5 h-5 absolute left-3 top-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                     <input type="text" placeholder="SEARCH HUBS OR ITEMS..." value={warehouseSearchQuery} onChange={(e) => setWarehouseSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white" />
                   </div>
                 </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {isAuthorizedAdmin && ( <button onClick={() => { setEditingWarehouseId(null); setWarehouseForm({name: '', address: '', status: 'Active'}); setActiveWarehouseModal('REGISTER'); }} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-bold uppercase text-xs shadow-sm hover:bg-slate-800 transition-colors">+ Register Warehouse</button> )}
                <button onClick={() => setActiveWarehouseModal('ADJUST')} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold uppercase text-xs shadow-sm hover:bg-indigo-700 transition-colors">Adjust Hub Stock</button>
                <button onClick={() => setActiveWarehouseModal('TRANSFER')} className="px-5 py-2.5 bg-amber-500 text-white rounded-xl font-bold uppercase text-xs shadow-sm hover:bg-amber-600 transition-colors">Transfer Between Hubs</button>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Warehouse / Code</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Location</th>
                      <th className="py-4 px-5 text-xs font-bold uppercase tracking-widest text-slate-500">Stored Assets</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedWarehouses.map(w => {
                      const whStocks = hubStock.filter(h => String(h.warehouseId) === String(w.id) && h.quantity > 0);
                      const filteredWhStocks = whStocks.filter(stk => {
                        if (!warehouseSearchQuery) return true;
                        const q = warehouseSearchQuery.toLowerCase();
                        if (w.name.toLowerCase().includes(q) || w.address.toLowerCase().includes(q)) return true;
                        const p = products.find(prod => Number(prod.id) === Number(stk.productId) || String(prod.sku) === String(stk.sku));
                        return p?.name.toLowerCase().includes(q) || stk.sku.toLowerCase().includes(q);
                      });
                      return (
                        <tr key={w.id} className="hover:bg-slate-50 transition-colors items-start">
                          <td className="py-5 px-5 align-top"><div className="font-black text-slate-900 uppercase text-sm">{w.name}</div><div className="text-[10px] font-bold text-slate-400 mt-1">WH-{w.id.toString().padStart(3, '0')}</div></td>
                          <td className="py-5 px-5 text-xs font-medium text-slate-500 align-top max-w-[250px] leading-relaxed">{w.address}</td>
                          <td className="py-5 px-5 align-top">
                            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-2">
                              {whStocks.length === 0 ? ( <span className="text-xs text-slate-400 font-medium italic">Facility is empty</span> ) : filteredWhStocks.length === 0 && warehouseSearchQuery ? ( <span className="text-xs text-slate-400 font-medium italic">No matching items</span> ) : (
                                filteredWhStocks.map(stk => {
                                  const p = products.find(prod => Number(prod.id) === Number(stk.productId) || String(prod.sku) === String(stk.sku));
                                  return (
                                    <div key={stk.id} className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm hover:border-blue-300 transition-colors">
                                      <div className="text-[10px] font-bold uppercase text-slate-700 truncate mr-3">{p?.name || stk.sku}</div>
                                      <div className="text-xs font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{stk.quantity} {p?.unit}</div>
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          </td>
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

      {/* NEW P.O. PLACEMENT MODAL */}
      {placementPo && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-sky-100 flex justify-between items-center bg-sky-500 text-white shrink-0">
              <div>
                <h3 className="text-xl font-black uppercase tracking-tight">Route Delivery: {placementPo.poNumber}</h3>
                <p className="text-[10px] font-bold text-sky-100 uppercase tracking-widest mt-1">Assign arriving stock to specific facilities</p>
              </div>
              <button onClick={() => setPlacementPo(null)} className="p-1.5 bg-black/10 hover:bg-black/20 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handlePlacePoItems} className="flex-1 overflow-y-auto bg-slate-50 flex flex-col p-6 gap-4">
              <div className="bg-sky-50 border border-sky-200 text-sky-800 p-4 rounded-xl text-xs font-bold mb-2">
                Note: Any items marked as 'Shortage' during receiving have been excluded. Items completely missing from the Master Catalog will be skipped.
              </div>
              {placementPo.items.filter((i: any) => i.confirmedQty && i.confirmedQty > 0).map((item: any) => {
                const prodExists = products.some(p => p.sku === item.sku || String(p.id) === String(item.productId));
                return (
                  <div key={item.id} className={`bg-white p-5 rounded-2xl border shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${!prodExists ? 'border-rose-200 bg-rose-50/30 opacity-70' : 'border-slate-200'}`}>
                    <div>
                      <div className="text-sm font-black uppercase text-slate-900">{item.productName}</div>
                      <div className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-widest">{item.sku}</div>
                      {!prodExists && <div className="text-[10px] font-bold text-rose-500 mt-1 uppercase tracking-widest">NOT IN CATALOG - WILL BE SKIPPED</div>}
                    </div>
                    <div className="flex items-center gap-4 w-full sm:w-auto">
                      <div className="text-center bg-slate-100 px-4 py-2 rounded-xl shrink-0 border border-slate-200">
                        <span className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Verified Qty</span>
                        <span className="text-lg font-black text-slate-900">{item.confirmedQty}</span>
                      </div>
                      <div className="flex-1 sm:w-56">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Destination Facility</label>
                        <select 
                          disabled={!prodExists}
                          value={placementDestinations[item.id] || 'MASTER'} 
                          onChange={(e) => setPlacementDestinations({...placementDestinations, [item.id]: e.target.value})} 
                          className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-sky-500 cursor-pointer disabled:bg-slate-100"
                        >
                          <option value="MASTER">Master Office / Main</option>
                          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                )
              })}
              <button type="submit" disabled={isProcessing} className="mt-4 py-4 bg-sky-600 text-white rounded-xl font-black uppercase tracking-wider hover:bg-sky-700 transition-colors shadow-md disabled:opacity-50">
                {isProcessing ? 'Processing Routing...' : 'Confirm Stock Placement'}
              </button>
            </form>
          </div>
        </div>
      )}

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
              
              <button type="submit" disabled={isProcessing} className="py-4 bg-slate-900 text-white rounded-xl font-black uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-md disabled:opacity-50 mt-4">Save Master Record</button>
            </form>
          </div>
        </div>
      )}

      {/* WAREHOUSE DIRECTORY MODALS */}
      {activeWarehouseModal === 'REGISTER' && isAuthorizedAdmin && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">{editingWarehouseId ? 'Edit Warehouse' : 'Register Warehouse'}</h2>
              <button onClick={() => { setActiveWarehouseModal(null); setEditingWarehouseId(null); }} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setIsProcessing(true);
              try {
                const url = editingWarehouseId ? `${API_BASE_URL}/warehouses/${editingWarehouseId}` : `${API_BASE_URL}/warehouses`;
                const method = editingWarehouseId ? 'PATCH' : 'POST';
                const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...warehouseForm, company: selectedCompany }) });
                if (response.ok) {
                  showToast(`Warehouse ${editingWarehouseId ? 'updated' : 'registered'}.`, "success");
                  setWarehouseForm({ name: '', address: '', status: 'Active' });
                  setEditingWarehouseId(null);
                  setActiveWarehouseModal(null);
                  fetchAllData();
                }
              } catch (e) { showToast("Failed to process warehouse.", "error"); }
              finally { setIsProcessing(false); }
            }} className="p-8 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Facility Name</label><input required type="text" value={warehouseForm.name} onChange={e=>setWarehouseForm({...warehouseForm, name: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" placeholder="e.g. Main Depot" /></div>
              <div className="flex flex-col gap-1.5"><label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Physical Address</label><input required type="text" value={warehouseForm.address} onChange={e=>setWarehouseForm({...warehouseForm, address: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" placeholder="Complete address..." /></div>
              <button type="submit" disabled={isProcessing} className="mt-4 w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold uppercase tracking-wider hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50">{editingWarehouseId ? 'Update' : 'Save'}</button>
            </form>
          </div>
        </div>
      )}

      {/* OMNI MODAL: TRANSACT STOCK */}
      {txModal.isOpen && txModal.products.length > 0 && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className={`bg-white rounded-3xl shadow-2xl w-full flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden ${txModal.products.length > 1 ? 'max-w-4xl' : 'max-w-lg'}`}>
            <div className={`p-6 border-b border-white/10 flex justify-between items-center ${txModal.type === 'RECEIVE' ? 'bg-emerald-500 text-white' : txModal.type === 'RETURN' ? 'bg-sky-500 text-white' : txModal.type === 'ISSUE' ? 'bg-rose-500 text-white' : 'bg-indigo-500 text-white'}`}>
              <h2 className="text-xl font-black uppercase tracking-tight">{txModal.type} BATCH ({txModal.products.length} Items)</h2>
              <button onClick={() => setTxModal({ isOpen: false, products: [], type: 'RECEIVE' })} className="p-1.5 bg-black/10 hover:bg-black/20 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (txModal.products.length === 0) return;
              setIsProcessing(true);

              const apiPromises: Promise<any>[] = []; 
              let nextProducts = [...products];
              let nextHubStock = [...hubStock];

              try {
                for (const prod of txModal.products) {
                  let currentMasterStock = Number(prod.currentStock) || 0;
                  const pIdx = nextProducts.findIndex(p => p.id === prod.id);

                  if (txModal.type === 'ADJUST') {
                    const adjQ = Number(movQtys[prod.id]);
                    if (isNaN(adjQ) || adjQ < 0) continue;
                    const delta = Math.abs(adjQ - currentMasterStock);
                    if (delta === 0) continue;

                    currentMasterStock = adjQ;
                    if(pIdx > -1) nextProducts[pIdx].currentStock = currentMasterStock;

                    apiPromises.push(fetch(`${API_BASE_URL}/products/${prod.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentStock: currentMasterStock }) }));
                    apiPromises.push(fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: 'ADJUST', quantity: delta, previousStock: prod.currentStock, newStock: currentMasterStock, reference: txForm.reference, remarks: txForm.remarks, user: loginUsername, company: selectedCompany, warehouseId: null }) }));
                    continue;
                  }

                  const q = Number(movQtys[prod.id]) || 0;
                  if (q <= 0) continue;

                  const source = movForm.sourceId;
                  const dest = movForm.destId;

                  if (!source || !dest) throw new Error("Source and Destination must be fully assigned.");
                  if (source === dest) throw new Error("Cannot move stock to the exact same location.");

                  const prevMasterForLog = currentMasterStock;

                  // 1. DEDUCT FROM SOURCE
                  if (source === 'MASTER') {
                    if (currentMasterStock < q) throw new Error(`Not enough Master Stock for ${prod.sku}.`);
                    currentMasterStock -= q;
                  } else if (source !== 'EXTERNAL') {
                    const sourceStock = hubStock.find(h => String(h.warehouseId) === String(source) && Number(h.productId) === Number(prod.id))?.quantity || 0;
                    if (sourceStock < q) throw new Error(`Not enough stock of ${prod.sku} in Source Location.`);
                    const sIdx = nextHubStock.findIndex(h => String(h.warehouseId) === String(source) && Number(h.productId) === Number(prod.id));
                    if(sIdx > -1) nextHubStock[sIdx].quantity -= q;
                    apiPromises.push(fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: source, productId: prod.id, sku: prod.sku, quantity: -q }) }));
                  }

                  // 2. ADD TO DESTINATION
                  if (dest === 'MASTER') {
                    currentMasterStock += q;
                  } else if (dest !== 'EXTERNAL') {
                    const dIdx = nextHubStock.findIndex(h => String(h.warehouseId) === String(dest) && Number(h.productId) === Number(prod.id));
                    if(dIdx > -1) nextHubStock[dIdx].quantity += q;
                    else nextHubStock.push({ id: 'temp', warehouseId: dest, productId: prod.id, sku: prod.sku, quantity: q });
                    apiPromises.push(fetch(`${API_BASE_URL}/warehouse-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: selectedCompany, warehouseId: dest, productId: prod.id, sku: prod.sku, quantity: q }) }));
                  }

                  // 3. LOG MOVEMENT
                  const logWarehouseId = (dest !== 'MASTER' && dest !== 'EXTERNAL') ? dest : ((source !== 'MASTER' && source !== 'EXTERNAL') ? source : null);
                  apiPromises.push(fetch(`${API_BASE_URL}/inventory-movements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: prod.id, productName: prod.name, sku: prod.sku, type: txModal.type, quantity: q, previousStock: prevMasterForLog, newStock: currentMasterStock, reference: txForm.reference, remarks: txForm.remarks, user: loginUsername, company: selectedCompany, warehouseId: logWarehouseId, batchNumber: txForm.batchNumber, expirationDate: txForm.expirationDate }) }));

                  // 4. MASTER STOCK PATCH
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
            }} className="p-8 flex flex-col gap-6 max-h-[75vh] overflow-y-auto bg-slate-50">
              
              {txModal.type !== 'ADJUST' && (
                <div className={`grid grid-cols-2 gap-5 p-5 rounded-2xl border ${txModal.type === 'RECEIVE' ? 'bg-emerald-50 border-emerald-200' : txModal.type === 'RETURN' ? 'bg-sky-50 border-sky-200' : 'bg-rose-50 border-rose-200'}`}>
                  <div className="flex flex-col gap-1.5">
                    <label className={`text-[10px] font-bold uppercase tracking-wider ${txModal.type === 'RECEIVE' ? 'text-emerald-700' : txModal.type === 'RETURN' ? 'text-sky-700' : 'text-rose-700'}`}>From (Source Location)</label>
                    {txModal.type === 'RETURN' ? (
                       <div className="px-4 py-3 border border-slate-200 rounded-xl font-bold bg-white text-slate-800 shadow-sm">Master / Office Stock</div>
                    ) : (
                       <select required value={movForm.sourceId} onChange={e=>setMovForm({...movForm, sourceId: e.target.value})} className="px-4 py-3 border border-white/50 rounded-xl font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-slate-400 cursor-pointer">
                         <option value="">Select Source...</option>
                         {txModal.type === 'RECEIVE' && <option value="EXTERNAL">External Supplier</option>}
                         {txModal.type === 'ISSUE' && <option value="MASTER">Master / Office Stock</option>}
                         {warehouses.map(w => <option key={w.id} value={w.id} disabled={movForm.destId === String(w.id)}>{w.name}</option>)}
                       </select>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={`text-[10px] font-bold uppercase tracking-wider ${txModal.type === 'RECEIVE' ? 'text-emerald-700' : txModal.type === 'RETURN' ? 'text-sky-700' : 'text-rose-700'}`}>To (Destination Location)</label>
                    {txModal.type === 'ISSUE' ? (
                       <div className="px-4 py-3 border border-slate-200 rounded-xl font-bold bg-white text-slate-800 shadow-sm">External (Client / Buyer)</div>
                    ) : (
                       <select required value={movForm.destId} onChange={e=>setMovForm({...movForm, destId: e.target.value})} className="px-4 py-3 border border-white/50 rounded-xl font-bold outline-none bg-white shadow-sm focus:ring-2 focus:ring-slate-400 cursor-pointer">
                         <option value="">Select Destination...</option>
                         <option value="MASTER">Master / Office Stock</option>
                         {warehouses.map(w => <option key={w.id} value={w.id} disabled={movForm.sourceId === String(w.id)}>{w.name}</option>)}
                       </select>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {txModal.type === 'ADJUST' ? 'Specify True Physical Counts' : 'Quantities To Transact'}
                </div>
                {txModal.products.map(p => {
                  const totalHubStock = hubStock.filter(h => (String(h.productId) === String(p.id) || String(h.sku) === String(p.sku)) && warehouses.some(w => String(w.id) === String(h.warehouseId))).reduce((acc, val) => acc + val.quantity, 0);
                  return (
                    <div key={p.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div>
                        <div className="text-base font-black uppercase text-slate-900">{p.name}</div>
                        <div className="text-xs font-semibold text-slate-500 mt-0.5">{p.sku} | Current Master: <strong className="text-blue-600">{p.currentStock} {p.unit}</strong> | Total Hubs: <strong className="text-slate-700">{totalHubStock} {p.unit}</strong></div>
                      </div>
                      <div className="w-full sm:w-auto flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {txModal.type === 'ADJUST' ? 'New True Master Stock' : `Quantity to ${txModal.type}`}
                        </label>
                        <input type="number" min={txModal.type === 'ADJUST' ? "0" : "1"} required placeholder="Enter quantity..." value={movQtys[p.id] !== undefined ? movQtys[p.id] : ''} onChange={e=>setMovQtys({...movQtys, [p.id]: e.target.value})} className={`px-4 py-2.5 border rounded-xl font-black outline-none focus:ring-2 text-slate-900 shadow-sm w-full sm:w-44 text-lg ${txModal.type === 'ADJUST' ? 'border-indigo-300 bg-indigo-50 focus:ring-indigo-500' : 'border-slate-300 focus:ring-blue-500 bg-slate-50 focus:bg-white'}`} />
                      </div>
                    </div>
                  );
                })}
              </div>

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