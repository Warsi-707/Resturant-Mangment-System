import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  ChefHat,
  User,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Zap,
  UtensilsCrossed,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useAppStore } from '../store';
import { getImage } from '../services/persistence/imageStorage';
import { storage } from '../services/persistence/storage';

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated, settings } = useAppStore();

  const restaurantName = settings?.business?.name || settings?.restaurantName || 'SpiceHub';
  const tagline = settings?.business?.tagline || settings?.tagline || 'Restaurant & Grill • Point of Sale';
  const logoRef = settings?.business?.logoRef || settings?.logoRef || null;

  const [logoUrl, setLogoUrl] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function loadLogo() {
      if (!logoRef) {
        setLogoUrl(null);
        return;
      }
      if (logoRef.startsWith('data:') || logoRef.startsWith('blob:') || logoRef.startsWith('http://') || logoRef.startsWith('https://')) {
        setLogoUrl(logoRef);
        return;
      }
      try {
        const url = await getImage(logoRef);
        if (isMounted) setLogoUrl(url);
      } catch {
        if (isMounted) setLogoUrl(null);
      }
    }
    loadLogo();
    return () => {
      isMounted = false;
    };
  }, [logoRef]);

  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // If already logged in, redirect straight to dashboard
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogin = async (e) => {
    e?.preventDefault();
    setError('');

    const trimmedIdentifier = usernameOrEmail.trim();
    if (!trimmedIdentifier) {
      setError('Please enter your username or email');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    try {
      setIsLoading(true);
      const res = await login({ usernameOrEmail: trimmedIdentifier, password });
      if (res.success) {
        navigate('/dashboard', { replace: true });
      } else {
        setError(res.error || 'Invalid credentials');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = (uname, pwd) => {
    setUsernameOrEmail(uname);
    setPassword(pwd);
    setError('');
    setIsLoading(true);
    login({ usernameOrEmail: uname, password: pwd })
      .then((res) => {
        if (res.success) {
          navigate('/dashboard', { replace: true });
        } else {
          setError(res.error || 'Quick login failed');
        }
      })
      .finally(() => setIsLoading(false));
  };

  return (
    <div className="h-screen w-full flex bg-[#FAF8F5] text-slate-800 antialiased overflow-hidden selection:bg-[#FF5C28] selection:text-white">
      {/* ======================================================== */}
      {/* LEFT / HERO SECTION: Brand Orange & Biryani Food Visuals */}
      {/* ======================================================== */}
      <div className="hidden lg:flex lg:w-1/2 h-full relative bg-gradient-to-br from-[#FF5C28] via-[#F24E18] to-[#D83A06] text-white flex-col justify-between p-6 xl:p-10 select-none shadow-2xl overflow-hidden">
        {/* Subtle Decorative Background Curves & Pattern */}
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="food-pattern" width="60" height="60" patternUnits="userSpaceOnUse">
                <circle cx="30" cy="30" r="1.5" fill="white" />
                <path d="M10 10 L20 20 M40 10 L50 20" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#food-pattern)" />
          </svg>
        </div>

        {/* Top Brand Identity Badge */}
        <div className="relative z-10 flex items-center gap-2.5">
          {logoUrl ? (
            <div className="w-10 h-10 flex items-center justify-center shrink-0">
              <img src={logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-md border border-white/25 flex items-center justify-center text-white shadow-lg overflow-hidden shrink-0">
              <ChefHat className="w-5 h-5 stroke-[2.2]" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold tracking-tight leading-tight truncate max-w-[280px] xl:max-w-[360px]" title={restaurantName}>
              {restaurantName}
            </h1>
            <p className="text-[11px] text-orange-100 font-medium tracking-wide truncate max-w-[280px] xl:max-w-[360px]" title={tagline}>
              {tagline}
            </p>
          </div>
        </div>

        {/* Center: Hero Biryani Imagery Presentation */}
        <div className="relative z-10 my-auto py-2 flex flex-col items-center">
          {/* Main Hero Food Circle (Special Biryani) */}
          <div className="relative">
            <div className="w-48 h-48 xl:w-56 xl:h-56 rounded-full p-2 bg-white/20 backdrop-blur-md border-2 border-white/40 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] transition-transform hover:scale-[1.02] duration-300">
              <img
                src="https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format&fit=crop&q=80"
                alt="Delicious Hot Chicken Biryani"
                className="w-full h-full rounded-full object-cover shadow-inner"
              />
            </div>

            {/* Floating Secondary Mini Dish Plate */}
            <div className="absolute -bottom-3 -left-4 w-20 h-20 xl:w-24 xl:h-24 rounded-full p-1 bg-white/25 backdrop-blur-md border border-white/50 shadow-xl transition-transform hover:scale-105 duration-300">
              <img
                src="https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=500&auto=format&fit=crop&q=80"
                alt="Aromatic Desi Special"
                className="w-full h-full rounded-full object-cover"
              />
            </div>
          </div>

          {/* Inspiring Taglines */}
          <div className="mt-4 xl:mt-6 text-center max-w-md">
            <h2 className="text-xl xl:text-2xl font-extrabold tracking-tight leading-snug">
              Authentic Taste. <br />
              <span className="text-orange-200">Lightning-Fast Billing.</span>
            </h2>
            <p className="mt-1.5 text-xs text-orange-100/90 leading-relaxed font-normal">
              Empowering cashiers, kitchens, and restaurant owners with unified real-time orders, receipts, and analytics.
            </p>
          </div>
        </div>

        {/* Bottom Feature Badges */}
        <div className="relative z-10 grid grid-cols-3 gap-2 pt-3 border-t border-white/20 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <Zap className="w-3.5 h-3.5 text-orange-200" />
            <span className="text-[10px] xl:text-[11px] font-semibold text-white">Instant POS</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <UtensilsCrossed className="w-3.5 h-3.5 text-orange-200" />
            <span className="text-[10px] xl:text-[11px] font-semibold text-white">Live KDS Display</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <ShieldCheck className="w-3.5 h-3.5 text-orange-200" />
            <span className="text-[10px] xl:text-[11px] font-semibold text-white">100% Cloud Synced</span>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* RIGHT SECTION: Simple, Decent & Clean Authentication Form */}
      {/* ======================================================== */}
      <div className="w-full lg:w-1/2 h-full flex items-center justify-center p-4 sm:p-6 lg:p-8 xl:p-12 overflow-y-auto">
        <div className="w-full max-w-md space-y-4 sm:space-y-5 my-auto">
          {/* Mobile-only Header Logo */}
          <div className="flex lg:hidden items-center gap-2 mb-1">
            {logoUrl ? (
              <div className="w-9 h-9 flex items-center justify-center shrink-0">
                <img src={logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-[#FF5C28] text-white flex items-center justify-center shadow-md overflow-hidden shrink-0">
                <ChefHat className="w-5 h-5 stroke-[2.2]" />
              </div>
            )}
            <div className="min-w-0">
              <span className="font-extrabold text-base text-slate-900 block leading-tight truncate" title={restaurantName}>
                {restaurantName}
              </span>
              <span className="text-[10px] text-[#FF5C28] font-bold block truncate" title={tagline}>
                {tagline}
              </span>
            </div>
          </div>

          {/* Form Header */}
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
              Welcome Back!
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Sign in with your credentials to access the POS terminal.
            </p>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 animate-in fade-in duration-150">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-3">
            {/* Username or Email Input */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">
                Username or Email
              </label>
              <div className="relative flex items-center">
                <div className="absolute left-3 text-slate-400 pointer-events-none">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={(e) => {
                    setUsernameOrEmail(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="e.g. admin or admin@spicehub.pk"
                  autoFocus
                  required
                  className="w-full h-10 pl-9 pr-3.5 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 transition-colors shadow-2xs"
                />
              </div>
            </div>

            {/* Password Input with Eye Toggle */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">
                  Password
                </label>
              </div>
              <div className="relative flex items-center">
                <div className="absolute left-3 text-slate-400 pointer-events-none">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Enter your password"
                  required
                  className="w-full h-10 pl-9 pr-9 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-800 placeholder:text-slate-400 outline-none focus:outline-none focus:ring-0 focus:border-slate-400 transition-colors shadow-2xs"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-1"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me Checkbox */}
            <div className="flex items-center justify-between pt-0.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-[#FF5C28] focus:ring-0 border-slate-300 cursor-pointer accent-[#FF5C28]"
                />
                <span>Remember this terminal</span>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 sm:h-10.5 rounded-xl bg-[#FF5C28] hover:bg-[#E04D1D] active:bg-[#D83F0E] text-white text-xs sm:text-sm font-bold shadow-md shadow-orange-500/20 hover:shadow-orange-500/30 transition-all cursor-pointer flex items-center justify-center gap-2 mt-1 disabled:opacity-70"
            >
              {isLoading ? (
                <span>Authenticating...</span>
              ) : (
                <>
                  <span>Sign In to Terminal</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Access Credentials */}
          <div className="pt-3 border-t border-slate-200/80 space-y-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block text-center">
              Quick 1-Click Access
            </span>
            {(() => {
              const creds = storage.get('auth_credentials', { admin: 'admin123', cashier: 'cashier123' });
              const adminPwd = creds?.admin || 'admin123';
              const cashierPwd = creds?.cashier || 'cashier123';
              return (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleQuickLogin('admin', adminPwd)}
                    className="p-2 sm:p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-orange-50/60 hover:border-orange-200 transition-colors text-left cursor-pointer group shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-800 group-hover:text-[#FF5C28]">
                        Admin Login
                      </span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#FF5C28]" />
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      admin / {adminPwd}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickLogin('cashier', cashierPwd)}
                    className="p-2 sm:p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-orange-50/60 hover:border-orange-200 transition-colors text-left cursor-pointer group shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-800 group-hover:text-[#FF5C28]">
                        Cashier Login
                      </span>
                      <CheckCircle2 className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#FF5C28]" />
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      cashier / {cashierPwd}
                    </span>
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
