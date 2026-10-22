import React, { useState } from 'react';
import { X, Eye, EyeOff, AlertCircle, UserPlus } from 'lucide-react';

/**
 * CreateUserModal Component
 * Modal dialog to provision new administrative, cashier, or staff portal accounts.
 * Styled with RMS primary brand colors (#FF5C28) and removed unused fields.
 */
export const CreateUserModal = ({ isOpen, onClose, onUserCreated }) => {
  const [portalRole, setPortalRole] = useState('Cashier');
  const [fullName, setFullName] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!portalRole.trim()) {
      setError('Role is required (e.g. Cashier or Admin).');
      return;
    }
    if (!fullName.trim()) {
      setError('Full Name is required.');
      return;
    }
    if (!loginIdentifier.trim()) {
      setError('Login Identifier (Username / Email) is required.');
      return;
    }
    if (!temporaryPassword || temporaryPassword.length < 4) {
      setError('Temporary Password must be at least 4 characters long.');
      return;
    }

    const cleanRole = portalRole.trim();
    const isAdminRole = cleanRole.toLowerCase().includes('admin') || cleanRole.toLowerCase().includes('manager');
    const newUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      fullName: fullName.trim(),
      name: fullName.trim(),
      loginIdentifier: loginIdentifier.trim().toLowerCase(),
      username: loginIdentifier.trim().toLowerCase(),
      email: loginIdentifier.includes('@') ? loginIdentifier.trim().toLowerCase() : `${loginIdentifier.trim().toLowerCase()}@spicehub.pk`,
      portalRole: cleanRole,
      role: isAdminRole ? 'admin' : 'cashier',
      branchScope: 'Main Branch',
      branch: 'Main Branch',
      officialTitle: cleanRole,
      phone: phone.trim(),
      password: temporaryPassword,
      status: 'active',
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    onUserCreated?.(newUser);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog Card */}
      <div className="relative bg-white rounded-3xl border border-slate-200/90 shadow-2xl w-full max-w-lg p-5 sm:p-6 z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-50 text-[#FF5C28] flex items-center justify-center">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Create User Account
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Provision login credentials for administrative or cashier access.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer outline-none focus:outline-none"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* 1. Role */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">
                Role <span className="text-[#FF5C28]">*</span>
              </label>
              <input
                type="text"
                value={portalRole}
                onChange={(e) => setPortalRole(e.target.value)}
                placeholder="e.g. Cashier or Admin"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/20 text-xs font-medium text-slate-800 bg-white outline-none transition-all"
              />
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="text-[10px] text-slate-400">Quick Select:</span>
                <button
                  type="button"
                  onClick={() => setPortalRole('Cashier')}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                    portalRole.toLowerCase() === 'cashier'
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Cashier
                </button>
                <button
                  type="button"
                  onClick={() => setPortalRole('Admin')}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                    portalRole.toLowerCase() === 'admin'
                      ? 'bg-orange-100 text-[#E64A19] border border-orange-300'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Admin
                </button>
              </div>
            </div>

            {/* 2. Full Name */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">
                Full Name <span className="text-[#FF5C28]">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Tariq Mehmood"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/20 text-xs text-slate-800 placeholder:text-slate-400 outline-none transition-all"
              />
            </div>

            {/* 3. Login Identifier (Email / Username) */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">
                Login Identifier (Username / Email) <span className="text-[#FF5C28]">*</span>
              </label>
              <input
                type="text"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                placeholder="e.g. tariq.admin or cashier1"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/20 text-xs text-slate-800 placeholder:text-slate-400 outline-none transition-all"
              />
            </div>

            {/* 4. Phone (Optional) */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">
                Phone (Optional)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+92 (300) 123-4567"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/20 text-xs text-slate-800 placeholder:text-slate-400 outline-none transition-all"
              />
            </div>
          </div>

          {/* 5. Temporary Password */}
          <div className="space-y-1 pt-1">
            <label className="text-xs font-semibold text-slate-700 block">
              Temporary Password <span className="text-[#FF5C28]">*</span>
            </label>
            <div className="relative flex items-center">
              <input
                type={showPassword ? 'text' : 'password'}
                value={temporaryPassword}
                onChange={(e) => setTemporaryPassword(e.target.value)}
                placeholder="e.g. Pass@123"
                className="w-full h-10 pl-3 pr-10 rounded-xl border border-slate-200 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/20 text-xs text-slate-800 placeholder:text-slate-400 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Credentials will be active immediately for login simulation.
            </p>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer outline-none focus:outline-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-[#FF5C28] hover:bg-[#E64A19] active:bg-[#D83F0E] transition-all shadow-sm shadow-orange-500/20 cursor-pointer outline-none focus:outline-none"
            >
              Create Account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateUserModal;
