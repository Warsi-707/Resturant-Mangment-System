import React, { useState } from 'react';
import { Database, Trash2, AlertTriangle, ShieldCheck, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { DeleteDataModal } from './DeleteDataModal';
import { resetApplicationData } from '../../../services/reset/resetService';
import { useAppStore } from '../../../store';

/**
 * DataManagementTab Component
 * Manages local persistence health and houses the guarded Danger Zone for complete operational reset.
 */
export const DataManagementTab = () => {
  const navigate = useNavigate();
  const store = useAppStore;
  const { categories, items, addons, orders, reversals, user } = useAppStore();

  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState('');

  const handlePerformReset = async () => {
    if (isCashier) {
      return;
    }
    const result = await resetApplicationData(store);
    if (result.success) {
      setResetSuccessMessage('All restaurant operational data was permanently deleted.');
      setTimeout(() => {
        navigate('/dashboard');
      }, 400);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      {/* Storage Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-50 text-[#FF5C28] flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <CardTitle>Storage Status</CardTitle>
              <CardDescription>
                Local repository health and current operational records.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-center">
              <span className="text-[11px] text-slate-500 font-medium block">Categories</span>
              <span className="text-base font-bold text-slate-800">{categories.length}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-center">
              <span className="text-[11px] text-slate-500 font-medium block">Menu Items</span>
              <span className="text-base font-bold text-slate-800">{items.length}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-center">
              <span className="text-[11px] text-slate-500 font-medium block">Add-ons</span>
              <span className="text-base font-bold text-slate-800">{addons.length}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-center">
              <span className="text-[11px] text-slate-500 font-medium block">Orders & Invoices</span>
              <span className="text-base font-bold text-slate-800">{orders.length}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-center">
              <span className="text-[11px] text-slate-500 font-medium block">Reversals</span>
              <span className="text-base font-bold text-slate-800">{reversals.length}</span>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center flex flex-col items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-600 mb-0.5" />
              <span className="text-[10px] text-emerald-700 font-bold uppercase tracking-wider">Storage Healthy</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/60 text-xs text-slate-600">
            <p>
              <strong>Architecture:</strong> Frontend First (In-browser IndexedDB & scoped localStorage persistence).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Deletion History Audit Banner */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-orange-50 text-[#FF5C28] flex items-center justify-center shrink-0 border border-orange-100">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-xs text-slate-800">Deletion Audit Trail Active</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Whenever invoices or operational data are deleted or reversed, detailed itemized records with timestamps are archived in the <strong>Deletion History</strong> tab.
            </p>
          </div>
        </div>
      </div>

      {/* Danger Zone — Admin Only */}
      {isCashier ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5 text-xs text-amber-900 flex items-start gap-3 shadow-2xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-amber-900 text-xs">Access Restricted (Admin Only)</h4>
            <p className="text-[11px] text-amber-700 leading-relaxed">
              Operational data deletion and system reset permissions are strictly reserved for Administrator accounts.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5 sm:p-6 space-y-4 shadow-2xs">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 mt-0.5">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-800">
                Danger Zone — Delete All Data
              </h3>
              <p className="text-xs text-rose-600/90 mt-1 leading-relaxed">
                Permanently purges all menu items, categories, add-ons, orders, sales history, reversals, and cart data from local storage.
              </p>
            </div>
          </div>

          {/* Export Advisory per PRD Section 32 */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-amber-900 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Important:</strong> Export any important reports and download invoice PDFs before deleting all data. This action is irreversible.
            </span>
          </div>

          {resetSuccessMessage && (
            <div className="p-3 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-semibold">
              {resetSuccessMessage} Redirecting to Dashboard...
            </div>
          )}

          <div className="pt-1">
            <Button
              variant="danger"
              size="md"
              leftIcon={Trash2}
              onClick={() => setIsDeleteModalOpen(true)}
            >
              Delete All Data
            </Button>
          </div>
        </div>
      )}

      {/* Two-step Confirmation Danger Modal */}
      {!isCashier && (
        <DeleteDataModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirmReset={handlePerformReset}
        />
      )}
    </div>
  );
};

export default DataManagementTab;
