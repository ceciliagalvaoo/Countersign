import React from 'react';
import { useAuth } from '../contexts/useAuth';
import ConsultorDashboard from './ConsultorDashboard';
import GestorDashboard from './GestorDashboard';
import InvestidorDashboard from './InvestidorDashboard';

const DashboardPage: React.FC = () => {
  const { user } = useAuth();

  if (!user) {
    // This should ideally not happen due to the ProtectedRoute, but it's a good fallback.
    return (
        <div className="p-8 bg-dark rounded-lg shadow-lg">
            <h1 className="text-2xl font-bold text-white">Loading...</h1>
      </div>
    );
  }

  switch (user.role) {
    case 'CONSULTOR':
      return <ConsultorDashboard />;
    case 'GESTOR':
      return <GestorDashboard />;
    case 'INVESTIDOR':
      return <InvestidorDashboard />;
    default:
      // This case handles any unexpected roles.
      return (
        <div className="p-8 bg-dark rounded-lg shadow-lg">
            <h1 className="text-2xl font-bold text-red-500">Access Denied</h1>
            <p className="mt-2 text-gray-300">Your user role is not recognized.</p>
        </div>
      );
  }
};

export default DashboardPage;
