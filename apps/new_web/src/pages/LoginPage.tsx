import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { authService } from '../services/api';
import BrandHero from '../components/BrandHero';
import { PRODUCT_NAME } from '../constants/labels';

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { token } = await authService.login({ email, password });
      await login(token);
      navigate('/dashboard');
    } catch (err) {
      setError('Failed to login. Please check your credentials.');
      setLoading(false);
    }
  };

  const inputBase =
    'ink-input w-full py-3';

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-cream text-navy">
      {/* Hero topo (mobile) / lateral (desktop) */}
      <div className="w-full lg:flex-[0.6] relative">
        <BrandHero className="min-h-full" />
      </div>

      {/* Form */}
      <div className="flex-1 lg:flex-[0.4] flex items-center justify-center px-4 sm:px-6 lg:px-10 xl:px-14 py-8 lg:py-0">
        <div className="w-full max-w-sm sm:max-w-md">
          <div className="ink-card module-panel p-6 md:p-8">
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Header */}
              <div className="space-y-2">
                <p className="eyebrow">
                  {PRODUCT_NAME}
                </p>
                <h2 className="text-40">
                  Sign in
                </h2>
                <p className="text-14 text-ink-soft">
                  Investor, issuer and fund manager access.
                </p>
              </div>

              {error && (
                <p role="alert" className="text-14 text-vermilion bg-vermilion/5 border border-vermilion/30 rounded-well px-3 py-2">
                  {error}
                </p>
              )}

              {/* Campos */}
              <div className="space-y-5">
                <div>
                  <label className="eyebrow mb-1.5 block">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className={inputBase}
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label className="eyebrow mb-1.5 block">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={inputBase}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {/* Link register */}
              <div className="flex items-center justify-between text-14 text-ink-soft">
                <div className="flex items-center gap-1">
                  <span>Don&apos;t have an account?</span>
                  <Link
                    to="/register"
                    className="font-medium text-cobalt underline-offset-4 hover:underline"
                  >
                    Create one
                  </Link>
                </div>
              </div>

              {/* Main button */}
              <button
                type="submit"
                disabled={loading}
                className="btn btn-md btn-primary w-full"
              >
                {loading ? 'Logging in…' : 'Sign in'}
              </button>

            </form>
          </div>

          
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
