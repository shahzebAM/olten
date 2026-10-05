import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';

// --- INTERFACES ---
interface Product { 
  id: number; 
  company: string; 
  name: string; 
  sku: string; 
  category: string; 
  purchasePrice: number | string; 
  sellingPrice: number | string; 
  categoryPrices?: Record<string, number | string>; 
  minQuantity: number; 
  reorderLevel: number; 
  unit: string; 
  isActive: boolean; 
  vatSetting: string; 
  imageUrl: string; 
  barcode: string; 
  currentStock: number; 
  createdAt: string; 
  deletedAt: string | null; 
}

interface Movement { 
  id: string; 
  productId: number; 
  productName: string; 
  sku: string; 
  type: 'RECEIVE' | 'ISSUE' | 'ADJUST' | 'RETURN' | 'TRANSFER' | 'DELETE'; 
  quantity: number; 
  previousStock: number; 
  newStock: number; 
  reference: string; 
  remarks: string; 
  date: string; 
  user: string; 
  warehouseId?: string; 
  batchNumber?: string | null; 
  expirationDate?: string | null; 
  warehouse?: { id: number; name: string; }; 
}

interface Warehouse { 
  id: string; 
  name: string; 
  address: string; 
  status: string; 
}

interface WarehouseStock { 
  id: string; 
  warehouseId: string; 
  productId: number; 
  sku: string; 
  quantity: number; 
}

