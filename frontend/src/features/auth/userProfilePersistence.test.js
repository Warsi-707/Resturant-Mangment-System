import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storage } from '../../services/persistence/storage';
import { useAppStore } from '../../store';

describe('User Profile Persistence Across Logout/Login & Account Switching', () => {
  beforeEach(() => {
    storage.clearAll();
    // mock global fetch so background calls don't fail
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    });
  });

  it('preserves Cashier custom name when logging out, logging into Admin, and returning to Cashier', async () => {
    const store = useAppStore.getState();

    // 1. Initial Cashier Login
    const loginCashierRes = await store.login({ usernameOrEmail: 'cashier', password: '1234' });
    expect(loginCashierRes.success).toBe(true);
    expect(useAppStore.getState().user.name).toBe('Cashier 1');

    // 2. Cashier changes their profile name to 'Ali Khan'
    useAppStore.getState().updateUser({
      name: 'Ali Khan',
      role: 'Head Cashier',
      avatarUrl: 'https://example.com/ali.png',
      initials: 'AK',
    });

    expect(useAppStore.getState().user.name).toBe('Ali Khan');
    expect(useAppStore.getState().user.initials).toBe('AK');

    // 3. Cashier logs out
    await useAppStore.getState().logout();
    expect(useAppStore.getState().isAuthenticated).toBe(false);

    // 4. Admin logs in
    const loginAdminRes = await store.login({ usernameOrEmail: 'admin', password: '12345' });
    expect(loginAdminRes.success).toBe(true);
    expect(useAppStore.getState().user.name).toMatch(/^(Admin|John Holland)$/);

    // 5. Admin updates their name to 'Hamza Owner'
    useAppStore.getState().updateUser({
      name: 'Hamza Owner',
      role: 'Owner & Admin',
      initials: 'HO',
    });
    expect(useAppStore.getState().user.name).toBe('Hamza Owner');

    // 6. Admin logs out
    await useAppStore.getState().logout();
    expect(useAppStore.getState().isAuthenticated).toBe(false);

    // 7. Cashier logs back in: Cashier's customized name MUST be preserved!
    const reloginCashierRes = await store.login({ usernameOrEmail: 'cashier', password: '1234' });
    expect(reloginCashierRes.success).toBe(true);
    const cashierUser = useAppStore.getState().user;
    expect(cashierUser.name).toBe('Ali Khan');
    expect(cashierUser.role).toBe('Head Cashier');
    expect(cashierUser.avatarUrl).toBe('https://example.com/ali.png');
    expect(cashierUser.initials).toBe('AK');

    // 8. Cashier logs out again and Admin logs back in: Admin's customized name MUST be preserved!
    await useAppStore.getState().logout();
    const reloginAdminRes = await store.login({ usernameOrEmail: 'admin', password: '12345' });
    expect(reloginAdminRes.success).toBe(true);
    const adminUser = useAppStore.getState().user;
    expect(adminUser.name).toBe('Hamza Owner');
    expect(adminUser.role).toBe('Owner & Admin');
    expect(adminUser.initials).toBe('HO');
  });

  it('hydrates initial store state from persistent user profile if available', () => {
    storage.set('user_profiles', {
      admin: {
        id: 'user_admin',
        name: 'Executive Chef John',
        username: 'admin',
        role: 'Executive Chef',
        initials: 'EC',
      },
    });

    const profiles = storage.get('user_profiles', {});
    expect(profiles.admin.name).toBe('Executive Chef John');
  });
});
