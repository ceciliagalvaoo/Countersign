import React from 'react';
import { Outlet } from 'react-router-dom';
import { AmbientStroke } from '../components/ink/AmbientStroke';

const AuthLayout: React.FC = () => (
  <div className="relative isolate min-h-screen bg-cream">
    <AmbientStroke />
    <Outlet />
  </div>
);

export default AuthLayout;
