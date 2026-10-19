import React from 'react';
import { Outlet } from 'react-router-dom';

const AuthLayout: React.FC = () => (
  <div className="min-h-screen bg-cream">
    <Outlet />
  </div>
);

export default AuthLayout;
