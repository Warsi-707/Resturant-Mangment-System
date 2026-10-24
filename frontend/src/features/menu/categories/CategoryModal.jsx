import React, { useState } from 'react';
import { Layers } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { FormField } from '../../../components/ui/FormField';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { useAppStore } from '../../../store';
import { isDuplicateCategoryName } from '../../../domain/rules';

const CategoryModalForm = ({
  isOpen,
  onClose,
  category = null,
}) => {
  const { categories, addCategory, updateCategory } = useAppStore();
  const isEdit = Boolean(category?.id);

  const [name, setName] = useState(category?.name || '');
  const [sortOrder, setSortOrder] = useState(
    category?.sortOrder !== undefined && category?.sortOrder !== null ? String(category.sortOrder) : ''
  );
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const validate = () => {
    const errs = {};
    if (!name.trim()) {
      errs.name = 'Category name is required';
    } else if (isDuplicateCategoryName(name, categories, category?.id)) {
      errs.name = 'A category with this name already exists';
    }

    if (sortOrder && sortOrder.trim()) {
      const num = Number(sortOrder.trim());
      if (!Number.isInteger(num) || num <= 0) {
        errs.sortOrder = 'Display order must be a positive whole number (e.g. 1, 2, 3)';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);
    if (!validate()) return;

    const trimmed = name.trim();
    const slug = trimmed
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const cleanSortOrder = sortOrder && sortOrder.trim() ? parseInt(sortOrder.trim(), 10) : null;

    setIsSubmitting(true);
    try {
      if (isEdit) {
        await updateCategory(category.id, {
          name: trimmed,
          slug,
          sortOrder: cleanSortOrder,
        });
      } else {
        await addCategory({
          name: trimmed,
          slug,
          sortOrder: cleanSortOrder,
          status: 'active',
          defaultUnitType: 'piece',
          baseUnit: 'piece',
          keywords: [trimmed.toLowerCase()],
          defaultPortions: [],
          defaultAddonIds: [],
        });
      }
      onClose();
    } catch (err) {
      console.error('[CategoryModal] Save failed:', err);
      setSubmitError(err?.message || 'Failed to save category. Please check backend connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Category' : 'Add Category'}
      icon={Layers}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="secondary" size="md" onClick={onClose} type="button" disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleSubmit} type="button" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : isEdit ? 'Update Category' : 'Add Category'}
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
        <FormField label="Category Name" required error={errors.name}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors({ ...errors, name: null });
            }}
            placeholder="Enter category name..."
            autoFocus
          />
        </FormField>

        <FormField label="Display Order" error={errors.sortOrder}>
          <Input
            type="number"
            min="1"
            step="1"
            value={sortOrder}
            onChange={(e) => {
              setSortOrder(e.target.value);
              if (errors.sortOrder) setErrors({ ...errors, sortOrder: null });
            }}
            placeholder="e.g. 1, 2, 3... (Optional)"
          />
        </FormField>
      </form>
    </Modal>
  );
};

export const CategoryModal = ({ isOpen, onClose, category = null }) => {
  const { user } = useAppStore();
  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );
  if (!isOpen || isCashier) return null;
  return (
    <CategoryModalForm
      key={category?.id || 'new_category'}
      isOpen={isOpen}
      onClose={onClose}
      category={category}
    />
  );
};

export default CategoryModal;
