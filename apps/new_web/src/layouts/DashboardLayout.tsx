import React, { useState, useEffect } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useWallet } from '../contexts/WalletContext';
import { FiMenu, FiLogOut, FiUsers, FiBox, FiUserCheck, FiHome, FiBriefcase, FiFilePlus, FiFileMinus, FiFileText, FiDollarSign, FiList, FiShoppingCart, FiPenTool } from 'react-icons/fi';
import { dashboardService, orderService, stellarService } from '../services/api';
import Wordmark from '../components/Wordmark';
import toast from 'react-hot-toast';

const gestorMenuItems = [
  { to: '/dashboard', icon: <FiHome />, name: 'Dashboard' },
  { to: '/consultores', icon: <FiUsers />, name: 'Consultants', countKey: 'consultores' },
  { to: '/investidores', icon: <FiUserCheck />, name: 'Investors', countKey: 'investidores' },
  { to: '/fundos', icon: <FiBox />, name: 'Funds', countKey: 'funds' },
  { to: '/investments', icon: <FiDollarSign />, name: 'Investments', countKey: 'investments' },
  { to: '/assignors', icon: <FiFilePlus />, name: 'Assignors', countKey: 'assignors' },
  { to: '/debtors', icon: <FiFileMinus />, name: 'Debtors', countKey: 'debtors' },
  { to: '/receivables', icon: <FiFileText />, name: 'Receivables' },
];

const consultorMenuItems = [
    { to: '/dashboard', icon: <FiHome />, name: 'My Funds' },
];

const investidorMenuItems = [
    { to: '/dashboard', icon: <FiHome />, name: 'Dashboard' },
    { to: '/agent', icon: <FiPenTool />, name: 'Agent' },
    { to: '/marketplace', icon: <FiShoppingCart />, name: 'Marketplace' },
    { to: '/portfolio', icon: <FiBriefcase />, name: 'Portfolio' },
    { to: '/orders', icon: <FiList />, name: 'Orders' },
];

interface PendingCounts {
  consultores: number;
  investidores: number;
  funds: number;
  investments?: number;
  assignors: number;
  debtors: number;
}

const Sidebar: React.FC<{ isOpen: boolean; role: string; pendingCounts: PendingCounts | null }> = ({
  isOpen,
  role,
  pendingCounts,
}) => {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const isExpanded = isOpen || !isCollapsed;
  const sidebarWidth = isExpanded ? 'w-64' : 'w-20';
  const [showLabels, setShowLabels] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    if (isExpanded) {
      timer = window.setTimeout(() => setShowLabels(true), 120); // wait for width animation
    } else {
      setShowLabels(false);
    }
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isExpanded]);

  let menuItems: typeof gestorMenuItems | typeof consultorMenuItems | typeof investidorMenuItems = [];
  if (role === 'GESTOR') menuItems = gestorMenuItems;
  else if (role === 'CONSULTOR') menuItems = consultorMenuItems;
  else if (role === 'INVESTIDOR') menuItems = investidorMenuItems;

  return (
    <aside
      onMouseEnter={() => setIsCollapsed(false)}
      onMouseLeave={() => setIsCollapsed(true)}
      className={`fixed top-0 left-0 h-full transition-all duration-300 ease-in-out z-40 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      } md:relative md:translate-x-0 ${sidebarWidth} flex flex-col`}
    >
      <div className="flex items-center justify-center h-20 border-b border-gray-700 px-3">
        <Link to="/dashboard" className="flex items-center">
          <Wordmark compact className="text-lg text-white" />
        </Link>
      </div>
      <nav className="flex-1 px-2 py-8 space-y-2">
        {menuItems.map((item) => {
          const count =
            'countKey' in item && pendingCounts ? (pendingCounts[item.countKey as keyof PendingCounts] ?? 0) : 0;
          const showBadge = role === 'GESTOR' && count > 0;
          const isActive =
            item.to === '/dashboard'
              ? location.pathname === '/dashboard'
              : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

          return (
            <NavLink
              key={item.name}
              to={item.to}
              className={() =>
                `flex items-center ${isExpanded ? 'px-4 gap-3' : 'justify-center px-3'} py-3 transition-colors duration-200 rounded-lg ${
                  isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-gray-300 hover:bg-primary/5'
                }`
              }
            >
              <div className={`flex items-center ${isExpanded ? 'gap-3' : 'justify-center w-full'}`}>
                <div className="relative flex items-center justify-center text-lg">
                  <span className="text-lg">{item.icon}</span>
                  {showBadge && !isExpanded && (
                    <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-[#FA7F7F] rounded-full">
                      {count}
                    </span>
                  )}
                </div>
                {showLabels && <span className="ml-4 font-medium">{item.name}</span>}
                {showBadge && showLabels && (
                  <span className="ml-auto flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-[#FA7F7F] rounded-full">
                    {count}
                  </span>
                )}
              </div>
            </NavLink>
          );
        })}
      </nav>
      <div className="px-4 py-6 border-t border-gray-700">
        {/* Logout button moved to Header */}
      </div>
    </aside>
  );
};

