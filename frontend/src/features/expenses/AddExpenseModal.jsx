import React, { useState } from 'react';
import { X, Upload, CheckCircle2, AlertCircle, Banknote, Globe, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store';
import { getLocalExpenseDateString, toLocalExpenseIsoString } from '../../domain/rules/expenseRules';

/**
 * AddExpenseModal Component
 * Handles creating new expense entries or editing active ones.
 * - Strict payment methods: Cash or Online only
 * - When Online: Accounts pulled from Settings -> Payment Accounts (or custom)
 * - Auto-derives Entered By from authenticated user
 * - Attachment upload via Cloudinary (/api/upload)
 * - Submission locking to prevent duplicate posting
 */
export const AddExpenseModal = ({
  isOpen,
  onClose,
  expenseToEdit = null,
  categories = [],
  onSuccess,
}) => {
  const { user, addExpense, updateExpense, addExpenseCategory, expenseCategories, settings } = useAppStore();

  const isEditing = Boolean(expenseToEdit);
  const isOnlineEdit = (expenseToEdit?.paymentMethod || '').toUpperCase() === 'ONLINE';

  // Available Categories (only show configured active categories, no hardcoded fallback)
  const activeCategories = React.useMemo(() => {
    if (Array.isArray(categories)) {
      return categories.filter((c) => c && c.status !== 'inactive');
    }
    return [];
  }, [categories]);

  // Configured online payment accounts from Settings
  const configuredPaymentAccounts = React.useMemo(() => {
    const list = Array.isArray(settings?.paymentAccounts) ? settings.paymentAccounts : [];
    return list.filter((a) => a && a.isActive !== false);
  }, [settings?.paymentAccounts]);

  const defaultCategory =
    expenseToEdit?.categoryNameSnapshot ||
    expenseToEdit?.category ||
    '';
  const defaultCategoryId =
    expenseToEdit?.categoryId ||
    '';

  // Form Fields
  const [expenseDate, setExpenseDate] = useState(() => {
    if (expenseToEdit?.expenseDate) {
      return getLocalExpenseDateString(expenseToEdit.expenseDate);
    }
    return getLocalExpenseDateString(new Date());
  });
  const [categoryId, setCategoryId] = useState(() => defaultCategoryId);
  const [categoryNameSnapshot, setCategoryNameSnapshot] = useState(() => defaultCategory);
  const isCustomInitially = Boolean(
    activeCategories.length === 0 ||
    (defaultCategory &&
      !activeCategories.some((c) => c.name.toLowerCase() === defaultCategory.toLowerCase()))
  );
  const [isCustomCategory, setIsCustomCategory] = useState(isCustomInitially);
  const [amount, setAmount] = useState(() => (expenseToEdit?.amount != null ? String(expenseToEdit.amount) : ''));
  const [paymentMethod, setPaymentMethod] = useState(() => (isOnlineEdit ? 'Online' : 'Cash'));
  const [onlineMethodSnapshot, setOnlineMethodSnapshot] = useState(() => expenseToEdit?.onlineMethodSnapshot || '');

  const isCustomOnlineInitially = Boolean(
    configuredPaymentAccounts.length === 0 ||
    (expenseToEdit?.onlineMethodSnapshot &&
      !configuredPaymentAccounts.some((a) => {
        const fullVal = `${a.bankName || a.channel}${a.accountNumber ? ` - ${a.accountNumber}` : ''}${a.title ? ` (${a.title})` : ''}`;
        const shortVal = a.bankName || a.channel || '';
        const titleVal = a.title || '';
        const cur = (expenseToEdit.onlineMethodSnapshot || '').toLowerCase().trim();
        return (
          cur === fullVal.toLowerCase().trim() ||
          cur === shortVal.toLowerCase().trim() ||
          cur === titleVal.toLowerCase().trim()
        );
      }))
  );
  const [isCustomOnline, setIsCustomOnline] = useState(isCustomOnlineInitially);
  const [description, setDescription] = useState(() => expenseToEdit?.description || '');
  const [referenceNumber, setReferenceNumber] = useState(() => expenseToEdit?.referenceNumber || '');
  const [attachment, setAttachment] = useState(() => expenseToEdit?.attachment || '');
  const [attachmentPreview, setAttachmentPreview] = useState(() => expenseToEdit?.attachment || '');

  // UI States
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Derive Entered By from authenticated user
  const isUserCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );
  const currentUserId = String(
    user?.id || user?._id || (user?.username ? `user_${user.username}` : (isUserCashier ? 'user_cashier' : 'user_admin'))
  ).trim();
  const currentUserName = user?.name || user?.username || (isUserCashier ? 'Cashier' : 'Administrator');
  const currentUserRole = isUserCashier ? 'cashier' : (user?.role ? String(user.role).toLowerCase() : 'admin');

  if (!isOpen) return null;

  // Handle Category Change (supports dropdown, suggestions, or free typing/clearing)
  const handleCategoryChange = (val) => {
    const cleanVal = typeof val === 'string' ? val : (val?.target?.value ?? '');
    setCategoryNameSnapshot(cleanVal);
    if (!cleanVal.trim()) {
      setCategoryId('');
      return;
    }
    const matched = activeCategories.find(
      (c) => c.name.toLowerCase() === cleanVal.trim().toLowerCase() || c.id === cleanVal.trim()
    );
    if (matched) {
      setCategoryId(matched.id);
    } else {
      setCategoryId(cleanVal.trim());
    }
  };

  // Handle Receipt Upload
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Only image files (JPG, PNG, WebP) are supported for receipt attachments.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Receipt image must be smaller than 5MB.');
      return;
    }

    try {
      setIsUploading(true);
      setError('');

      // Read as base64 for Cloudinary upload
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result;
        setAttachmentPreview(base64Data);

        try {
          const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: base64Data,
              folder: 'rms_pos/expenses',
            }),
          });
          const resJson = await response.json();
          if (resJson.success && resJson.data?.url) {
            setAttachment(resJson.data.url);
          } else {
            // Keep local data URL as offline fallback
            setAttachment(base64Data);
          }
        } catch {
          // Keep local base64 fallback in offline mode
          setAttachment(base64Data);
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Failed to read image file: ' + err.message);
      setIsUploading(false);
    }
  };

  const handleRemoveAttachment = () => {
    setAttachment('');
    setAttachmentPreview('');
  };

  // Form Submit
  const handleSubmit = async (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    setError('');

    // Validation
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid expense amount greater than 0.');
      return;
    }

    if (!categoryNameSnapshot.trim()) {
      setError('Please select an expense category.');
      return;
    }

    if (paymentMethod === 'Online' && !onlineMethodSnapshot.trim()) {
      setError('Online Method / Account is required when Payment Method is Online (e.g. JazzCash, Meezan Bank, HBL).');
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payload = {
        expenseDate: toLocalExpenseIsoString(expenseDate),
        createdAt: isEditing ? (expenseToEdit?.createdAt || new Date().toISOString()) : new Date().toISOString(),
        categoryId: categoryId || categoryNameSnapshot,
        category: categoryNameSnapshot.trim(),
        categoryNameSnapshot: categoryNameSnapshot.trim(),
        amount: Math.round(numericAmount * 100) / 100,
        paymentMethod: paymentMethod === 'Online' ? 'Online' : 'Cash',
        onlineMethodSnapshot: paymentMethod === 'Online' ? onlineMethodSnapshot.trim() : '',
        description: description.trim(),
        referenceNumber: referenceNumber.trim(),
        attachment: attachment || '',
        createdByUserId: isEditing ? (expenseToEdit?.createdByUserId || currentUserId) : currentUserId,
        createdByName: isEditing ? (expenseToEdit?.createdByName || currentUserName) : currentUserName,
        createdByRole: isEditing ? (expenseToEdit?.createdByRole || currentUserRole) : currentUserRole,
      };

      if (isEditing) {
        await updateExpense(expenseToEdit.id, payload);
      } else {
        await addExpense(payload);
      }

      // Auto-register category into configured expense categories if not already present
      const cleanCat = categoryNameSnapshot.trim();
      if (cleanCat && addExpenseCategory) {
        const catList = Array.isArray(expenseCategories) ? expenseCategories : (categories || []);
        const exists = catList.some(
          (c) => (c.name || '').trim().toLowerCase() === cleanCat.toLowerCase()
        );
        if (!exists) {
          try {
            await addExpenseCategory({
              name: cleanCat,
              description: '',
              status: 'active',
            });
          } catch {}
        }
      }

      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save expense. Please check input values.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col cursor-default"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isEditing ? 'Edit Expense Record' : 'Record New Expense'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEditing
                ? 'Update non-financial details or corrected entries'
                : 'Post operational overheads with full audit accountability'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Date & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Expense Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-[#FF5C28] transition-colors"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  {isCustomCategory ? 'Custom Category' : 'Expense Category'}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                {activeCategories.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomCategory(!isCustomCategory);
                      if (!isCustomCategory) {
                        setCategoryNameSnapshot('');
                        setCategoryId('');
                      }
                    }}
                    className={`text-[11px] font-bold cursor-pointer transition-colors ${
                      isCustomCategory
                        ? 'text-slate-500 hover:text-slate-800'
                        : 'text-[#FF5C28] hover:underline'
                    }`}
                  >
                    {isCustomCategory ? '← Select from list' : '+ Type Custom'}
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400 font-medium">
                    (No categories added yet)
                  </span>
                )}
              </div>

              {isCustomCategory || activeCategories.length === 0 ? (
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="Type custom category name..."
                    value={categoryNameSnapshot}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCategoryNameSnapshot(val);
                      setCategoryId(val.trim());
                    }}
                    className="w-full h-9 pl-3 pr-8 bg-slate-50 border border-[#FF5C28] rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#FF5C28] transition-colors"
                  />
                  {categoryNameSnapshot && (
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryNameSnapshot('');
                        setCategoryId('');
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <select
                  required
                  value={categoryNameSnapshot}
                  onChange={(e) => {
                    if (e.target.value === '__CUSTOM__') {
                      setIsCustomCategory(true);
                      setCategoryNameSnapshot('');
                      setCategoryId('');
                    } else {
                      handleCategoryChange(e.target.value);
                    }
                  }}
                  className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-[#FF5C28] transition-colors cursor-pointer"
                >
                  <option value="">Select Category</option>
                  {activeCategories.map((c) => (
                    <option key={c.id || c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__CUSTOM__">+ Other / Custom Category...</option>
                </select>
              )}
            </div>
          </div>

          {/* 2. Amount & Payment Method */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Amount (Rs) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  Rs
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-[#FF5C28] transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payment Method <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2 h-9">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('Cash')}
                  className={`flex items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    paymentMethod === 'Cash'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Banknote className="w-3.5 h-3.5" />
                  <span>Cash</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('Online')}
                  className={`flex items-center justify-center gap-1.5 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    paymentMethod === 'Online'
                      ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Online</span>
                </button>
              </div>
            </div>
          </div>

          {/* 3. Conditional Online Method / Account */}
          {paymentMethod === 'Online' && (
            <div className="p-3 bg-blue-50/50 border border-blue-200/80 rounded-xl space-y-2 animate-in fade-in duration-150">
              <div className="flex items-center justify-between mb-0.5">
                <label className="block text-xs font-bold text-blue-950">
                  {isCustomOnline ? 'Custom Online Method / Account' : 'Online Method / Account'}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                {configuredPaymentAccounts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomOnline(!isCustomOnline);
                      if (!isCustomOnline) {
                        setOnlineMethodSnapshot('');
                      }
                    }}
                    className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                  >
                    {isCustomOnline ? '← Select Online Account' : '+ Type Custom'}
                  </button>
                )}
              </div>

              {configuredPaymentAccounts.length > 0 && !isCustomOnline ? (
                <select
                  required
                  value={onlineMethodSnapshot}
                  onChange={(e) => {
                    if (e.target.value === '__CUSTOM__') {
                      setIsCustomOnline(true);
                      setOnlineMethodSnapshot('');
                    } else {
                      setOnlineMethodSnapshot(e.target.value);
                    }
                  }}
                  className="w-full h-9 px-3 bg-white border border-blue-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="">Select Online Account</option>
                  {configuredPaymentAccounts.map((acc) => {
                    const accValue = `${acc.bankName || acc.channel}${acc.accountNumber ? ` - ${acc.accountNumber}` : ''}${acc.title ? ` (${acc.title})` : ''}`;
                    return (
                      <option key={acc.id} value={accValue}>
                        {acc.bankName || acc.channel} - {acc.accountNumber} ({acc.title}){acc.isDefault ? ' ★' : ''}
                      </option>
                    );
                  })}
                  <option value="__CUSTOM__">+ Other / Custom Account...</option>
                </select>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder={
                      configuredPaymentAccounts.length > 0
                        ? 'Type custom online account name...'
                        : 'Type online method / account (e.g. JazzCash, Meezan Bank)...'
                    }
                    value={onlineMethodSnapshot}
                    onChange={(e) => setOnlineMethodSnapshot(e.target.value)}
                    className="w-full h-9 px-3 bg-white border border-blue-200 rounded-lg text-xs font-medium text-slate-800 placeholder-blue-300 focus:outline-none focus:border-blue-500"
                  />
                  {onlineMethodSnapshot && isCustomOnline && configuredPaymentAccounts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOnlineMethodSnapshot('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4. Reference Number & Entered By */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reference / Bill No.
              </label>
              <input
                type="text"
                placeholder="e.g. INV-8821, Slip #40"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-[#FF5C28] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                By <span className="text-[10px] text-slate-400 font-normal">(System derived)</span>
              </label>
              <div className="h-9 px-3 bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>{currentUserName}</span>
                <span className="text-[10px] font-normal text-slate-500 px-1.5 py-0.5 bg-white rounded border border-slate-200 capitalize">
                  {currentUserRole}
                </span>
              </div>
            </div>
          </div>

          {/* 5. Description / Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Description / Note
            </label>
            <textarea
              rows={2}
              placeholder="Operational details, vendor name, or expense purpose..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-[#FF5C28] transition-colors resize-none"
            />
          </div>

          {/* 6. Receipt / Attachment */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Receipt / Bill Attachment <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
            </label>
            {attachmentPreview ? (
              <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <img
                  src={attachmentPreview}
                  alt="Receipt attachment"
                  className="w-12 h-12 object-cover rounded-lg border border-slate-200"
                />
                <div className="flex-1 min-w-0">
                  <span className="block text-xs font-medium text-slate-800 truncate">
                    Receipt attached
                  </span>
                  <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Ready
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveAttachment}
                  className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer">
                {isUploading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin text-[#FF5C28]" />
                    <span>Uploading attachment...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-slate-500">
                    <Upload className="w-5 h-5 text-slate-400" />
                    <span className="text-xs font-medium text-slate-700">
                      Upload receipt or bill photo
                    </span>
                    <span className="text-[10px] text-slate-400">
                      PNG, JPG or WebP (max 5MB)
                    </span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  disabled={isUploading}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </form>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-slate-100 bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/70 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isUploading || isSubmitting}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#FF5C28] hover:bg-[#E04D1D] disabled:opacity-60 text-white text-xs font-bold rounded-full shadow-xs transition-colors cursor-pointer"
          >
            <span>{isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Post Expense'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddExpenseModal;
