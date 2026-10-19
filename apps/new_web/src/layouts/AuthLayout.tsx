import React from 'react';
import { Outlet } from 'react-router-dom';

const AuthLayout: React.FC = () => {
  // Full-height container so the child page can control its own split layout
  return (
    <div className="min-h-screen bg-dark">
      <Outlet />
    </div>
  );
};

export default AuthLayout;