const Header: React.FC<{ userEmail: string; userRole: string; onMenuClick: () => void; onLogout: () => void; }> = ({ userEmail, onMenuClick, onLogout }) => {
  // Every role may need a wallet: investors pay, consultants issue fund shares, managers approve/refund
  const shouldShowWallet = true;
  const { publicKey, isConnected, connect, disconnect, signAndSubmitTransaction } = useWallet();
  const [fauceting, setFauceting] = useState(false);

  // Testnet helper. Default: a USDC trustline from the user's own account, then the operator sends test USDC.
  // The public testnet faucet (trustlines for several test assets) is used only if the operator transfer is not
  // available (404).
  const getTestUsdc = async () => {
    if (!publicKey) return;
    setFauceting(true);
    const toastId = toast.loading('Preparing a USDC trustline...');
    const reason = (e: unknown) => {
      const codes = (e as any)?.response?.data?.extras?.result_codes;
      if (codes) return [codes.transaction, ...(codes.operations ?? [])].filter(Boolean).join(', ');
      return String((e as any)?.response?.data?.error || (e as any)?.message || e).slice(0, 160);
    };
    try {
      const { hasTrustline, transactionXdr } = await stellarService.getUsdcTrustline(publicKey);
      if (!hasTrustline && transactionXdr) await signAndSubmitTransaction(transactionXdr);
    } catch (error) {
      toast.error(`Could not add the USDC trustline (${reason(error)})`, { id: toastId });
      setFauceting(false);
      return;
    }
    try {
      toast.loading('Requesting test USDC...', { id: toastId });
      await stellarService.sendTestUsdc(publicKey);
      toast.success('USDC trustline ready and test USDC received', { id: toastId });
    } catch (sendError) {
      if ((sendError as any)?.response?.status !== 404) {
        toast.error(`USDC trustline ready. Test USDC was not sent (${reason(sendError)}); ask the operator.`, { id: toastId });
      } else {
        try {
          toast.loading('Operator transfer not available; using the testnet faucet (it adds trustlines for several test assets)...', { id: toastId });
          const { transactionXdr } = await stellarService.getTestUsdc(publicKey);
          await signAndSubmitTransaction(transactionXdr);
          toast.success('Test USDC received from the testnet faucet', { id: toastId });
        } catch (faucetError) {
          toast.error(`USDC trustline ready. Ask the operator to send test USDC (${reason(faucetError)}).`, { id: toastId });
        }
      }
    } finally {
      setFauceting(false);
    }
  };

  return (
    <header className="flex min-h-20 shrink-0 items-center justify-between gap-3 border-b border-gray-700 px-4 py-3 md:h-20 md:justify-end md:px-6 md:py-0">
      <button onClick={onMenuClick} className="text-gray-300 md:hidden">
        <FiMenu className="w-6 h-6" />
      </button>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 md:flex-none md:flex-nowrap md:gap-4">
        {shouldShowWallet && (
          <>
            {isConnected && publicKey ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg">
                  {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
                </span>
                <button
                  onClick={getTestUsdc}
                  disabled={fauceting}
                  className="px-3 py-1.5 text-xs font-medium text-primary border border-primary/40 rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  Get test USDC
                </button>
                <button
                  onClick={disconnect}
                  className="px-3 py-1.5 text-xs font-medium text-[#FA7F7F] bg-[#fa7f7f]-50 border border-red-200 rounded-lg hover:bg-[#fa7f7f]-100 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={connect}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
              >
                Connect Wallet
              </button>
            )}
          </>
        )}
        <span className="hidden max-w-64 truncate text-sm font-medium text-gray-200 sm:inline">{userEmail}</span>
        <button onClick={onLogout} className="flex items-center p-2 text-gray-300 transition-colors duration-200 rounded-lg hover:bg-[#FA7F7F] hover:text-white">
          <FiLogOut />
        </button>
      </div>
    </header>
  );
};

const DashboardLayout: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [pendingCounts, setPendingCounts] = useState<PendingCounts | null>(null);
  const { user, logout } = useAuth();

  useEffect(() => {
    const fetchPendingCounts = async () => {
      if (user?.role === 'GESTOR') {
        try {
          const response = await dashboardService.getPendingCounts();
          let counts = response.pendingCounts || null;

          // Also compute pending investments to surface notifications in sidebar
          try {
            const ordersResp = await orderService.list();
            const pendingInvestments = (ordersResp?.orders || []).filter(
              (order: { status?: string }) => order.status === 'PENDING'
            ).length;
            counts = counts ? { ...counts, investments: pendingInvestments } : { investments: pendingInvestments };
          } catch (orderErr) {
            console.error('Error fetching investments count:', orderErr);
          }

          setPendingCounts(counts);
        } catch (error) {
          console.error('Error fetching pending counts:', error);
        }
      }
    };

    fetchPendingCounts();
    
    // Refresh counts every 30 seconds
    const interval = setInterval(fetchPendingCounts, 30000);
    
    return () => clearInterval(interval);
  }, [user?.role]);

  if (!user) return null; // Should be handled by ProtectedRoute, but good practice

  return (
    <div className="flex h-screen">
      <Sidebar isOpen={isSidebarOpen} role={user.role} pendingCounts={pendingCounts} />
      <div className="flex min-w-0 flex-1 flex-col">
        {isSidebarOpen && <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-black opacity-50 md:hidden"></div>}
        <Header userEmail={user.email} userRole={user.role} onMenuClick={() => setSidebarOpen(pre => !pre)} onLogout={logout} />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
