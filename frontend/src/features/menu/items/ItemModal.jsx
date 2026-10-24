import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { ImageUploader } from '../components/ImageUploader';
import { useAppStore } from '../../../store';
import { sortCategories } from '../../../domain/rules';

const STANDARD_UNITS = [
  'Unit',
  'Piece',
  'Cup',
  '250ml',
  '300ml',
  '345ml',
  '500ml',
  '750ml',
  '1 Litre',
  '1.5 Litre',
  '2 Litre',
  '2.25 Litre',
  'Plate',
  'Portion',
  'Half',
  'Full',
  '1 Kg',
  '2 Kg',
  '500g',
  '250g',
  'Box',
  'Pack',
];

const ItemModalForm = ({ isOpen, onClose, item = null }) => {
  const { categories, addons, addItem, updateItem, addCategory, addAddon, user } = useAppStore();
  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );
  const isEdit = Boolean(item?.id);

  const existingCat = categories.find((c) => c.id === item?.categoryId);

  // Available categories: ONLY categories entered by the user in the Categories section sorted by display order!
  const availableCategories = sortCategories(
    (categories || []).filter((c) => c && c.name && c.status !== 'archived')
  ).map((c) => c.name);

  // Form states
  const [name, setName] = useState(item?.name || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [hasUserChangedCategory, setHasUserChangedCategory] = useState(Boolean(isEdit));
  const [hasUserChangedUnit, setHasUserChangedUnit] = useState(Boolean(isEdit));
  const [categoryName, setCategoryName] = useState(
    existingCat?.name || item?.categoryName || ''
  );
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const categoryRef = useRef(null);
  const nameInputRef = useRef(null);
  const categoryInputRef = useRef(null);
  const priceInputRef = useRef(null);
  const costPriceInputRef = useRef(null);
  const unitRef = useRef(null);
  const unitInputRef = useRef(null);
  const descriptionRef = useRef(null);
  const addonNameInputRef = useRef(null);
  const addonPriceInputRef = useRef(null);

  const [basePrice, setBasePrice] = useState(
    item?.basePrice !== undefined ? String(item.basePrice) : ''
  );
  const [costPrice, setCostPrice] = useState(
    item?.costPrice !== undefined && item?.costPrice !== null ? String(item.costPrice) : ''
  );

  const [servingUnit, setServingUnit] = useState(
    item?.unit || item?.servingUnit || 'Unit'
  );
  const [isUnitDropdownOpen, setIsUnitDropdownOpen] = useState(false);

  const [description, setDescription] = useState(item?.description || '');
  const [imageRef, setImageRef] = useState(item?.imageRef || null);

  // Extra Add-ons (Optional)
  const [extraAddons, setExtraAddons] = useState(() => {
    if (Array.isArray(item?.addons) && item.addons.length > 0) {
      return item.addons
        .filter((a) => Number(a.price) > 0)
        .map((a) => ({
          id: a.id,
          name: a.name,
          price: String(a.price),
          costPrice: a.costPrice !== undefined && a.costPrice !== null ? String(a.costPrice) : '',
        }));
    }
    if (Array.isArray(item?.addonIds) && item.addonIds.length > 0 && Array.isArray(addons)) {
      const matched = addons.filter((a) => item.addonIds.includes(a.id) && Number(a.price) > 0);
      if (matched.length > 0) {
        return matched.map((a) => ({
          id: a.id,
          name: a.name,
          price: String(a.price),
          costPrice: a.costPrice !== undefined && a.costPrice !== null ? String(a.costPrice) : '',
        }));
      }
    }
    return [];
  });
  const [isAddonDropdownOpen, setIsAddonDropdownOpen] = useState(false);
  const addonContainerRef = useRef(null);

  // Available addons from Add-ons section
  const availableStoreAddons = useMemo(() => {
    return (addons || []).filter((a) => a && a.name && a.status !== 'inactive');
  }, [addons]);

  const [errors, setErrors] = useState({});

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (categoryRef.current && !categoryRef.current.contains(e.target)) {
        setIsCategoryDropdownOpen(false);
      }
      if (unitRef.current && !unitRef.current.contains(e.target)) {
        setIsUnitDropdownOpen(false);
      }
      if (addonContainerRef.current && !addonContainerRef.current.contains(e.target)) {
        setIsAddonDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddExtraAddon = () => {
    const trimmedName = newAddonName.trim();
    if (!trimmedName) {
      setAddonError('Addon name is required');
      addonNameInputRef.current?.focus();
      return;
    }
    const priceNum = parseFloat(newAddonPrice);
    if (!newAddonPrice || !newAddonPrice.trim() || isNaN(priceNum) || priceNum <= 0) {
      setAddonError('Price is required (must be greater than 0)');
      addonPriceInputRef.current?.focus();
      return;
    }
    setAddonError('');
    setExtraAddons((prev) => [
      ...prev,
      { name: trimmedName, price: String(Math.round(priceNum)) },
    ]);
    setNewAddonName('');
    setNewAddonPrice('');
    addonNameInputRef.current?.focus();
  };

  const handleRemoveExtraAddon = (indexToRemove) => {
    setExtraAddons((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const validate = () => {
    const errs = {};
    if (!name.trim()) {
      errs.name = 'Item name is required';
    }
    const resolvedCat = categoryName.trim();
    if (!resolvedCat) {
      errs.categoryName = 'Category is required';
    }
    const priceNum = parseFloat(basePrice);
    if (basePrice === '' || isNaN(priceNum) || priceNum < 0) {
      errs.basePrice = 'Price must be 0 or greater';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (isCashier || isSubmitting) return;
    setSubmitError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      let trimmedCatName = categoryName.trim();
      if (!trimmedCatName) {
        if (availableCategories.length > 0) {
          trimmedCatName = availableCategories[0];
        } else {
          trimmedCatName = 'Burgers';
        }
      }
      let targetCatId = '';
      const match = categories.find(
        (c) => c.name.toLowerCase() === trimmedCatName.toLowerCase()
      );

      if (match) {
        targetCatId = match.id;
      } else {
        // Auto-create category in store if custom/new so it persists to MongoDB
        const created = await addCategory({
          name: trimmedCatName,
          status: 'active',
          keywords: [trimmedCatName.toLowerCase()],
        });
        targetCatId = created.id;
      }

      const finalUnit = servingUnit.trim() || 'Unit';

      const isWeightUnit =
        finalUnit.toLowerCase().includes('kg') ||
        finalUnit.toLowerCase().includes('gram') ||
        finalUnit.toLowerCase().includes('500g') ||
        finalUnit.toLowerCase().includes('half') ||
        finalUnit.toLowerCase().includes('full');

      const isVolumeUnit =
        finalUnit.toLowerCase().includes('bottle') ||
        finalUnit.toLowerCase().includes('can') ||
        finalUnit.toLowerCase().includes('glass') ||
        finalUnit.toLowerCase().includes('cup') ||
        finalUnit.toLowerCase().includes('liter') ||
        finalUnit.toLowerCase().includes('litre') ||
        finalUnit.toLowerCase().includes('ml');

      // Persist extra addons to store
      const resolvedAddonIds = [];
      const formattedAddons = [];
      const activeExtraAddons = extraAddons.filter((ea) => Number(ea.price) > 0 && ea.name?.trim());
      for (const ea of activeExtraAddons) {
        const priceNum = Number(ea.price) || 0;
        const matchedStoreAddon = (addons || []).find(
          (sa) => sa && (sa.id === ea.id || sa.name?.trim().toLowerCase() === ea.name?.trim().toLowerCase())
        );
        const resolvedCost =
          ea.costPrice !== undefined && ea.costPrice !== null && ea.costPrice !== ''
            ? Number(ea.costPrice)
            : matchedStoreAddon?.costPrice !== undefined && matchedStoreAddon?.costPrice !== null
            ? Number(matchedStoreAddon.costPrice)
            : null;

        const addonId = ea.id || matchedStoreAddon?.id;

        if (typeof addAddon === 'function') {
          const registered = await addAddon({
            id: addonId,
            name: ea.name.trim(),
            price: priceNum,
            costPrice: resolvedCost,
            status: 'active',
            type: 'Food',
          });
          if (registered?.id) resolvedAddonIds.push(registered.id);
        } else if (addonId) {
          resolvedAddonIds.push(addonId);
        }
        formattedAddons.push({
          id: addonId,
          name: ea.name.trim(),
          price: priceNum,
          costPrice: resolvedCost,
        });
      }

      const finalBasePrice = Math.round(parseFloat(basePrice) || 0);
      const finalCostPrice = costPrice.trim() !== '' && !isNaN(Number(costPrice)) ? Math.round(parseFloat(costPrice)) : null;

      const payload = {
        name: name.trim(),
        categoryId: targetCatId,
        categoryName: trimmedCatName,
        basePrice: finalBasePrice,
        costPrice: finalCostPrice,
        unit: finalUnit,
        baseUnit: finalUnit,
        unitType: isWeightUnit ? 'weight' : isVolumeUnit ? 'volume' : 'piece',
        description: description.trim(),
        imageRef,
        status: item?.status || 'active',
        addons: formattedAddons,
        addonIds: resolvedAddonIds,
        portionOptions: item?.portionOptions || [],
      };

      if (isEdit) {
        await updateItem(item.id, payload);
      } else {
        await addItem(payload);
      }

      onClose();
    } catch (err) {
      console.error('[ItemModal] Save item failed:', err);
      setSubmitError(err?.message || 'Failed to save item to database. Please check backend connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Food Item' : 'Add New Food Item'}
      icon={Plus}
      maxWidth="max-w-[520px]"
      footer={null}
      hideHeaderBorder={true}
      bodyClassName="pt-0 px-6 pb-4"
      className="rounded-3xl shadow-2xl border border-slate-100"
    >
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          // Never accidentally submit form when pressing Enter inside text/number inputs
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
        {/* Item Photo */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-[11px] font-bold text-slate-800 select-none">
            Item Photo
          </label>
          <ImageUploader value={imageRef} onChange={setImageRef} />
        </div>

        {/* Item Name * */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-[11px] font-bold text-slate-800 select-none">
            Item Name *
          </label>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => {
              const val = e.target.value;
              setName(val);
              if (errors.name) setErrors((prev) => ({ ...prev, name: null }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                categoryInputRef.current?.focus();
              }
            }}
            placeholder="e.g. Special Zinger Burger"
            autoFocus
            className={`w-full h-8 px-3 rounded-full border bg-white text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 ${
              errors.name ? 'border-rose-400' : 'border-slate-300'
            }`}
          />
          {errors.name && (
            <p className="text-[10px] font-medium text-rose-600 mt-0.5">{errors.name}</p>
          )}
        </div>

        {/* Row: Category *, Cost Price, and Selling Price * in 1 Single Line (3 Equal Columns) */}
        <div className="grid grid-cols-3 gap-2.5 items-start">
          {/* 1. Category *: ONLY categories from the Categories section */}
          <div className="flex flex-col gap-1 w-full min-w-0" ref={categoryRef}>
            <label className="text-[11px] font-bold text-slate-800 select-none truncate" title="Category *">
              Category *
            </label>
            <div className="relative flex items-center">
              <input
                ref={categoryInputRef}
                type="text"
                value={categoryName}
                onChange={(e) => {
                  setCategoryName(e.target.value);
                  setHasUserChangedCategory(true);
                  setIsCategoryDropdownOpen(true);
                  if (errors.categoryName)
                    setErrors((prev) => ({ ...prev, categoryName: null }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setIsCategoryDropdownOpen(false);
                    costPriceInputRef.current?.focus();
                  }
                }}
                onClick={() => setIsCategoryDropdownOpen(true)}
                placeholder="Select Category"
                className={`w-full h-8 pl-3 pr-7 rounded-full border bg-white text-xs font-semibold text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 ${
                  errors.categoryName ? 'border-rose-500' : 'border-slate-300'
                }`}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setIsCategoryDropdownOpen((prev) => !prev)}
                className="absolute right-2 p-0.5 text-slate-700 hover:text-slate-900 cursor-pointer"
                title="Toggle categories list"
              >
                <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>

              {/* Dropdown with only categories from the Categories section */}
              {isCategoryDropdownOpen && availableCategories.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 max-h-48 overflow-y-auto py-1">
                  {availableCategories.map((catName) => (
                    <button
                      key={catName}
                      type="button"
                      onClick={() => {
                        setCategoryName(catName);
                        setHasUserChangedCategory(true);
                        setIsCategoryDropdownOpen(false);
                        if (errors.categoryName)
                          setErrors((prev) => ({ ...prev, categoryName: null }));
                      }}
                      className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                        categoryName.trim().toLowerCase() === catName.toLowerCase()
                          ? 'bg-orange-50 text-[#FF5C28] font-bold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span>{catName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {errors.categoryName && (
              <p className="text-[10px] font-medium text-rose-600 mt-0.5 truncate">
                {errors.categoryName}
              </p>
            )}
          </div>

          {/* 2. Cost Price (Internal COGS - not on customer invoice) */}
          <div className="flex flex-col gap-1 w-full min-w-0">
            <div className="flex items-center justify-between gap-1">
              <label
                className="text-[11px] font-bold text-slate-800 select-none truncate"
                title={servingUnit.toLowerCase().includes('kg') ? 'Cost Price / Kg (Rs) (Internal COGS)' : 'Cost Price (Rs) (Internal COGS)'}
              >
                {servingUnit.toLowerCase().includes('kg') ? 'Cost/Kg (Rs)' : 'Cost Price (Rs)'}
              </label>
            </div>
            <input
              ref={costPriceInputRef}
              type="number"
              min="0"
              step="10"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  priceInputRef.current?.focus();
                }
              }}
              placeholder={servingUnit.toLowerCase().includes('kg') ? 'e.g. 600' : 'e.g. 280'}
              className="w-full h-8 px-3 rounded-full border text-xs font-medium outline-none transition-colors bg-white text-slate-800 border-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-0 focus:border-slate-400"
            />
          </div>

          {/* 3. Selling Price */}
          <div className="flex flex-col gap-1 w-full min-w-0">
            <div className="flex items-center justify-between gap-1">
              <label
                className="text-[11px] font-bold text-slate-800 select-none truncate"
                title={servingUnit.toLowerCase().includes('kg') ? 'Selling Price / Kg (Rs) *' : 'Selling Price (Rs) *'}
              >
                {servingUnit.toLowerCase().includes('kg') ? 'Selling/Kg *' : 'Selling Price *'}
              </label>
            </div>
            <input
              ref={priceInputRef}
              type="number"
              min="0"
              step="10"
              value={basePrice}
              onChange={(e) => {
                setBasePrice(e.target.value);
                if (errors.basePrice)
                  setErrors((prev) => ({ ...prev, basePrice: null }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  unitInputRef.current?.focus();
                }
              }}
              placeholder={servingUnit.toLowerCase().includes('kg') ? 'e.g. 1000' : 'e.g. 450'}
              className={`w-full h-8 px-3 rounded-full border text-xs font-medium outline-none transition-colors ${
                errors.basePrice
                  ? 'border-rose-400 bg-white text-slate-800'
                  : 'border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 focus:border-slate-400'
              }`}
            />
            {errors.basePrice && (
              <p className="text-[10px] font-medium text-rose-600 mt-0.5 truncate">
                {errors.basePrice}
              </p>
            )}
          </div>
        </div>

        {/* Serving Unit / Weight */}
        <div className="flex flex-col gap-1 w-full" ref={unitRef}>
          <label className="text-[11px] font-bold text-slate-800 select-none">
            Serving Unit / Weight
          </label>
          <div className="relative flex items-center">
            <input
              ref={unitInputRef}
              type="text"
              value={servingUnit}
              onChange={(e) => {
                setServingUnit(e.target.value);
                setHasUserChangedUnit(true);
                setIsUnitDropdownOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setIsUnitDropdownOpen(false);
                  descriptionRef.current?.focus();
                }
              }}
              onClick={() => setIsUnitDropdownOpen(true)}
              placeholder="Unit, Piece, Cup, 1 Kg, 2 Kg..."
              className="w-full h-8 pl-3 pr-8 rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setIsUnitDropdownOpen((prev) => !prev)}
              className="absolute right-2.5 p-0.5 text-slate-700 hover:text-slate-900 cursor-pointer"
              title="Toggle units list"
            >
              <ChevronDown className="w-4 h-4 stroke-[2.5]" />
            </button>

            {/* Standard unit suggestion dropdown */}
            {isUnitDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 max-h-48 overflow-y-auto py-1">
                {STANDARD_UNITS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => {
                      setServingUnit(unit);
                      setHasUserChangedUnit(true);
                      setIsUnitDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                      servingUnit.trim().toLowerCase() === unit.toLowerCase()
                        ? 'bg-orange-50 text-[#FF5C28] font-bold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{unit}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1 w-full">
          <label className="text-[11px] font-bold text-slate-800 select-none">
            Description
          </label>
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addonNameInputRef.current?.focus();
              }
            }}
            rows={2}
            placeholder="Fresh ingredients, spices, signature sauce..."
            className="w-full text-xs p-2 rounded-xl border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 h-[46px] min-h-[46px] max-h-[46px] resize-none"
          />
        </div>

        {/* Extra Add-ons (Optional): Single input like Category with scrollable dropdown */}
        <div className="flex flex-col gap-1 w-full" ref={addonContainerRef}>
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-slate-800 select-none">
              Extra Add-ons (Optional)
            </label>
            {extraAddons.length > 0 && (
              <span className="text-[10px] font-bold text-[#FF5C28]">
                {extraAddons.length} selected
              </span>
            )}
          </div>

          <div className="relative flex items-center">
            <input
              ref={addonNameInputRef}
              type="text"
              readOnly
              value={
                extraAddons.length === 0
                  ? ''
                  : extraAddons.length === 1
                  ? `${extraAddons[0].name} (Rs ${extraAddons[0].price})`
                  : `${extraAddons.length} Selected: ${extraAddons.map((a) => a.name).join(', ')}`
              }
              onClick={() => setIsAddonDropdownOpen((prev) => !prev)}
              placeholder="Select Add-on(s)..."
              className="w-full h-8 pl-3 pr-8 rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 cursor-pointer select-none"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setIsAddonDropdownOpen((prev) => !prev)}
              className="absolute right-2.5 p-0.5 text-slate-700 hover:text-slate-900 cursor-pointer"
              title="Toggle add-ons list"
            >
              <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>

            {/* Scrollable dropdown matching Category dropdown */}
            {isAddonDropdownOpen && (
              <div className="absolute left-0 right-0 bottom-full mb-1 sm:bottom-auto sm:top-full sm:mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 max-h-48 overflow-y-auto py-1">
                {availableStoreAddons.length === 0 ? (
                  <div className="px-3.5 py-2 text-xs text-slate-400 text-center font-medium">
                    No add-ons available. Create in Menu &gt; Add-ons first.
                  </div>
                ) : (
                  availableStoreAddons.map((sa) => {
                    const isSelected = extraAddons.some(
                      (ea) => ea.name.toLowerCase() === sa.name.toLowerCase()
                    );
                    return (
                      <button
                        key={sa.id || sa.name}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setExtraAddons((prev) =>
                              prev.filter((ea) => ea.name.toLowerCase() !== sa.name.toLowerCase())
                            );
                          } else {
                            setExtraAddons((prev) => [
                              ...prev,
                              {
                                id: sa.id,
                                name: sa.name,
                                price: String(sa.price || 0),
                                costPrice: sa.costPrice,
                              },
                            ]);
                          }
                        }}
                        className={`w-full text-left px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-orange-50 text-[#FF5C28] font-bold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                            className="w-3.5 h-3.5 accent-[#FF5C28] rounded pointer-events-none"
                          />
                          <span>{sa.name}</span>
                        </div>
                        <span className="text-[11px] font-bold text-[#FF5C28]">
                          Rs {sa.price}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Selected Add-ons Badge Chips */}
          {extraAddons.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {extraAddons.map((ea) => (
                <span
                  key={ea.name}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-[#FF5C28] text-[11px] font-semibold"
                >
                  <span>{ea.name}</span>
                  <span className="text-slate-500 font-normal">Rs {ea.price}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setExtraAddons((prev) =>
                        prev.filter((item) => item.name.toLowerCase() !== ea.name.toLowerCase())
                      )
                    }
                    className="hover:text-rose-600 font-bold ml-0.5 cursor-pointer leading-none"
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons: Cancel & Save Item */}
        <div className="flex items-center justify-end gap-2 pt-1">
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
            {isSubmitting ? 'Saving...' : 'Save Item'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export const ItemModal = ({ isOpen, onClose, item = null }) => {
  const { user } = useAppStore();
  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );
  if (!isOpen || isCashier) return null;
  return (
    <ItemModalForm
      key={item?.id || 'new_item'}
      isOpen={isOpen}
      onClose={onClose}
      item={item}
    />
  );
};

export default ItemModal;