interface CustomerCategory { 
  id: string; 
  name: string; 
}

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
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [customerCategories, setCustomerCategories] = useState<CustomerCategory[]>([]);
  
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // --- FILTERS ---
  const [selectedHubFilter, setSelectedHubFilter] = useState<string>('ALL');
  const [warehouseSearchQuery, setWarehouseSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('ALL');
  const [selectedPricingTierFilter, setSelectedPricingTierFilter] = useState<string>('');

  const uniqueCategories = Array.from(new Set(products.map(p => p.category))).sort();

  // --- MODAL CONTROLLERS ---
  const [activeWarehouseModal, setActiveWarehouseModal] = useState<'REGISTER' | 'ADJUST' | 'TRANSFER' | null>(null);
  const [ledgerFilterType, setLedgerFilterType] = useState('ALL');
  const [ledgerStartDate, setLedgerStartDate] = useState('');
  const [ledgerEndDate, setLedgerEndDate] = useState('');

  const [productModal, setProductModal] = useState<{ isOpen: boolean; editingId: number | null }>({ isOpen: false, editingId: null });
  const [txModal, setTxModal] = useState<{ isOpen: boolean; products: Product[]; type: 'RECEIVE' | 'ISSUE' | 'ADJUST' | 'RETURN' }>({ isOpen: false, products: [], type: 'RECEIVE' });
  const [bulkPricingModal, setBulkPricingModal] = useState({ isOpen: false, tier: '', percentage: '' });

  // --- RECEIVING MODAL STATES ---
  const [placementPo, setPlacementPo] = useState<any>(null);
  const [placementDestinations, setPlacementDestinations] = useState<Record<string, string>>({});

  const initialProductForm: any = { name: '', sku: '', category: 'General', purchasePrice: '', sellingPrice: 0, categoryPrices: {}, minQuantity: 10, reorderLevel: 20, unit: 'pcs', isActive: true, vatSetting: 'Vatable', imageUrl: '', barcode: '', previousImageUrl: '', initialQuantity: 0, warehouseId: '', batchNumber: '', expirationDate: '' };
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
  const [expandedWarehouseId, setExpandedWarehouseId] = useState<string | null>(null);
  const [localAccordionSearch, setLocalAccordionSearch] = useState<Record<string, string>>({});

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

  const fetchAllData = useCallback(async () => {
    try {
      const [prodRes, movRes, whRes, stkRes, poRes, catRes] = await Promise.all([
        fetch(`${API_BASE_URL}/products?company=${encodeURIComponent(selectedCompany)}`),
        fetch(`${API_BASE_URL}/inventory-movements?company=${encodeURIComponent(selectedCompany)}`),
        fetch(`${API_BASE_URL}/warehouses?company=${encodeURIComponent(selectedCompany)}`),
        fetch(`${API_BASE_URL}/warehouse-stock?company=${encodeURIComponent(selectedCompany)}`),
        fetch(`${API_BASE_URL}/procurement/purchase-orders?company=${encodeURIComponent(selectedCompany)}`),
        fetch(`${API_BASE_URL}/sales/customer-categories?company=${encodeURIComponent(selectedCompany)}`)
      ]);
      
      let productsList: Product[] = [];
      if (prodRes.ok) { 
        productsList = await prodRes.json(); 
        updateImageVault(productsList); 
      }
      if (movRes.ok) setMovements(await movRes.json());
      if (whRes.ok) setWarehouses(await whRes.json());
      if (stkRes.ok) setHubStock(await stkRes.json());
      if (poRes.ok) setPurchaseOrders(await poRes.json());
      
      if (catRes.ok) {
        const categories = await catRes.json();
        setCustomerCategories(categories);

        if (categories.length > 0 && !selectedPricingTierFilter) {
            setSelectedPricingTierFilter(categories[0].name);
        }
        
        try {
            const pricePromises = categories.map(async (cat: any) => {
                const res = await fetch(`${API_BASE_URL}/sales/category-prices?company=${encodeURIComponent(selectedCompany)}&categoryName=${encodeURIComponent(cat.name)}`);
                if (res.ok) {
                    const data = await res.json();
                    return { catName: cat.name, data: Array.isArray(data) ? data : (data.data || []) };
                }
                return { catName: cat.name, data: [] };
            });

            const categoryPriceResults = await Promise.all(pricePromises);
            const priceMap: Record<number, Record<string, number>> = {};
            
            categoryPriceResults.forEach(result => {
                result.data.forEach((p: any) => {
                    const pid = Number(p.productId || p.product?.id);
                    if (!isNaN(pid) && pid > 0) {
                        if (!priceMap[pid]) priceMap[pid] = {};
                        priceMap[pid][result.catName] = Number(p.price);
                    }
                });
            });
            
            productsList = productsList.map(prod => ({
                ...prod,
                categoryPrices: priceMap[Number(prod.id)] || {}
            }));
        } catch(e) {
            console.error("Error fetching category prices", e);
        }
      }
      setProducts(productsList);
    } catch (e) { 
      console.error("API Error", e); 
    }
  }, [API_BASE_URL, selectedCompany, selectedPricingTierFilter]);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  const pendingReceivables = purchaseOrders.filter(po => po.status === 'Received' || po.status === 'Partially Received');

  const toggleSelection = (id: number) => setSelectedProductIds((prev: number[]) => prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]);
  const toggleSelectAll = (filtered: Product[]) => {
    if (selectedProductIds.length === filtered.length) setSelectedProductIds([]);
    else setSelectedProductIds(filtered.map(p => p.id));
  };

  const handleDeleteProducts = async (ids: number[]) => {
    if (!isAuthorizedAdmin) return showToast("Only Administrators can delete products.", "error");
    if (!window.confirm(`Are you sure you want to permanently delete ${ids.length} product(s)? This will also erase their entire movement history and stock records.`)) return;
    
    setIsProcessing(true);
    try {
      await Promise.all(ids.map(id => fetch(`${API_BASE_URL}/products/${id}`, { method: 'DELETE' })));
      
      setProducts(prev => prev.filter(p => !ids.includes(p.id)));
      setSelectedProductIds(prev => prev.filter(id => !ids.includes(id)));
      showToast(`Successfully deleted ${ids.length} product(s).`, "success");
      
      ids.forEach(id => {
        const prod = products.find(p => p.id === id);
        if (prod && prod.sku) {
           delete globalImageVault[prod.sku];
           delete deletedImageVault[prod.sku];
        }
      });
    } catch (e) {
      showToast("Failed to delete some products. They may be locked.", "error");
    } finally {
      setIsProcessing(false);
    }
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
          setProductForm((prev: any) => ({ ...prev, imageUrl: compressedBase64 }));
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    const cleanPayload: any = {
      name: productForm.name,
      sku: productForm.sku,
      category: productForm.category || 'General',
      purchasePrice: parseFloat(String(productForm.purchasePrice)) || 0,
      sellingPrice: 0,
      minQuantity: parseInt(String(productForm.minQuantity)) || 10,
      reorderLevel: parseInt(String(productForm.reorderLevel)) || 20,
      unit: productForm.unit || 'pcs',
      vatSetting: productForm.vatSetting || 'NONE',
      imageUrl: productForm.imageUrl || null,
      barcode: productForm.barcode || productForm.sku.toUpperCase(),
      company: selectedCompany,
    };

    if (!productModal.editingId) {
      cleanPayload.initialQuantity = parseInt(String(productForm.initialQuantity)) || 0;
      cleanPayload.batchNumber = productForm.batchNumber || null;
      cleanPayload.expirationDate = productForm.expirationDate || null;
      cleanPayload.username = loginUsername;
    }

    if (cleanPayload.sku) {
  if (cleanPayload.imageUrl) {
    globalImageVault[cleanPayload.sku] = cleanPayload.imageUrl;
  } else {
    delete globalImageVault[cleanPayload.sku];
  }
  // Always clear the temporary deleted memory on a successful save
  delete deletedImageVault[cleanPayload.sku]; 
}

    const rawPricesToSave = productForm.categoryPrices || {};
    const sanitizedPricesToSave: Record<string, number> = {};
    
    Object.keys(rawPricesToSave).forEach(cat => {
        if (rawPricesToSave[cat] !== '' && rawPricesToSave[cat] !== null && rawPricesToSave[cat] !== undefined) {
           const val = parseFloat(String(rawPricesToSave[cat]));
           if (!isNaN(val)) sanitizedPricesToSave[cat] = val;
        }
    });

    const tempId = productModal.editingId || Date.now();
    
    setProducts((prev: Product[]) => {
      if (productModal.editingId) {
        return prev.map(p => p.id === tempId ? { ...p, ...cleanPayload, categoryPrices: sanitizedPricesToSave } as Product : p);
      }
      return [{ ...cleanPayload, id: tempId, currentStock: cleanPayload.initialQuantity || 0, categoryPrices: sanitizedPricesToSave } as Product, ...prev];
    });

    try {
        const url = productModal.editingId ? `${API_BASE_URL}/products/${productModal.editingId}` : `${API_BASE_URL}/products`;
        const res = await fetch(url, { 
          method: productModal.editingId ? 'PATCH' : 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(cleanPayload) 
        });
        if (!res.ok) throw new Error(`Product sync failed (${res.status})`);
        
        const resData = await res.json();
        const finalProductId = Number(productModal.editingId || resData.id || tempId);
        
        if (Object.keys(sanitizedPricesToSave).length > 0) {
            const pricePromises = Object.entries(sanitizedPricesToSave).map(([catName, price]) => {
                return fetch(`${API_BASE_URL}/sales/category-prices/bulk`, {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        company: selectedCompany, 
                        categoryName: catName, 
                        prices: [{ productId: finalProductId, price: Number(price) }] 
                    })
                });
            });
            await Promise.allSettled(pricePromises);
        }
        
        showToast("Product and pricing successfully saved.", "success");
        setProductModal({ isOpen: false, editingId: null });
        setProductForm(initialProductForm);
        
        setTimeout(async () => {
            await fetchAllData(); 
            setIsProcessing(false);
        }, 1000);
        
    } catch (error: any) { 
        showToast(`Sync Error: ${error.message}`, "error"); 
        await fetchAllData(); 
        setIsProcessing(false);
    }
  };

  const handleBulkPricingSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!bulkPricingModal.tier || !bulkPricingModal.percentage) return showToast("Please fill all required fields.", "error");

      const pct = parseFloat(bulkPricingModal.percentage);
      if (isNaN(pct)) return showToast("Please enter a valid percentage number.", "error");

      if (!window.confirm(`Adjust all product prices for the "${bulkPricingModal.tier}" tier by ${pct}%?`)) return;

      setIsProcessing(true);

      const payload = products.map(p => {
          let basePrice = Number(p.categoryPrices?.[bulkPricingModal.tier]);
          if (isNaN(basePrice) || basePrice <= 0) {
              basePrice = Number(p.purchasePrice) || 0;
          }
          
          const newPrice = basePrice > 0 ? basePrice * (1 + (pct / 100)) : 0;
          return { productId: Number(p.id), price: Number(newPrice.toFixed(2)) };
      }).filter(item => item.price > 0);

      if (payload.length === 0) {
          setIsProcessing(false);
          return showToast("No items with a non-zero base price were found to adjust.", "error");
      }

      setProducts((prev: Product[]) => prev.map(p => {
          let basePrice = Number(p.categoryPrices?.[bulkPricingModal.tier]);
          if (isNaN(basePrice) || basePrice <= 0) {
              basePrice = Number(p.purchasePrice) || 0;
          }
          const newPrice = basePrice > 0 ? basePrice * (1 + (pct / 100)) : 0;
          if (newPrice > 0) {
              return { ...p, categoryPrices: { ...(p.categoryPrices || {}), [bulkPricingModal.tier]: Number(newPrice.toFixed(2)) } };
          }
          return p;
      }));

      try {
          const res = await fetch(`${API_BASE_URL}/sales/category-prices/bulk`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                company: selectedCompany, 
                categoryName: bulkPricingModal.tier, 
                prices: payload 
              })
          });

          if (!res.ok) throw new Error(`Server returned error ${res.status}`);
          
          showToast(`Applied ${pct}% adjustment to ${payload.length} products in ${bulkPricingModal.tier}.`, "success");
          setBulkPricingModal({ isOpen: false, tier: '', percentage: '' });
          
          setTimeout(async () => {
            await fetchAllData();
            setIsProcessing(false);
          }, 1000);
      } catch (err: any) {
          showToast(`Bulk Sync Error: ${err.message}`, "error");
          setIsProcessing(false);
          fetchAllData(); 
      }
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

  const handlePlacePoItems = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!placementPo) return;
    setIsProcessing(true);

    const apiPromises: Promise<any>[] = []; 
    let nextProducts = [...products];
    let nextHubStock = [...hubStock];

    try {
      for (const item of placementPo.items) {
        if (!item.confirmedQty || item.confirmedQty <= 0) continue;

        const prod = products.find(p => p.sku === item.sku || String(p.id) === String(item.productId));
        if (!prod) continue; 

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

  const handleExportExcel = () => {
    try {
      const exportData = products.map(p => ({
        "SKU": p.sku, "Product Name": p.name, "Category": p.category,
        "Cost Price (₱)": p.purchasePrice, "Tier Price (₱)": p.categoryPrices?.[selectedPricingTierFilter] || 0,
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

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategoryFilter === 'ALL' || p.category === selectedCategoryFilter;
    return matchesSearch && matchesCategory;
  });

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
            { id: 'receiving', label: 'Receiving', badge: pendingReceivables.length }
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
        
        {/* RESPONSIVE HEADER */}
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

       {/* LOCKED MAIN CONTAINER PREVENTS EXTERNAL SCROLLING */}
        <main className="flex-1 flex flex-col bg-[#F8FAFC] overflow-hidden min-h-0">
          
        {/* VIEW: PRODUCTS */}
          {activeView === 'products' && (
            <div className="flex flex-col flex-1 h-full w-full max-w-[1600px] mx-auto animate-in fade-in duration-300 p-4 sm:p-6 gap-4 min-h-0">
              
              <div className="flex flex-col lg:flex-row justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm shrink-0">
                <div className="flex flex-1 flex-col xl:flex-row gap-3">
                  {/* CATEGORY FILTER DROPDOWN */}
                  <select 
                    value={selectedCategoryFilter} 
                    onChange={(e) => setSelectedCategoryFilter(e.target.value)} 
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer text-slate-700 w-full xl:w-48 appearance-none"
                  >
                    <option value="ALL">All Prod Categories</option>
                    {uniqueCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>

                  {/* CUSTOMER PRICING TIER FILTER DROPDOWN */}
                  <select 
                    value={selectedPricingTierFilter} 
                    onChange={(e) => setSelectedPricingTierFilter(e.target.value)} 
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer text-slate-700 w-full xl:w-48 appearance-none"
                  >
                    {customerCategories.length === 0 && <option value="">No Tiers Available</option>}
                    {customerCategories.map(cat => (
                      <option key={cat.id} value={cat.name}>Tier: {cat.name}</option>
                    ))}
                  </select>

                  <select 
                    value={selectedHubFilter} 
                    onChange={(e) => setSelectedHubFilter(e.target.value)} 
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer text-slate-700 w-full xl:w-48 appearance-none"
                  >
                    <option value="ALL">All Hubs (Combined)</option>
                    {warehouses.map(w => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
                  </select>
                </div>
                
                <div className="flex flex-wrap gap-2 shrink-0">
                  {isAuthorizedAdmin && customerCategories.length > 0 && (
                    <button onClick={() => setBulkPricingModal({ isOpen: true, tier: customerCategories[0]?.name || '', percentage: '' })} className="w-full sm:w-auto px-5 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 font-bold uppercase text-[10px] rounded-xl shadow-sm hover:bg-amber-100 transition-colors">Bulk Pricing</button>
                  )}
                  {isAuthorizedAdmin && (
                    <button onClick={handleExportExcel} className="w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold uppercase text-[10px] rounded-xl shadow-sm hover:bg-slate-50 transition-colors">Export Excel</button>
                  )}
                  <button onClick={() => { setProductForm(initialProductForm); setProductModal({ isOpen: true, editingId: null }); }} className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 text-white font-bold uppercase text-[10px] rounded-xl shadow-sm hover:bg-blue-700 transition-colors">+ Register Item</button>
                </div>
              </div>

              {selectedProductIds.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in slide-in-from-top-2 shrink-0">
                  <div className="font-black text-blue-900 uppercase text-xs tracking-widest px-2">{selectedProductIds.length} ITEMS SELECTED</div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openBulkTx('RECEIVE')} className="px-4 py-2 bg-emerald-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-emerald-600 transition-colors">Receive</button>
                    <button onClick={() => openBulkTx('RETURN')} className="px-4 py-2 bg-sky-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-sky-600 transition-colors">Return to Hub</button>
                    <button onClick={() => openBulkTx('ISSUE')} className="px-4 py-2 bg-amber-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-amber-600 transition-colors">Issue</button>
                    <button onClick={() => openBulkTx('ADJUST')} className="px-4 py-2 bg-indigo-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-indigo-600 transition-colors">Adjust Master</button>
                    {isAuthorizedAdmin && (
                      <button onClick={() => handleDeleteProducts(selectedProductIds)} className="px-4 py-2 bg-rose-500 text-white font-bold uppercase text-[10px] rounded-lg shadow-sm hover:bg-rose-600 transition-colors ml-2 border border-rose-600">Delete</button>
                    )}
                  </div>
                </div>
              )}

              {/* STICKY SCROLLING TABLE CONTAINER */}
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-0">
                <div className="flex-1 overflow-auto w-full relative">
                  <table className="w-full text-left text-xs border-collapse table-fixed min-w-[1200px]">
                    <thead className="bg-slate-50 sticky top-0 z-20 shadow-sm border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4 w-12 text-center border-b border-slate-200 align-middle">
                          <input type="checkbox" checked={selectedProductIds.length === filteredProducts.length && filteredProducts.length > 0} onChange={() => toggleSelectAll(filteredProducts)} className="w-3.5 h-3.5 rounded border-slate-300 cursor-pointer" />
                        </th>
                        <th className="py-2 px-4 w-[30%] border-b border-slate-200 align-middle">
                          <div className="relative">
                            <svg className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            <input 
                              type="text" 
                              placeholder="SEARCH SKU OR NAME..." 
                              value={searchQuery} 
                              onChange={(e) => setSearchQuery(e.target.value)} 
                              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 transition-shadow shadow-sm" 
                            />
                          </div>
                        </th>
                        <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] w-[12%] border-b border-slate-200 align-middle">Category</th>
                        <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] w-[15%] border-b border-slate-200 align-middle">
                          {selectedPricingTierFilter ? `Tier: ${selectedPricingTierFilter}` : 'Tier Price'}
                        </th>
                        <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] text-center w-[10%] border-b border-slate-200 align-middle">Master Stock</th>
                        <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] text-center w-[10%] border-b border-slate-200 align-middle">
                          {selectedHubFilter === 'ALL' ? 'Hub Stock (All)' : `Hub Stock`}
                        </th>
                        <th className="py-3 px-4 font-black text-slate-500 uppercase tracking-widest text-[9px] text-center w-[20%] border-b border-slate-200 align-middle">Settings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredProducts.length === 0 ? (
                        <tr><td colSpan={7} className="py-12 text-center text-slate-400 font-medium">No items found matching your filters.</td></tr>
                      ) : (
                        filteredProducts.map(p => {
                          const displayPrice = Number(p.categoryPrices?.[selectedPricingTierFilter] || 0);
                            
                          return (
                            <tr key={p.id} className={`hover:bg-slate-50 transition-colors group ${selectedProductIds.includes(p.id) ? 'bg-blue-50/20' : ''}`}>
                              <td className="py-2.5 px-4 text-center align-middle">
                                <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleSelection(p.id)} className="w-3.5 h-3.5 rounded border-slate-300 cursor-pointer" />
                              </td>
                          <td className="py-2.5 px-4 align-middle">
                                <div className="flex items-center gap-3">
                                  {p.imageUrl && typeof p.imageUrl === 'string' && p.imageUrl.length > 0 ? (
                                    <img src={p.imageUrl} alt={p.name} className="w-10 h-10 rounded-lg object-cover border border-slate-200 cursor-pointer shadow-sm shrink-0" onClick={() => setPreviewImage(p.imageUrl || '')} />
                                  ) : (
                                    <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-[8px] font-bold uppercase text-center text-slate-300 cursor-pointer shrink-0" onClick={() => { if(globalImageVault[p.sku]) setPreviewImage(globalImageVault[p.sku]); }}>No Img</div>
                                  )}
                                  <div className="min-w-0 flex flex-col items-start">
                                    <div className="font-bold text-xs text-slate-900 uppercase leading-tight truncate">{p.name}</div>
                                    <div className="mt-1 font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-100 truncate shadow-sm">{p.sku}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-4 align-middle text-[10px] font-bold text-slate-600 uppercase truncate">
                                <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{p.category}</span>
                              </td>
                           <td className="py-2.5 px-4 align-middle">
                                <div className="font-mono text-sm font-black text-amber-600 mb-1.5">
                                  ₱{displayPrice.toFixed(2)}
                                </div>
                                <div className="inline-flex items-center gap-1.5 font-mono text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 shadow-sm">
                                  <span className="text-[9px] uppercase tracking-widest text-emerald-600/70">COST</span>
                                  ₱{Number(p.purchasePrice).toFixed(2)}
                                </div>
                              </td>
                              <td className="py-2.5 px-4 align-middle text-center">
                                <div className={`font-mono text-sm font-black ${p.currentStock <= p.reorderLevel ? 'text-rose-600' : 'text-slate-700'}`}>{p.currentStock} <span className="text-[9px] text-slate-400 font-sans">{p.unit}</span></div>
                              </td>
                              <td className="py-2.5 px-4 align-middle text-center">
                                {(() => {
                                  const filteredHubList = hubStock.filter(h => {
                                    const isMatch = (String(h.productId) === String(p.id) || String(h.sku) === String(p.sku));
                                    if (!isMatch) return false;
                                    if (selectedHubFilter === 'ALL') return warehouses.some(w => String(w.id) === String(h.warehouseId));
                                    return String(h.warehouseId) === String(selectedHubFilter);
                                  });
                                  const displayQty = filteredHubList.reduce((acc, val) => acc + val.quantity, 0);
                                  return <div className="font-mono text-sm font-black text-slate-700">{displayQty} <span className="text-[9px] text-slate-400 font-sans">{p.unit}</span></div>;
                                })()}
                              </td>
                              <td className="py-2.5 px-4 align-middle text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => openTx([p], 'RECEIVE')} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors" title="Receive into Master Stock">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 11l5-5m0 0l5 5m-5-5v12" /></svg>
                                  </button>
                                  <button onClick={() => openTx([p], 'RETURN')} className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors" title="Return to Warehouse Hub">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                  </button>
                                  <button onClick={() => openTx([p], 'ISSUE')} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors" title="Issue to External Client">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 13l-5 5m0 0l-5-5m5 5V6" /></svg>
                                  </button>
                                  <button onClick={() => openTx([p], 'ADJUST')} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="Adjust Physical Master Stock">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                  </button>
                                  <div className="w-px h-4 bg-slate-200 mx-1"></div>
                                  <button onClick={() => { setProductForm({ ...p, previousImageUrl: deletedImageVault[p.sku] || globalImageVault[p.sku] || '', categoryPrices: { ...(p.categoryPrices || {}) } }); setProductModal({ isOpen: true, editingId: p.id }); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Edit Product Specs">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                  </button>
                                  {isAuthorizedAdmin && (
                                    <button onClick={() => handleDeleteProducts([p.id])} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors ml-0.5" title="Permanently Delete Item">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              
              {/* COMPACT FOOTER */}
              <div className="p-2 bg-slate-50 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest shrink-0 rounded-b-2xl -mt-4 border-t border-slate-200">
                <div className="px-2">Showing {filteredProducts.length} Items</div>
              </div>
            </div>
          )}

          {/* VIEW: RECEIVING (NEW P.O. PLACEMENT QUEUE) */}
          {activeView === 'receiving' && (
            <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300 p-4 sm:p-6">
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
            <div className="flex flex-col flex-1 h-full w-full max-w-[1600px] mx-auto animate-in fade-in duration-300 p-4 sm:p-6 gap-4 min-h-0">
              
              {/* FILTERS CONTAINER */}
              <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end bg-white p-4 rounded-2xl border border-slate-200 shadow-sm shrink-0">
                <div className="flex flex-col gap-1 w-full sm:w-auto sm:flex-1">
                  <label className="text-[10px] font-bold uppercase text-slate-500">Transaction Type</label>
                  <select value={ledgerFilterType} onChange={e => setLedgerFilterType(e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-bold outline-none text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer">
                    <option value="ALL">All Transactions</option>
                    <option value="RECEIVE">Receives</option>
                    <option value="ISSUE">Issues</option>
                    <option value="RETURN">Returns</option>
                    <option value="TRANSFER">Transfers</option>
                    <option value="ADJUST">Adjustments</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 w-full sm:w-auto sm:flex-1">
                  <label className="text-[10px] font-bold uppercase text-slate-500">Start Date</label>
                  <input type="date" value={ledgerStartDate} onChange={e => setLedgerStartDate(e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-bold outline-none text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1 w-full sm:w-auto sm:flex-1">
                  <label className="text-[10px] font-bold uppercase text-slate-500">End Date</label>
                  <input type="date" value={ledgerEndDate} onChange={e => setLedgerEndDate(e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-bold outline-none text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex w-full sm:w-auto sm:ml-auto">
                  <button onClick={() => { setLedgerFilterType('ALL'); setLedgerStartDate(''); setLedgerEndDate(''); }} className="w-full sm:w-auto px-5 py-2.5 border border-slate-200 rounded-xl font-bold uppercase text-xs hover:bg-slate-50 transition-colors h-[42px]">Clear Filters</button>
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
            <div className="flex flex-col h-full w-full max-w-[1600px] mx-auto animate-in fade-in duration-300 space-y-4 p-4 sm:p-6 min-h-0">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm shrink-0">
                 
                 {/* SEARCH BAR MOVED HERE */}
                 <div className="relative w-full sm:w-80 shrink-0">
                   <svg className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                   <input type="text" placeholder="SEARCH HUBS OR ITEMS..." value={warehouseSearchQuery} onChange={(e) => setWarehouseSearchQuery(e.target.value)} className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 transition-shadow shadow-sm" />
                 </div>
                 
                 {/* Compact Action Buttons */}
                 <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                   {isAuthorizedAdmin && ( <button onClick={() => { setEditingWarehouseId(null); setWarehouseForm({name: '', address: '', status: 'Active'}); setActiveWarehouseModal('REGISTER'); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold uppercase text-[10px] shadow-sm hover:bg-blue-700 transition-colors">+ Register</button> )}
                   <button onClick={() => setActiveWarehouseModal('ADJUST')} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold uppercase text-[10px] shadow-sm hover:bg-indigo-700 transition-colors">Adjust Stock</button>
                   <button onClick={() => setActiveWarehouseModal('TRANSFER')} className="px-4 py-2 bg-amber-500 text-white rounded-lg font-bold uppercase text-[10px] shadow-sm hover:bg-amber-600 transition-colors">Transfer</button>
                 </div>
              </div>
              {/* GRID ACCORDION LAYOUT */}
              <div className="flex-1 overflow-y-auto min-h-0 pt-4 pb-12">
                 {displayedWarehouses.length === 0 ? (
                    <div className="text-center text-slate-400 font-bold py-12">No facilities found.</div>
                 ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                      {displayedWarehouses.map(w => {
                        const whStocks = hubStock.filter(h => String(h.warehouseId) === String(w.id) && h.quantity > 0);
                     const filteredWhStocks = whStocks.filter(stk => {
  const p = products.find(prod => Number(prod.id) === Number(stk.productId) || String(prod.sku) === String(stk.sku));
  
  // 1. Filter by the local accordion search box
  const localQ = (localAccordionSearch[w.id] || '').toLowerCase();
  if (localQ && !(p?.name.toLowerCase().includes(localQ) || stk.sku.toLowerCase().includes(localQ))) {
     return false;
  }

  // 2. Existing global warehouse search logic
  if (!warehouseSearchQuery) return true;
  const q = warehouseSearchQuery.toLowerCase();
  if (w.name.toLowerCase().includes(q) || w.address.toLowerCase().includes(q)) return true;
  return p?.name.toLowerCase().includes(q) || stk.sku.toLowerCase().includes(q);
});

                        const isExpanded = expandedWarehouseId === w.id;

                        return (
                          <div key={w.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col transition-all duration-300">
                             {/* ACCORDION HEADER */}
                             <button 
                               onClick={() => setExpandedWarehouseId(isExpanded ? null : w.id)}
                               className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
                             >
                                <div className="flex-1 min-w-0 pr-4">
                                   <div className="font-black text-slate-900 uppercase text-sm truncate">{w.name}</div>
                                   <div className="text-[10px] font-bold text-slate-500 mt-1 truncate">{w.address || `WH-${w.id.toString().padStart(3, '0')}`}</div>
                                </div>
                                <div className="shrink-0 text-slate-400 bg-slate-100 p-2 rounded-full">
                                  <svg className={`w-4 h-4 transform transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                             </button>

                             {/* ACCORDION BODY (STOCKS) */}
                             {isExpanded && (
                               <div className="px-5 pb-5 pt-2 border-t border-slate-100 bg-slate-50 animate-in slide-in-from-top-2">
                                 <div className="flex justify-between items-center mb-3 gap-3">
  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0">
    Stored Assets ({filteredWhStocks.length})
  </div>
  <input 
    type="text" 
    placeholder="Filter this hub..." 
    value={localAccordionSearch[w.id] || ''} 
    onChange={(e) => setLocalAccordionSearch(prev => ({ ...prev, [w.id]: e.target.value }))} 
    className="w-full max-w-[160px] px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-[10px] font-bold uppercase outline-none focus:border-slate-400 shadow-sm"
  />
</div>
                                  <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                                    {whStocks.length === 0 ? ( 
                                      <span className="text-xs text-slate-400 font-medium italic">Facility is currently empty.</span> 
                                    ) : filteredWhStocks.length === 0 && warehouseSearchQuery ? ( 
                                      <span className="text-xs text-slate-400 font-medium italic">No matching items inside.</span> 
                                    ) : (
                                      filteredWhStocks.map(stk => {
                                        const p = products.find(prod => Number(prod.id) === Number(stk.productId) || String(prod.sku) === String(stk.sku));
                                        return (
                                          <div key={stk.id} className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-slate-200 shadow-sm">
                                         <div className="flex flex-col min-w-0 flex-1 mr-3 items-start">
  <div className="text-xs font-bold uppercase text-slate-900 truncate w-full">{p?.name || stk.sku}</div>
  <div className="mt-1.5 font-mono text-[10px] font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 shadow-sm">{p?.sku}</div>
</div>
                                            <div className="text-xs font-black text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100 shrink-0 shadow-sm">
                                              {stk.quantity} <span className="text-[8px] text-blue-400">{p?.unit}</span>
                                            </div>
                                          </div>
                                        )
                                      })
                                    )}
                                  </div>
                               </div>
                             )}
                          </div>
                        );
                      })}
                    </div>
                 )}
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

      {/* BULK PRICING MODAL */}
      {bulkPricingModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-amber-50">
              <h2 className="text-xl font-black text-amber-900 uppercase tracking-tight">Bulk Pricing</h2>
              <button onClick={() => setBulkPricingModal({ isOpen: false, tier: '', percentage: '' })} className="p-2 text-amber-400 hover:text-amber-600 hover:bg-amber-100 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleBulkPricingSubmit} className="p-8 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Target Tier *</label>
                <select required value={bulkPricingModal.tier} onChange={e=>setBulkPricingModal({...bulkPricingModal, tier: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer bg-white">
                  <option value="">Select Tier...</option>
                  {customerCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Adjustment (%) *</label>
                <input required type="number" step="0.01" value={bulkPricingModal.percentage} onChange={e=>setBulkPricingModal({...bulkPricingModal, percentage: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-amber-500 shadow-sm" placeholder="e.g. 10 or -5" />
                <span className="text-[9px] font-medium text-slate-400 mt-1">Calculated from the current Tier Price (or Cost Price if unset).</span>
              </div>

              <button type="submit" disabled={isProcessing} className="mt-4 w-full py-3.5 bg-amber-500 text-white rounded-xl font-bold uppercase tracking-wider hover:bg-amber-600 transition-colors shadow-sm disabled:opacity-50">Apply to All Products</button>
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
                
                {/* IMAGE UPLOAD UI */}
                <div className="md:col-span-2 flex items-center gap-6 bg-white p-4 border border-slate-200 rounded-2xl shadow-sm">
                  <div className="relative group">
                    {productForm.imageUrl || productForm.previousImageUrl ? (
                      <>
                        <img src={productForm.imageUrl || productForm.previousImageUrl} alt="Preview" className="w-20 h-20 rounded-xl object-cover border border-slate-200 shadow-sm" />
                        <button 
                          type="button" 
                          onClick={() => {
                            if (productForm.previousImageUrl) {
                              deletedImageVault[productForm.sku] = productForm.previousImageUrl;
                              delete globalImageVault[productForm.sku];
                            }
                            setProductForm((prev: any) => ({ ...prev, imageUrl: null, previousImageUrl: '' }));
                          }} 
                          className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-rose-600"
                          title="Remove Image"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2 shrink-0">
                        <div className="w-20 h-20 rounded-xl bg-slate-100 border border-slate-200 border-dashed flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase text-center">No Img</div>
                     {deletedImageVault[productForm.sku] && (
  <button 
    type="button" 
    onClick={() => {
      // Restore image from deleted vault back to form and global vault
      setProductForm((prev: any) => ({ ...prev, previousImageUrl: deletedImageVault[productForm.sku] }));
      globalImageVault[productForm.sku] = deletedImageVault[productForm.sku];
      delete deletedImageVault[productForm.sku];
    }}
    className="text-[9px] font-black text-sky-600 bg-sky-50 hover:bg-sky-100 px-3 py-1 rounded-md uppercase tracking-widest border border-sky-200 transition-colors shadow-sm"
  >
    Restore
  </button>
)}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Product Image</label>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleModalImageUpload} 
                      className="text-sm font-medium text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:uppercase file:tracking-widest file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Name *</label><input required type="text" value={productForm.name} onChange={e=>setProductForm((prev: any) => ({...prev, name: e.target.value}))} className="px-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" /></div>
                <div className="flex flex-col gap-1.5"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">SKU *</label><input required type="text" value={productForm.sku} onChange={e=>setProductForm((prev: any) => ({...prev, sku: e.target.value}))} className="px-4 py-3 border border-slate-200 rounded-xl font-bold uppercase outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" /></div>
                <div className="flex flex-col gap-1.5 md:col-span-2"><label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Cost Price (₱)</label><div className="relative"><span className="absolute left-4 top-3 text-slate-400 font-bold">₱</span><input required type="number" step="0.01" value={productForm.purchasePrice ?? ''} onChange={e=>setProductForm((prev: any) => ({...prev, purchasePrice: e.target.value}))} className="w-full pl-8 pr-4 py-3 border border-slate-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" /></div></div>
                
                {/* DYNAMIC CATEGORY PRICING UI */}
                {customerCategories.length > 0 && (
                  <div className="md:col-span-2 mt-2">
                     <h3 className="font-black text-slate-900 uppercase text-xs tracking-tight mb-3">Customer Category Pricing Overrides</h3>
                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                       {customerCategories.map(cat => (
                          <div key={cat.id} className="flex flex-col gap-1.5 p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                            <label className="text-[10px] font-bold uppercase text-amber-600 tracking-wider">{cat.name} Tier Price</label>
                            <div className="relative">
                              <span className="absolute left-3 top-2 text-slate-400 font-bold text-xs">₱</span>
                              <input 
                                type="number" 
                                step="0.01" 
                                placeholder="Enter Price..."
                                value={productForm.categoryPrices?.[cat.name] ?? ''} 
                                onChange={e => {
                                  setProductForm((prev: any) => ({
                                    ...prev,
                                    categoryPrices: {
                                      ...(prev.categoryPrices || {}),
                                      [cat.name]: e.target.value
                                    }
                                  }));
                                }} 
                                className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500 shadow-sm" 
                              />
                            </div>
                          </div>
                       ))}
                     </div>
                  </div>
                )}
              </div>
              
              {!productModal.editingId && (
                <div className="p-6 bg-white border border-slate-200 rounded-2xl shadow-sm mt-2">
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

      {/* ADJUST HUB STOCK MODAL */}
      {activeWarehouseModal === 'ADJUST' && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-50">
              <h2 className="text-xl font-black text-indigo-900 uppercase tracking-tight">Adjust Hub Stock</h2>
              <button onClick={() => { setActiveWarehouseModal(null); setDirectStockForm({ warehouseId: '', productId: '', quantity: '' }); setProductSearchTerm(''); }} className="p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleDirectStockSubmit} className="p-8 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Select Warehouse</label>
                <select required value={directStockForm.warehouseId} onChange={e=>setDirectStockForm({...directStockForm, warehouseId: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer bg-white">
                  <option value="">Choose facility...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 relative">
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Search Product</label>
                <input type="text" placeholder="Search SKU or Name..." value={productSearchTerm} onChange={e => { setProductSearchTerm(e.target.value); setIsProductDropdownOpen(true); }} onClick={() => setIsProductDropdownOpen(true)} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" />
                {isProductDropdownOpen && productSearchTerm && (
                  <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-10">
                    {filteredProductsForDropdown.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400 font-medium">No items found.</div>
                    ) : (
                      filteredProductsForDropdown.map(p => (
                        <div key={p.id} onClick={() => { setDirectStockForm({...directStockForm, productId: String(p.id)}); setProductSearchTerm(`${p.sku} - ${p.name}`); setIsProductDropdownOpen(false); }} className="p-3 hover:bg-indigo-50 cursor-pointer border-b border-slate-50 last:border-0 flex justify-between items-center transition-colors">
                          <div className="font-bold text-xs text-slate-800 uppercase">{p.name}</div>
                          <div className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{p.sku}</div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Adjustment Quantity (Use - for negative)</label>
                <input required type="number" value={directStockForm.quantity} onChange={e=>setDirectStockForm({...directStockForm, quantity: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" placeholder="e.g. 50 or -10" />
              </div>
              <button type="submit" disabled={isProcessing || !directStockForm.productId} className="mt-4 w-full py-3.5 bg-indigo-600 text-white rounded-xl font-bold uppercase tracking-wider hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50">Apply Adjustment</button>
            </form>
          </div>
        </div>
      )}

      {/* TRANSFER BETWEEN HUBS MODAL */}
      {activeWarehouseModal === 'TRANSFER' && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-amber-50">
              <h2 className="text-xl font-black text-amber-900 uppercase tracking-tight">Inter-Hub Transfer</h2>
              <button onClick={() => { setActiveWarehouseModal(null); setHubTransferForm({ sourceId: '', destId: '', productId: '', quantity: '' }); setHubTransferSearch(''); }} className="p-2 text-amber-400 hover:text-amber-600 hover:bg-amber-100 rounded-full transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleHubTransferSubmit} className="p-8 flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Source (From)</label>
                  <select required value={hubTransferForm.sourceId} onChange={e=>setHubTransferForm({...hubTransferForm, sourceId: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer bg-white">
                    <option value="">Select...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id} disabled={w.id === hubTransferForm.destId}>{w.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Destination (To)</label>
                  <select required value={hubTransferForm.destId} onChange={e=>setHubTransferForm({...hubTransferForm, destId: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer bg-white">
                    <option value="">Select...</option>
                    {warehouses.map(w => <option key={w.id} value={w.id} disabled={w.id === hubTransferForm.sourceId}>{w.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 relative">
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Search Product</label>
                <input type="text" placeholder="Search SKU or Name..." value={hubTransferSearch} onChange={e => { setHubTransferSearch(e.target.value); setIsHubDropdownOpen(true); }} onClick={() => setIsHubDropdownOpen(true)} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-amber-500 shadow-sm" />
                {isHubDropdownOpen && hubTransferSearch && (
                  <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-10">
                    {filteredProductsForHubDropdown.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400 font-medium">No items found.</div>
                    ) : (
                      filteredProductsForHubDropdown.map(p => (
                        <div key={p.id} onClick={() => { setHubTransferForm({...hubTransferForm, productId: String(p.id)}); setHubTransferSearch(`${p.sku} - ${p.name}`); setIsHubDropdownOpen(false); }} className="p-3 hover:bg-amber-50 cursor-pointer border-b border-slate-50 last:border-0 flex justify-between items-center transition-colors">
                          <div className="font-bold text-xs text-slate-800 uppercase">{p.name}</div>
                          <div className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{p.sku}</div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Transfer Quantity</label>
                <input required type="number" min="1" value={hubTransferForm.quantity} onChange={e=>setHubTransferForm({...hubTransferForm, quantity: e.target.value})} className="px-4 py-3 border border-slate-200 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-amber-500 shadow-sm" placeholder="Positive numbers only..." />
              </div>
              <button type="submit" disabled={isProcessing || !hubTransferForm.productId} className="mt-4 w-full py-3.5 bg-amber-500 text-white rounded-xl font-bold uppercase tracking-wider hover:bg-amber-600 transition-colors shadow-sm disabled:opacity-50">Transfer Stock</button>
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
