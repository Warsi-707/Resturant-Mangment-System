import React, { useState } from 'react';
import { PlusCircle, Lock } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { FormField } from '../../../components/ui/FormField';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { useAppStore } from '../../../store';
import {
  isDuplicateAddonName,
  ADDON_TYPES,
  detectAddonType,
} from '../../../domain/rules';

const AddonModalForm = ({
  isOpen,
  onClose,
  addon = null,
}) => {
  const { addons, addAddon, updateAddon, user } = useAppStore();
  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );
  const isEdit = Boolean(addon?.id);

  const [name, setName] = useState(addon?.name || '');
  const [type, setType] = useState(
    addon?.type || (addon?.name ? detectAddonType(addon.name) : 'Extra Protein')
  );
  const [hasManuallySelectedType, setHasManuallySelectedType] = useState(Boolean(addon?.type));
  const [price, setPrice] = useState(addon?.price !== undefined ? String(addon.price) : '');
  const [costPrice, setCostPrice] = useState(
    addon?.costPrice !== undefined && addon?.costPrice !== null ? String(addon.costPrice) : ''
  );
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const validate = () => {
    const errs = {};
    if (!name.trim()) {
      errs.name = 'Add-on name is required';
    } else if (isDuplicateAddonName(name, addons, addon?.id)) {
      errs.name = 'An add-on with this name already exists';
    }

    if (!type) {
      errs.type = 'Add-on type is required';
    }

    if (!isCashier || !isEdit) {
      const numericPrice = parseFloat(price);
      if (price === '' || isNaN(numericPrice) || numericPrice <= 0) {
        errs.price = 'Price must be greater than 0';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNameChange = (e) => {
    const newName = e.target.value;
    setName(newName);
    if (errors.name) setErrors((prev) => ({ ...prev, name: null }));

    if (!hasManuallySelectedType && newName.trim()) {
      const autoType = detectAddonType(newName);
      if (autoType) {
        setType(autoType);
      }
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);
    if (!validate()) return;

    const finalType = type || detectAddonType(name.trim());
    const finalPrice = (isCashier && isEdit)
      ? (addon?.price !== undefined ? Number(addon.price) : 0)
      : Math.round(parseFloat(price) || 0);

    const finalCostPrice = (isCashier && isEdit)
      ? (addon?.costPrice !== undefined ? addon.costPrice : null)
      : costPrice.trim() !== '' && !isNaN(Number(costPrice)) ? Math.round(parseFloat(costPrice) || 0) : null;

    const payload = {
      name: name.trim(),
      type: finalType,
      price: finalPrice,
      costPrice: finalCostPrice,
    };

    setIsSubmitting(true);
    try {
      if (isEdit) {
        await updateAddon(addon.id, payload);
      } else {
        await addAddon({
          ...payload,
          status: 'active',
          categoryIds: [],
          itemIds: [],
        });
      }
      onClose();
    } catch (err) {
      console.error('[AddonModal] Save failed:', err);
      setSubmitError(err?.message || 'Failed to save add-on. Please check backend connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Add-on' : 'Add New Add-on'}
      icon={PlusCircle}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="secondary" size="md" onClick={onClose} type="button" disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleSubmit} type="button" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : isEdit ? 'Update Add-on' : 'Save Add-on'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 py-1">
        {submitError && (
          <div className="p-2.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">
            {submitError}
          </div>
        )}
        <FormField label="Addon Name" required error={errors.name}>
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder="Addon name (e.g. Extra Chicken Boti, Cold Drink Can)"
            autoFocus
          />
        </FormField>

        <FormField label="Add-on Type (Master 6 Types)" required error={errors.type}>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setHasManuallySelectedType(true);
              if (errors.type) setErrors((prev) => ({ ...prev, type: null }));
            }}
            className="w-full h-10 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-[#FF5C28] focus:ring-1 focus:ring-[#FF5C28]"
          >
            {ADDON_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label={
              <span className="flex items-center justify-between w-full">
                <span>Cost Price (Rs)</span>
                {isCashier && (
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200/60 flex items-center gap-0.5">
                    <Lock className="w-2.5 h-2.5 stroke-[2.5]" /> Admin
                  </span>
                )}
              </span>
            }
          >
            <Input
              type="number"
              min="0"
              step="5"
              disabled={isCashier}
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              placeholder={isCashier ? 'Locked' : 'e.g. 60'}
              className={isCashier ? 'bg-slate-100/90 text-slate-500 cursor-not-allowed select-none' : ''}
            />
          </FormField>

          <FormField
            label={
              <span className="flex items-center justify-between w-full">
                <span>Selling Price (Rs) *</span>
                {isCashier && (
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1 py-0.2 rounded border border-amber-200/60 flex items-center gap-0.5">
                    <Lock className="w-2.5 h-2.5 stroke-[2.5]" /> Admin
                  </span>
                )}
              </span>
            }
            required={!isCashier}
            error={!isCashier ? errors.price : null}
          >
            <Input
              type="number"
              min="0"
              step="5"
              disabled={isCashier}
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                if (errors.price) setErrors((prev) => ({ ...prev, price: null }));
              }}
              placeholder={isCashier ? 'Locked' : 'e.g. 100'}
              className={isCashier ? 'bg-slate-100/90 text-slate-500 cursor-not-allowed select-none' : ''}
            />
          </FormField>
        </div>
      </form>
    </Modal>
  );
};

export const AddonModal = ({ isOpen, onClose, addon = null }) => {
  const { user } = useAppStore();
  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );
  if (!isOpen || isCashier) return null;
  return <AddonModalForm key={addon?.id || 'new_addon'} isOpen={isOpen} onClose={onClose} addon={addon} />;
};

export default AddonModal;
