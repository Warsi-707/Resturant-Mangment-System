import React, { useState, useMemo } from 'react';
import {
  User,
  Lock,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  UserPlus,
  Trash2,
  Mail,
  Phone,
  Building2,
  Search,
  RotateCw,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  UserX,
  X,
  Sparkles,
} from 'lucide-react';
import { useAppStore } from '../../../store';
import { storage } from '../../../services/persistence/storage';
import { CreateUserModal } from './CreateUserModal';

/**
 * SecuritySettingsTab Component (Users & Access Control)
 * Enterprise-grade users table with instant cashier activation, search & filters,
 * credential management, and quick user provisioning.
 */
export const SecuritySettingsTab = ({
  isCreateModalOpen: propIsOpen,
  setIsCreateModalOpen: propSetIsOpen,
} = {}) => {
  const { user, changePassword } = useAppStore();
  const isCashier = Boolean(
    (user?.role?.toLowerCase().includes('cashier') && !user?.role?.toLowerCase().includes('admin')) ||
    (user?.username?.toLowerCase() === 'cashier' && user?.username?.toLowerCase() !== 'admin')
  );

  // Modal State
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isCreateModalOpen = propIsOpen !== undefined ? propIsOpen : internalIsOpen;
  const setIsCreateModalOpen = propSetIsOpen || setInternalIsOpen;

  // Users State (strictly live real data)
  const [customUsers, setCustomUsers] = useState(() => {
    const saved = storage.get('rms_custom_users', []);
    return Array.isArray(saved) ? saved : [];
  });

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');

  // Feedback Notification Banner
  const [globalNotice, setGlobalNotice] = useState('');
  const [noticeType, setNoticeType] = useState('success'); // 'success' | 'info' | 'error'

  // Change Password Modal State
  const [passwordTargetUser, setPasswordTargetUser] = useState(null); // { id, name, role, isCoreAdmin, isCoreCashier }
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Refresh user data from persistent storage
  const handleRefresh = () => {
    const saved = storage.get('rms_custom_users', []);
    setCustomUsers(Array.isArray(saved) ? saved : []);
    setNoticeType('info');
    setGlobalNotice('User accounts and access states synchronized.');
    setTimeout(() => setGlobalNotice(''), 3000);
  };

  // Add newly created user
  const handleUserCreated = (newUser) => {
    const enriched = {
      ...newUser,
      status: newUser.status || 'active',
      isActive: newUser.isActive !== false,
    };
    const updated = [enriched, ...customUsers.filter((u) => u.id !== enriched.id)];
    setCustomUsers(updated);
    storage.set('rms_custom_users', updated);
    setNoticeType('success');
    setGlobalNotice(`Cashier account "${newUser.fullName}" added successfully and is now ACTIVE!`);
    setTimeout(() => setGlobalNotice(''), 5000);
  };

  // Toggle user Active / Deactivated status
  const handleToggleUserStatus = (targetUserId) => {
    const targetUser = customUsers.find((u) => u.id === targetUserId);
    if (!targetUser) return;

    const currentStatus = targetUser.status || (targetUser.isActive === false ? 'deactivated' : 'active');
    const newStatus = currentStatus === 'active' ? 'deactivated' : 'active';
    const isNowActive = newStatus === 'active';

    const updated = customUsers.map((u) => {
      if (u.id === targetUserId) {
        return {
          ...u,
          status: newStatus,
          isActive: isNowActive,
          updatedAt: new Date().toISOString(),
        };
      }
      return u;
    });

    setCustomUsers(updated);
    storage.set('rms_custom_users', updated);

    setNoticeType(isNowActive ? 'success' : 'info');
    setGlobalNotice(
      isNowActive
        ? `"${targetUser.fullName || targetUser.name}" is now ACTIVE! This cashier can sign in and take orders.`
        : `"${targetUser.fullName || targetUser.name}" has been DEACTIVATED. Login access suspended.`
    );
    setTimeout(() => setGlobalNotice(''), 5000);
  };

  // Delete user account
  const handleDeleteUser = (userId, userName) => {
    if (window.confirm(`Are you sure you want to permanently delete access for "${userName}"?`)) {
      const updated = customUsers.filter((u) => u.id !== userId);
      setCustomUsers(updated);
      storage.set('rms_custom_users', updated);
      setNoticeType('info');
      setGlobalNotice(`Account for "${userName}" has been removed.`);
      setTimeout(() => setGlobalNotice(''), 4000);
    }
  };

  // Open Change Password Modal
  const handleOpenPasswordModal = (target) => {
    setPasswordTargetUser(target);
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setPasswordError('');
    setPasswordSuccess('');
  };

  // Submit Password Change
  const handleSavePassword = async (e) => {
    e?.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!newPassword) {
      setPasswordError('Please enter a new password');
      return;
    }
    if (newPassword.length < 4) {
      setPasswordError('Password must be at least 4 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirm password do not match');
      return;
    }

    try {
      setPasswordSaving(true);

      if (passwordTargetUser.isCoreAdmin) {
        const res = await changePassword({
          targetRole: 'admin',
          newPassword,
        });
        if (!res.success) throw new Error(res.message || 'Failed to update Admin password');
      } else if (passwordTargetUser.isCoreCashier) {
        const res = await changePassword({
          targetRole: 'cashier',
          newPassword,
        });
        if (!res.success) throw new Error(res.message || 'Failed to update Cashier password');
      } else {
        // Custom user
        const updated = customUsers.map((u) => {
          if (u.id === passwordTargetUser.id) {
            return { ...u, password: newPassword, updatedAt: new Date().toISOString() };
          }
          return u;
        });
        setCustomUsers(updated);
        storage.set('rms_custom_users', updated);
      }

      setPasswordSuccess('Password updated successfully!');
      setTimeout(() => {
        setPasswordTargetUser(null);
        setNoticeType('success');
        setGlobalNotice(`Password for "${passwordTargetUser.name}" has been updated.`);
        setTimeout(() => setGlobalNotice(''), 4000);
      }, 1000);
    } catch (err) {
      setPasswordError(err.message || 'Failed to update password');
    } finally {
      setPasswordSaving(false);
    }
  };

  // Compile combined real users list:
  // Row 1: System Admin
  // Row 2+: Real custom cashiers provisioned by the user
  const allUsersList = useMemo(() => {
    const list = [
      {
        id: 'user-core-admin',
        name: 'Administrator',
        fullName: 'Administrator',
        title: 'Executive Officer',
        loginIdentifier: 'admin',
        email: 'admin@spicehub.pk',
        phone: '+92 (300) 111-2233',
        role: 'admin',
        portalRole: 'Super Admin',
        roleLabel: 'Super Admin',
        branch: 'All Branches (Consolidated)',
        recordType: 'Direct System User',
        status: 'active',
        isActive: true,
        isCoreAdmin: true,
        isYou: Boolean(user?.role?.toLowerCase().includes('admin') || user?.username === 'admin'),
      },
    ];

    customUsers.forEach((u) => {
      const isRoleAdmin =
        (u.portalRole && u.portalRole.toLowerCase().includes('admin')) ||
        (u.role && u.role.toLowerCase().includes('admin'));
      const status = u.status || (u.isActive === false ? 'deactivated' : 'active');
      const isYou = user?.id === u.id || user?.username === u.username || user?.email === u.email;

      list.push({
        id: u.id,
        name: u.fullName || u.name || 'Cashier',
        fullName: u.fullName || u.name || 'Cashier',
        title: u.officialTitle || u.portalRole || (isRoleAdmin ? 'Branch Admin' : 'Cashier & Billing'),
        loginIdentifier: u.loginIdentifier || u.username || u.email,
        email: u.email || u.loginIdentifier,
        phone: u.phone || '',
        role: isRoleAdmin ? 'admin' : 'cashier',
        portalRole: u.portalRole || (isRoleAdmin ? 'Branch Admin' : 'Cashier'),
        roleLabel: isRoleAdmin ? 'Branch Admin' : 'Cashier',
        branch: u.branchScope || u.branch || 'Main Branch',
        recordType: 'Direct System User',
        status: status,
        isActive: status === 'active',
        isCoreAdmin: false,
        isCoreCashier: false,
        isYou,
      });
    });

    return list;
  }, [customUsers, user]);

  // Apply filters & search
  const filteredUsers = useMemo(() => {
    return allUsersList.filter((u) => {
      // Role filter
      if (roleFilter !== 'all') {
        if (roleFilter === 'admin' && u.role !== 'admin') return false;
        if (roleFilter === 'cashier' && u.role !== 'cashier') return false;
      }

      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && u.status !== 'active') return false;
        if (statusFilter === 'deactivated' && u.status !== 'deactivated') return false;
      }

      // Branch filter
      if (branchFilter !== 'all') {
        if (!u.branch.toLowerCase().includes(branchFilter.toLowerCase())) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (u.fullName || '').toLowerCase().includes(q);
        const matchLogin = (u.loginIdentifier || '').toLowerCase().includes(q);
        const matchTitle = (u.title || '').toLowerCase().includes(q);
        const matchPhone = (u.phone || '').toLowerCase().includes(q);
        if (!matchName && !matchLogin && !matchTitle && !matchPhone) return false;
      }

      return true;
    });
  }, [allUsersList, roleFilter, statusFilter, branchFilter, searchQuery]);

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* ======================================================== */}
      {/* 1. TOP HEADER & BREADCRUMB (Image 2 styling) */}
      {/* ======================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase bg-blue-50 text-blue-700 border border-blue-200/60">
              Enterprise Access Control
            </span>
            <span className="text-xs text-slate-400 font-medium">• Users & Permissions</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Users & Access Control
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage authenticated portal accounts, branch scopes, and credential provisioning.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition-all shadow-2xs cursor-pointer"
            title="Refresh user accounts"
          >
            <RotateCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Refresh</span>
          </button>

          {!isCashier && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#FF5C28] hover:bg-[#E64A19] active:bg-[#D83F0E] transition-all shadow-sm shadow-orange-500/25 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Create User Account</span>
            </button>
          )}
        </div>
      </div>

      {/* Global Notice Alert */}
      {globalNotice && (
        <div
          className={`p-3 rounded-2xl text-xs flex items-center justify-between gap-2 animate-in fade-in duration-150 border ${
            noticeType === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : noticeType === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle
              className={`w-4 h-4 shrink-0 ${
                noticeType === 'success'
                  ? 'text-emerald-600'
                  : noticeType === 'error'
                  ? 'text-rose-600'
                  : 'text-blue-600'
              }`}
            />
            <span className="font-semibold">{globalNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setGlobalNotice('')}
            className="font-bold text-xs hover:opacity-75 cursor-pointer p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. FILTER & SEARCH BAR (Image 2 styling) */}
      {/* ======================================================== */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, or designation..."
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/20 text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none transition-all bg-slate-50/50 focus:bg-white"
          />
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2 shrink-0 text-xs">
          {/* Branch Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
            <span className="text-slate-400 font-medium">Branch:</span>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="bg-transparent font-semibold text-slate-700 outline-none cursor-pointer pr-1"
            >
              <option value="all">All Branches</option>
              <option value="Main Branch">Main Branch</option>
            </select>
          </div>

          {/* Role Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
            <span className="text-slate-400 font-medium">Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-transparent font-semibold text-slate-700 outline-none cursor-pointer pr-1"
            >
              <option value="all">All Roles</option>
              <option value="admin">Super Admin</option>
              <option value="cashier">Cashier</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
            <span className="text-slate-400 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent font-semibold text-slate-700 outline-none cursor-pointer pr-1"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. ENTERPRISE USERS TABLE (Image 2 Layout) */}
      {/* ======================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/90 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">NAME & TITLE</th>
                <th className="py-3 px-4">LOGIN IDENTIFIER</th>
                <th className="py-3 px-4">SYSTEM ROLE</th>
                <th className="py-3 px-4">ASSIGNED BRANCH</th>
                <th className="py-3 px-4">LINKED EMPLOYEE RECORD</th>
                <th className="py-3 px-4 text-center">ACCESS STATUS</th>
                <th className="py-3 px-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <UserX className="w-8 h-8 text-slate-300" />
                      <p className="text-sm font-semibold text-slate-600">No matching user accounts found</p>
                      <p className="text-xs text-slate-400">
                        Try adjusting your search criteria or click "+ Create User Account" to add a new cashier.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isAdmin = u.role === 'admin';
                  const initials = (u.fullName || u.name || 'User')
                    .split(' ')
                    .filter(Boolean)
                    .map((n) => n[0].toUpperCase())
                    .slice(0, 2)
                    .join('');

                  const isActive = u.status === 'active';

                  return (
                    <tr
                      key={u.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        !isActive ? 'bg-slate-50/40 text-slate-400' : ''
                      }`}
                    >
                      {/* 1. Name & Title */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                              isAdmin
                                ? 'bg-blue-50 text-blue-700 border border-blue-200/80'
                                : isActive
                                ? 'bg-amber-50 text-amber-800 border border-amber-200/80'
                                : 'bg-slate-100 text-slate-400 border border-slate-200'
                            }`}
                          >
                            {initials}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className={`font-bold text-sm ${isActive ? 'text-slate-900' : 'text-slate-500'}`}>
                                {u.fullName}
                              </span>
                              {u.isYou && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium">
                              {u.title}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* 2. Login Identifier */}
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <div className="space-y-0.5">
                          <div className="text-slate-800 font-semibold flex items-center gap-1">
                            <Mail className="w-3 h-3 text-slate-400" />
                            <span>{u.loginIdentifier}</span>
                          </div>
                          {u.phone && (
                            <div className="text-slate-400 text-[10px] flex items-center gap-1">
                              <Phone className="w-2.5 h-2.5 text-slate-400" />
                              <span>{u.phone}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 3. System Role */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            isAdmin
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isAdmin ? 'bg-blue-600' : 'bg-amber-600'}`} />
                          {u.portalRole}
                        </span>
                      </td>

                      {/* 4. Assigned Branch */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 text-slate-600 text-xs">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{u.branch}</span>
                        </div>
                      </td>

                      {/* 5. Linked Employee Record */}
                      <td className="py-3.5 px-4 text-slate-500 text-xs">
                        {u.recordType}
                      </td>

                      {/* 6. Access Status (Interactive Toggle Pill) */}
                      <td className="py-3.5 px-4 text-center">
                        {u.isCoreAdmin ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            Active
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleToggleUserStatus(u.id)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95 ${
                              isActive
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                : 'bg-slate-100 text-slate-500 border border-slate-300 hover:bg-slate-200'
                            }`}
                            title={isActive ? 'Click to deactivate cashier access' : 'Click to activate cashier access'}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isActive ? 'bg-emerald-600 animate-pulse' : 'bg-slate-400'
                              }`}
                            />
                            <span>{isActive ? 'Active' : 'Deactivated'}</span>
                          </button>
                        )}
                      </td>

                      {/* 7. Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Change Password */}
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenPasswordModal({
                                id: u.id,
                                name: u.fullName,
                                role: u.role,
                                isCoreAdmin: u.isCoreAdmin,
                                isCoreCashier: u.isCoreCashier,
                              })
                            }
                            className="p-1.5 rounded-lg text-slate-500 hover:text-[#FF5C28] hover:bg-orange-50 transition-colors cursor-pointer"
                            title={`Change password for ${u.fullName}`}
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>

                          {/* Delete Account (custom users only) */}
                          {!u.isCoreAdmin && !isCashier && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u.id, u.fullName)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title={`Delete account for ${u.fullName}`}
                            >
                              <Trash2 className="w-4 h-4" />
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

        {/* Footer Summary Bar */}
        <div className="bg-slate-50/80 px-4 py-3 border-t border-slate-200/90 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Showing <strong className="text-slate-800">{filteredUsers.length}</strong> of{' '}
            <strong className="text-slate-800">{allUsersList.length}</strong> authenticated portal accounts
          </span>
          <span className="text-[11px] text-slate-400">
            Click on any cashier's <strong>Access Status</strong> pill to instantly toggle between Active and Deactivated.
          </span>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 4. CHANGE PASSWORD MODAL */}
      {/* ======================================================== */}
      {passwordTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            onClick={() => setPasswordTargetUser(null)}
          />

          <div className="relative bg-white rounded-3xl border border-slate-200/90 shadow-2xl w-full max-w-md p-5 sm:p-6 z-10 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-orange-50 text-[#FF5C28] flex items-center justify-center">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 tracking-tight">
                    Change Password
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Updating credentials for <strong className="text-slate-700">{passwordTargetUser.name}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPasswordTargetUser(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePassword} className="mt-4 space-y-4">
              {passwordError && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{passwordError}</span>
                </div>
              )}

              {passwordSuccess && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{passwordSuccess}</span>
                </div>
              )}

              {/* New Password */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  New Password <span className="text-[#FF5C28]">*</span>
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 4 characters)"
                    className="w-full h-10 pl-3 pr-10 rounded-xl border border-slate-200 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/20 text-xs font-medium text-slate-800 outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  Confirm New Password <span className="text-[#FF5C28]">*</span>
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/20 text-xs font-medium text-slate-800 outline-none transition-all"
                />
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPasswordTargetUser(null)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-[#FF5C28] hover:bg-[#E64A19] active:bg-[#D83F0E] transition-all shadow-sm shadow-orange-500/25 cursor-pointer disabled:opacity-50"
                >
                  {passwordSaving ? 'Saving...' : 'Save Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal Dialog */}
      <CreateUserModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onUserCreated={handleUserCreated}
      />
    </div>
  );
};

export default SecuritySettingsTab;
