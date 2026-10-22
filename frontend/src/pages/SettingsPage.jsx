import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { useAppStore } from '../store';
import { BusinessProfileTab } from '../features/settings/components/BusinessProfileTab';
import { TaxSettingsTab } from '../features/settings/components/TaxSettingsTab';
import { POSSettingsTab } from '../features/settings/components/POSSettingsTab';
import { InvoiceSettingsTab } from '../features/settings/components/InvoiceSettingsTab';
import { PaymentSettingsTab } from '../features/settings/components/PaymentSettingsTab';
import { DataManagementTab } from '../features/settings/components/DataManagementTab';
import { DeletionHistoryTab } from '../features/settings/components/DeletionHistoryTab';
import { SecuritySettingsTab } from '../features/settings/components/SecuritySettingsTab';

/**
 * SettingsPage Component
 * Full-featured Settings Module supporting Business Profile, Security & Passwords, Payment Accounts, Tax, POS, Invoice, Data Management, and Deletion History.
 */
export const SettingsPage = () => {
  const { section } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { settings, updateSettings, user } = useAppStore();

  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );

  const resolveTabFromParams = (sec, queryTab) => {
    const raw = queryTab || sec || '';
    const clean = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (clean === 'security' || clean === 'password' || clean === 'passwords' || clean === 'user' || clean === 'users' || clean === 'access' || clean === 'useraccess') return 'security';
    if (clean === 'payment' || clean === 'payments' || clean === 'account' || clean === 'accounts') return 'payment';
    if (clean === 'tax' || clean === 'taxes') return 'tax';
    if (clean === 'pos') return 'pos';
    if (clean === 'invoice' || clean === 'invoices') return 'invoice';
    if (clean === 'data' || clean === 'datamanagement') return 'data';
    if (clean === 'history' || clean === 'deletion' || clean === 'deletionhistory') return 'history';
    return 'profile';
  };

  const initialTab = useMemo(() => {
    return resolveTabFromParams(section, searchParams.get('tab'));
  }, [section, searchParams]);

  const [activeTab, setActiveTabState] = useState(initialTab);

  useEffect(() => {
    const target = resolveTabFromParams(section, searchParams.get('tab'));
    if (isCashier && (target === 'history' || target === 'data')) {
      setActiveTabState('profile');
    } else {
      setActiveTabState(target);
    }
  }, [section, searchParams, isCashier]);

  const setActiveTab = (newTab) => {
    if (isCashier && (newTab === 'history' || newTab === 'data')) return;
    setActiveTabState(newTab);
    navigate(`/settings/${newTab}`);
  };

  const sectionMeta = useMemo(() => {
    switch (activeTab) {
      case 'security':
        return {
          title: 'User & Access Control',
          subtitle: 'Provision administrative and cashier portal users, credentials, and access permissions.',
        };
      case 'payment':
        return {
          title: 'Payment Accounts',
          subtitle: 'Manage accepted payment methods, cash drawers, digital wallets, and cards.',
        };
      case 'tax':
        return {
          title: 'Tax Settings',
          subtitle: 'Configure automated sales tax (GST/VAT), rates, and tax registration info.',
        };
      case 'pos':
        return {
          title: 'POS Settings',
          subtitle: 'Set order workflow, kitchen ticket routing, register behavior, and counter defaults.',
        };
      case 'invoice':
        return {
          title: 'Invoice Settings',
          subtitle: 'Invoice layout, header notes, terms and conditions, and printing format.',
        };
      case 'data':
        return {
          title: 'Data Management',
          subtitle: 'Export reports, ledger spreadsheets, backup storage, and database reset controls.',
        };
      case 'history':
        return {
          title: 'Deletion History',
          subtitle: 'Audited log of voided orders, deleted invoices, and supervisor authorizations.',
        };
      case 'profile':
      default:
        return {
          title: 'Business Profile',
          subtitle: 'Configure restaurant identity, branding logo, contact info, and tax registration details.',
        };
    }
  }, [activeTab]);

  const handleSaveSettings = async (updates) => {
    updateSettings(updates);
  };

  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);

  return (
    <div className="space-y-6 w-full max-w-[1280px]">
      {/* Top Header for regular settings tabs */}
      {activeTab !== 'security' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              {sectionMeta.title}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {sectionMeta.subtitle}
            </p>
          </div>
        </div>
      )}

      {/* Active Tab Content */}
      {activeTab === 'profile' && (
        <BusinessProfileTab
          settings={settings}
          onSave={handleSaveSettings}
        />
      )}

      {activeTab === 'security' && (
        <SecuritySettingsTab
          isCreateModalOpen={isCreateUserModalOpen}
          setIsCreateModalOpen={setIsCreateUserModalOpen}
        />
      )}

      {activeTab === 'payment' && (
        <PaymentSettingsTab
          settings={settings}
          onSave={handleSaveSettings}
        />
      )}

      {activeTab === 'tax' && (
        <TaxSettingsTab
          settings={settings}
          onSave={handleSaveSettings}
        />
      )}

      {activeTab === 'pos' && (
        <POSSettingsTab
          settings={settings}
          onSave={handleSaveSettings}
        />
      )}

      {activeTab === 'invoice' && (
        <InvoiceSettingsTab
          settings={settings}
          onSave={handleSaveSettings}
        />
      )}

      {!isCashier && activeTab === 'data' && (
        <DataManagementTab />
      )}

      {!isCashier && activeTab === 'history' && (
        <DeletionHistoryTab />
      )}
    </div>
  );
};

export default SettingsPage;
