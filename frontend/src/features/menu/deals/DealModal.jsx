import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { ImageUploader } from '../components/ImageUploader';
import { useAppStore } from '../../../store';
import {
  calculateWeightPrice,
  calculateWeightCost,
  calculateDealFinancials,
  formatCurrency,
} from '../../../domain/calculations';

/**
 * DealModalForm Component
 * Exact match to ItemModal styling and structure:
 * - max-w-md modal width
 * - rounded-full pill inputs and buttons (h-8)
 * - text-[11px] font-bold text-slate-800 labels
 * - space-y-2 layout
 * - identical Cancel & Save Deal action buttons
 */
const DealModalForm = ({ isOpen, onClose, deal = null }) => {
  const { items = [], addons = [], addDeal, updateDeal, user } = useAppStore();
  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );
  const isEdit = Boolean(deal?.id);

  // Form states
  const [name, setName] = useState(deal?.name || '');
  const [dealPrice, setDealPrice] = useState(
    deal?.dealPrice !== undefined ? String(deal.dealPrice) : ''
  );
  const [status, setStatus] = useState(deal?.status || 'active');
  const [description, setDescription] = useState(deal?.description || '');
  const [imageRef, setImageRef] = useState(deal?.imageRef || null);

  const [includedItems, setIncludedItems] = useState(() => {
    if (Array.isArray(deal?.includedItems) && deal.includedItems.length > 0) {
      return deal.includedItems.map((inc) => ({ ...inc }));
    }
    return [];
  });

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Component adder states
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [selectedPortionLabel, setSelectedPortionLabel] = useState('');
  const [customWeightGrams, setCustomWeightGrams] = useState('500');
  const [itemQuantity, setItemQuantity] = useState(1);
  const [isComponentDropdownOpen, setIsComponentDropdownOpen] = useState(false);
  const componentDropdownRef = useRef(null);
  const nameInputRef = useRef(null);
  const priceInputRef = useRef(null);

  // Active items and addons for selection
  const activeItems = useMemo(
    () => (items || []).filter((i) => i && i.name && i.status !== 'inactive'),
    [items]
  );
  const activeAddons = useMemo(
    () => (addons || []).filter((a) => a && a.name && a.status !== 'inactive'),
    [addons]
  );

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        componentDropdownRef.current &&
        !componentDropdownRef.current.contains(e.target)
      ) {
        setIsComponentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Picked entity (item or addon)
  const pickedEntity = useMemo(() => {
    if (!selectedEntityId) return null;
    const itemMatch = activeItems.find((i) => i.id === selectedEntityId);
    if (itemMatch) return { ...itemMatch, entityType: 'item' };
    const addonMatch = activeAddons.find((a) => a.id === selectedEntityId);
    if (addonMatch) return { ...addonMatch, entityType: 'addon' };
    return null;
  }, [selectedEntityId, activeItems, activeAddons]);

  // Is weight based
  const isPickedWeightBased = useMemo(() => {
    if (!pickedEntity || pickedEntity.entityType !== 'item') return false;
    const uType = (pickedEntity.unitType || '').toLowerCase();
    const uName = (pickedEntity.unit || pickedEntity.baseUnit || '').toLowerCase();
    return uType === 'weight' || uName.includes('kg') || uName.includes('gram');
  }, [pickedEntity]);

  const availablePortions = useMemo(() => {
    if (!pickedEntity || pickedEntity.entityType !== 'item') return [];

    // 1. If item has custom portionOptions (e.g. Small, Medium, Large or Half, Full)
    if (
      Array.isArray(pickedEntity.portionOptions) &&
      pickedEntity.portionOptions.length > 0
    ) {
      return pickedEntity.portionOptions.map((p) => {
        let grams = p.grams || null;
        if (!grams && p.quantityInBaseUnit) {
          grams = Math.round(Number(p.quantityInBaseUnit) * 1000);
        }
        if (!grams) {
          const l = (p.label || p.name || '').toLowerCase();
          if (l.includes('1kg') || l === '1 kg') grams = 1000;
          else if (l.includes('half')) grams = 500;
          else if (l.includes('quarter')) grams = 250;
        }
        return {
          label: p.label || p.name,
          grams,
          price:
            p.price !== undefined && p.price !== null && p.price !== ''
              ? Number(p.price)
              : undefined,
        };
      });
    }

    // 2. If weight based, provide standard weight portions (250g, 500g, 750g, 1 Kg, 1.5 Kg, 2 Kg)
    if (isPickedWeightBased) {
      return [
        { label: '250g', grams: 250 },
        { label: '500g', grams: 500 },
        { label: '750g', grams: 750 },
        { label: '1 Kg', grams: 1000 },
        { label: '1.5 Kg', grams: 1500 },
        { label: '2 Kg', grams: 2000 },
      ];
    }

    return [];
  }, [pickedEntity, isPickedWeightBased]);

  // Default portion when entity picked
  useEffect(() => {
    if (availablePortions.length > 0) {
      setSelectedPortionLabel(availablePortions[0].label);
    } else {
      setSelectedPortionLabel('');
    }
  }, [pickedEntity, availablePortions]);

  // Price & cost calculation for previewed entity
  const previewPricing = useMemo(() => {
    if (!pickedEntity)
      return { sellingPrice: 0, costPrice: null, portionDisplay: '', weightGrams: null };

    if (pickedEntity.entityType === 'addon') {
      return {
        sellingPrice: Number(pickedEntity.price) || 0,
        costPrice:
          pickedEntity.costPrice !== undefined && pickedEntity.costPrice !== null
            ? Number(pickedEntity.costPrice)
            : null,
        portionDisplay: pickedEntity.unit || '',
        weightGrams: null,
      };
    }

    if (availablePortions.length > 0) {
      const selectedPortion =
        availablePortions.find((p) => p.label === selectedPortionLabel) ||
        availablePortions[0];

      if (selectedPortion?.grams && isPickedWeightBased) {
        const grams = selectedPortion.grams;
        const selling =
          selectedPortion.price !== undefined
            ? selectedPortion.price
            : calculateWeightPrice(pickedEntity.basePrice, grams);
        const cost =
          pickedEntity.costPrice !== undefined && pickedEntity.costPrice !== null
            ? calculateWeightCost(pickedEntity.costPrice, grams)
            : null;
        return {
          sellingPrice: selling,
          costPrice: cost,
          portionDisplay: selectedPortion.label,
          weightGrams: grams,
        };
      }

      if (selectedPortion) {
        const optPrice =
          selectedPortion.price !== undefined
            ? Number(selectedPortion.price)
            : Number(pickedEntity.basePrice) || 0;
        let optCost = null;
        if (pickedEntity.costPrice !== undefined && pickedEntity.costPrice !== null) {
          const baseCost = Number(pickedEntity.costPrice);
          const qtyRatio =
            optPrice > 0 && Number(pickedEntity.basePrice) > 0
              ? optPrice / Number(pickedEntity.basePrice)
              : 1;
          optCost = Math.round(baseCost * qtyRatio);
        }
        return {
          sellingPrice: optPrice,
          costPrice: optCost,
          portionDisplay: selectedPortion.label,
          weightGrams: selectedPortion.grams || null,
        };
      }
    }

    return {
      sellingPrice: Number(pickedEntity.basePrice) || 0,
      costPrice:
        pickedEntity.costPrice !== undefined && pickedEntity.costPrice !== null
          ? Number(pickedEntity.costPrice)
          : null,
      portionDisplay: pickedEntity.unit || pickedEntity.baseUnit || 'Piece',
      weightGrams: null,
    };
  }, [
    pickedEntity,
    availablePortions,
    selectedPortionLabel,
    isPickedWeightBased,
  ]);

  const handleAddComponent = () => {
    if (!pickedEntity) return;

    const newComponent = {
      itemId: pickedEntity.id,
      itemType: pickedEntity.entityType,
      name: pickedEntity.name,
      quantity: Math.max(1, Number(itemQuantity) || 1),
      unit: pickedEntity.unit || pickedEntity.baseUnit || 'Piece',
      portion: previewPricing.portionDisplay,
      weightGrams: previewPricing.weightGrams,
      sellingPrice: previewPricing.sellingPrice,
      costPrice: previewPricing.costPrice,
    };

    setIncludedItems((prev) => [...prev, newComponent]);
    setSelectedEntityId('');
    setItemQuantity(1);
    setIsComponentDropdownOpen(false);
    if (errors.includedItems) {
      setErrors((prev) => ({ ...prev, includedItems: null }));
    }
  };

  const handleRemoveComponent = (indexToRemove) => {
    setIncludedItems((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Real-time financial calculations
  const financials = useMemo(() => {
    return calculateDealFinancials(includedItems, dealPrice);
  }, [includedItems, dealPrice]);

  const validate = () => {
    const errs = {};
    if (!name.trim()) {
      errs.name = 'Deal name is required';
    }
    const priceNum = parseFloat(dealPrice);
    if (dealPrice === '' || isNaN(priceNum) || priceNum < 0) {
      errs.dealPrice = 'Deal price must be 0 or greater';
    }
    if (includedItems.length === 0) {
      errs.includedItems = 'At least one included item or add-on is required';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (isCashier || isSubmitting) return;
    setSubmitError(null);
    if (!validate()) return;

    const dealPayload = {
      ...(deal || {}),
      name: name.trim(),
      description: description.trim(),
      imageRef: imageRef ? String(imageRef).trim() : null,
      dealPrice: Math.round(Number(dealPrice)),
      status,
      includedItems,
    };

    setIsSubmitting(true);
    try {
      if (isEdit) {
        await updateDeal(deal.id, dealPayload);
      } else {
        await addDeal(dealPayload);
      }
      onClose();
    } catch (err) {
      console.error('[DealModal] Save failed:', err);
      setSubmitError(err?.message || 'Failed to save deal. Please check backend connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Deal' : 'Add New Deal'}
      maxWidth="max-w-md"
    >
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            e.preventDefault();
          }
        }}
        className="space-y-2 text-slate-800"
      >
        {submitError && (
          <div className="p-2.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">
            {submitError}
          </div>
        )}
        {/* Deal Photo */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-[11px] font-bold text-slate-800 select-none">
            Deal Photo
          </label>
          <ImageUploader value={imageRef} onChange={setImageRef} />
        </div>

        {/* Deal Name * */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-[11px] font-bold text-slate-800 select-none">
            Deal Name *
          </label>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((prev) => ({ ...prev, name: null }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                priceInputRef.current?.focus();
              }
            }}
            placeholder="e.g. Family Feast Deal, Combo 1"
            autoFocus
            className={`w-full h-8 px-3 rounded-full border bg-white text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 ${
              errors.name ? 'border-rose-400' : 'border-slate-300'
            }`}
          />
          {errors.name && (
            <p className="text-[10px] font-medium text-rose-600 mt-0.5">{errors.name}</p>
          )}
        </div>

        {/* Row: Deal Price * and Status in 1 Single Line (2 Columns) */}
        <div className="grid grid-cols-2 gap-2.5 items-start">
          {/* Deal Price (Rs) * */}
          <div className="flex flex-col gap-1 w-full min-w-0">
            <label className="text-[11px] font-bold text-slate-800 select-none truncate">
              Deal Price (Rs) *
            </label>
            <input
              ref={priceInputRef}
              type="number"
              min="0"
              step="10"
              value={dealPrice}
              onChange={(e) => {
                setDealPrice(e.target.value);
                if (errors.dealPrice)
                  setErrors((prev) => ({ ...prev, dealPrice: null }));
              }}
              placeholder="e.g. 599"
              className={`w-full h-8 px-3 rounded-full border text-xs font-semibold outline-none transition-colors ${
                errors.dealPrice
                  ? 'border-rose-400 bg-white text-slate-800'
                  : 'border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 focus:border-slate-400'
              }`}
            />
            {errors.dealPrice && (
              <p className="text-[10px] font-medium text-rose-600 mt-0.5 truncate">
                {errors.dealPrice}
              </p>
            )}
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1 w-full min-w-0">
            <label className="text-[11px] font-bold text-slate-800 select-none truncate">
              Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full h-8 px-3 rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 cursor-pointer"
            >
              <option value="active">Active (Available)</option>
              <option value="inactive">Inactive (Hidden)</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-[11px] font-bold text-slate-800 select-none">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="e.g. 1kg Biryani, 2 Raita, 1.5L Cold Drink..."
            className="w-full text-xs p-2 rounded-xl border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 h-[46px] min-h-[46px] max-h-[46px] resize-none"
          />
        </div>

        {/* Included Items & Add-ons Selector */}
        <div className="flex flex-col gap-1 w-full" ref={componentDropdownRef}>
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-slate-800 select-none">
              Included Items & Add-ons *
            </label>
            {includedItems.length > 0 && (
              <span className="text-[10px] font-bold text-[#FF5C28]">
                {includedItems.length} selected
              </span>
            )}
          </div>

          {/* Component Adder Bar */}
          <div className="flex items-center gap-1.5 w-full">
            {/* Entity Dropdown Trigger */}
            <div className="relative flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setIsComponentDropdownOpen((prev) => !prev)}
                className={`w-full h-8 pl-3 pr-7 rounded-full border bg-white text-xs font-semibold text-slate-800 outline-none text-left flex items-center justify-between transition-colors cursor-pointer ${
                  errors.includedItems && includedItems.length === 0
                    ? 'border-rose-400'
                    : 'border-slate-300'
                }`}
              >
                <span className="truncate">
                  {pickedEntity
                    ? `${pickedEntity.name} (Rs ${pickedEntity.basePrice || pickedEntity.price || 0})`
                    : 'Select Item or Add-on...'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-700 shrink-0 ml-1" />
              </button>

              {/* Scrollable dropdown matching ItemModal Category dropdown */}
              {isComponentDropdownOpen && (
                <div className="absolute left-0 right-0 bottom-full mb-1 sm:bottom-auto sm:top-full sm:mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 max-h-52 overflow-y-auto py-1">
                  <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50 border-b border-slate-100">
                    Menu Items
                  </div>
                  {activeItems.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => {
                        setSelectedEntityId(it.id);
                        setIsComponentDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                        selectedEntityId === it.id
                          ? 'bg-orange-50 text-[#FF5C28] font-bold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">{it.name}</span>
                      <span className="text-[11px] font-bold text-slate-500 shrink-0 ml-2">
                        Rs {it.basePrice}
                      </span>
                    </button>
                  ))}

                  {activeAddons.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#FF5C28] bg-orange-50/60 border-y border-orange-100 mt-1">
                        Add-ons
                      </div>
                      {activeAddons.map((ad) => (
                        <button
                          key={ad.id}
                          type="button"
                          onClick={() => {
                            setSelectedEntityId(ad.id);
                            setIsComponentDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                            selectedEntityId === ad.id
                              ? 'bg-orange-50 text-[#FF5C28] font-bold'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="truncate">{ad.name}</span>
                          <span className="text-[11px] font-bold text-[#FF5C28] shrink-0 ml-2">
                            Rs {ad.price}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Weight / Portion Selector if applicable */}
            {availablePortions.length > 0 && (
              <select
                value={selectedPortionLabel}
                onChange={(e) => setSelectedPortionLabel(e.target.value)}
                className="h-8 px-2.5 rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none focus:outline-none cursor-pointer shrink-0"
              >
                {availablePortions.map((p, idx) => (
                  <option key={idx} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}

            {/* Qty Input */}
            <input
              type="number"
              min="1"
              value={itemQuantity}
              onChange={(e) =>
                setItemQuantity(Math.max(1, parseInt(e.target.value) || 1))
              }
              title="Quantity"
              className="w-12 h-8 px-1.5 rounded-full border border-slate-300 bg-white text-xs font-bold text-center text-slate-800 outline-none shrink-0"
            />

            {/* Add Button */}
            <button
              type="button"
              onClick={handleAddComponent}
              disabled={!pickedEntity}
              className="h-8 px-3 rounded-full bg-[#FF5C28] hover:bg-[#E04D1D] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-xs transition-colors cursor-pointer shrink-0 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add</span>
            </button>
          </div>

          {errors.includedItems && includedItems.length === 0 && (
            <p className="text-[10px] font-medium text-rose-600 mt-0.5">
              {errors.includedItems}
            </p>
          )}

          {/* Selected Component Badge Chips (matching ItemModal Extra Addons chips) */}
          {includedItems.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1 max-h-32 overflow-y-auto">
              {includedItems.map((inc, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-[#FF5C28] text-[11px] font-semibold"
                >
                  <span className="font-bold text-slate-800">{inc.name}</span>
                  {inc.portion && (
                    <span className="text-slate-600 font-medium text-[10px]">
                      ({inc.portion})
                    </span>
                  )}
                  <span className="text-slate-500 font-normal">×{inc.quantity}</span>
                  <span className="font-bold text-[#FF5C28]">
                    Rs {inc.sellingPrice * inc.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveComponent(idx)}
                    className="hover:text-rose-600 font-bold ml-1 cursor-pointer leading-none text-xs text-slate-400 hover:scale-110 transition-transform"
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Real-time Financial Analytics Pill */}
        {includedItems.length > 0 && (
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px] text-slate-700 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span>
                Regular: <strong className="text-slate-900">{formatCurrency(financials.regularPrice)}</strong>
              </span>
              <span>
                Saving:{' '}
                <strong
                  className={
                    financials.customerSaving !== null && financials.customerSaving > 0
                      ? 'text-emerald-700'
                      : financials.customerSaving !== null && financials.customerSaving < 0
                      ? 'text-rose-600'
                      : 'text-slate-800'
                  }
                >
                  {financials.customerSaving !== null
                    ? formatCurrency(financials.customerSaving)
                    : '—'}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span>
                Cost:{' '}
                <strong className={!financials.hasCost ? 'text-amber-700 font-bold' : 'text-slate-900'}>
                  {financials.hasCost
                    ? formatCurrency(financials.totalCost)
                    : 'Incomplete'}
                </strong>
              </span>
              <span>
                Profit:{' '}
                <strong
                  className={
                    !financials.hasCost
                      ? 'text-amber-700 font-bold'
                      : financials.estimatedGrossProfit !== null && financials.estimatedGrossProfit < 0
                      ? 'text-rose-600 font-bold'
                      : financials.estimatedGrossProfit !== null && financials.estimatedGrossProfit > 0
                      ? 'text-emerald-700 font-bold'
                      : 'text-slate-800'
                  }
                >
                  {!financials.hasCost
                    ? 'Unavailable'
                    : financials.estimatedGrossProfit !== null
                    ? formatCurrency(financials.estimatedGrossProfit)
                    : '—'}
                </strong>
              </span>
            </div>
          </div>
        )}

        {/* Action Buttons: Cancel & Save Deal (Identical to ItemModal) */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-8 px-4 rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-8 px-5 rounded-full bg-[#FF5C28] hover:bg-[#E04D1D] text-white text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Saving...' : 'Save Deal'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const DealModal = ({ isOpen, onClose, deal = null }) => {
  const { user } = useAppStore();
  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );
  if (!isOpen || isCashier) return null;

  return (
    <DealModalForm
      key={deal?.id || 'new_deal'}
      isOpen={isOpen}
      onClose={onClose}
      deal={deal}
    />
  );
};

export default DealModal;
