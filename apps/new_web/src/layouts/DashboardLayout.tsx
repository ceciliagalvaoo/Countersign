import React, { useState, useEffect } from 'react';
import { Outlet, Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { useWallet } from '../contexts/WalletContext';
import { HandIcon } from '../components/ink/HandIcon';
import { dashboardService, orderService, stellarService } from '../services/api';
import Wordmark from '../components/Wordmark';
import { AmbientStroke } from '../components/ink/AmbientStroke';
import AgentDock from '../components/agent/AgentDock';
import toast from 'react-hot-toast';

const gestorMenuItems = [
  { to: '/dashboard', icon: <HandIcon name="home" />, name: 'Dashboard' },
  { to: '/consultores', icon: <HandIcon name="users" />, name: 'Consultants', countKey: 'consultores' },
  { to: '/investidores', icon: <HandIcon name="userCheck" />, name: 'Investors', countKey: 'investidores' },
  { to: '/fundos', icon: <HandIcon name="box" />, name: 'Funds', countKey: 'funds' },
  { to: '/investments', icon: <HandIcon name="coin" />, name: 'Investments', countKey: 'investments' },
  { to: '/assignors', icon: <HandIcon name="filePlus" />, name: 'Assignors', countKey: 'assignors' },
  { to: '/debtors', icon: <HandIcon name="fileMinus" />, name: 'Debtors', countKey: 'debtors' },
  { to: '/receivables', icon: <HandIcon name="file" />, name: 'Receivables' },
];

const consultorMenuItems = [
    { to: '/dashboard', icon: <HandIcon name="home" />, name: 'My Funds' },
];

const investidorMenuItems = [
    { to: '/dashboard', icon: <HandIcon name="home" />, name: 'Dashboard' },
    { to: '/agent', icon: <HandIcon name="pen" />, name: 'Agent' },
    { to: '/marketplace', icon: <HandIcon name="cart" />, name: 'Marketplace' },
    { to: '/portfolio', icon: <HandIcon name="briefcase" />, name: 'Portfolio' },
    { to: '/orders', icon: <HandIcon name="list" />, name: 'Orders' },
];

interface PendingCounts {
  consultores: number;
  investidores: number;
  funds: number;
  investments?: number;
  assignors: number;
  debtors: number;
}

/** Destinations as eyebrow pills in the top bar; the row scrolls sideways on a narrow screen. */
const TopNav: React.FC<{ role: string; pendingCounts: PendingCounts | null }> = ({ role, pendingCounts }) => {
  const location = useLocation();

  let menuItems: typeof gestorMenuItems | typeof consultorMenuItems | typeof investidorMenuItems = [];
  if (role === 'GESTOR') menuItems = gestorMenuItems;
  else if (role === 'CONSULTOR') menuItems = consultorMenuItems;
  else if (role === 'INVESTIDOR') menuItems = investidorMenuItems;

  return (
    <nav className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1" aria-label="Main">
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
            aria-current={isActive ? 'page' : undefined}
            className={`eyebrow inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 transition-colors duration-150 ${
              isActive ? 'bg-cobalt/10 !text-cobalt' : 'hover:!text-navy'
            }`}
          >
            <span className="inline-flex h-4 w-4 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{item.icon}</span>
            {item.name}
            {showBadge && (
              <span className="tabular inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-vermilion px-1 text-[10px] tracking-normal text-cream">
                {count}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
};

const Header: React.FC<{ userEmail: string; onLogout: () => void }> = ({ userEmail, onLogout }) => {
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
    <div className="flex flex-wrap items-center justify-end gap-2">
      {shouldShowWallet && (
        <>
          {isConnected && publicKey ? (
            <>
              <span className="tabular rounded-full border border-navy/10 bg-cream-deep/70 px-3 py-1.5 font-mono text-12 text-navy" title={publicKey}>
                {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
              </span>
              <button onClick={getTestUsdc} disabled={fauceting} className="btn btn-sm btn-secondary">
                Get test USDC
              </button>
              <button onClick={disconnect} className="btn btn-sm btn-ghost">
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={connect} className="btn btn-sm btn-primary">
              Connect Wallet
            </button>
          )}
        </>
      )}
      <span className="hidden max-w-56 truncate text-14 text-ink-soft lg:inline">{userEmail}</span>
      <button onClick={onLogout} className="btn btn-sm btn-ghost !px-3" aria-label="Sign out" title="Sign out">
        <HandIcon name="logout" />
      </button>
    </div>
  );
};

const DashboardLayout: React.FC = () => {
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
    <div className="relative isolate flex min-h-screen flex-col bg-cream">
      <AmbientStroke />
      {/* Ink texture for every line icon in the app: the same hand as the strokes */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <filter id="ink-icon" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.14" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-cobalt focus:px-4 focus:py-2 focus:text-14 focus:text-cream"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-navy/10 bg-cream/95">
        <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 px-4 py-3 md:px-8 min-[1900px]:grid-cols-[1fr_auto_1fr]">
          <Link to="/dashboard" className="shrink-0 rounded-sm" aria-label="Countersign, home">
            <Wordmark size="sm" />
          </Link>
          <div className="order-3 col-span-2 flex min-w-0 justify-center min-[1900px]:order-none min-[1900px]:col-span-1">
            <TopNav role={user.role} pendingCounts={pendingCounts} />
          </div>
          <div className="justify-self-end">
            <Header userEmail={user.email} onLogout={logout} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
      <AgentDock />
    </div>
  );
};

export default DashboardLayout;
