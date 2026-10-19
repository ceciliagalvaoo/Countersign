import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/api';
import BrandHero from '../components/BrandHero';

const RegisterPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'CONSULTOR' | 'GESTOR' | 'INVESTIDOR'>('INVESTIDOR');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await authService.register({ email, password, role });
      setSuccess(true);
    } catch (err) {
      setError('Failed to register. The email might already be in use.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-dark text-gray-200">
      <BrandHero className="hidden lg:flex flex-[0.65]" />

      <div className="flex-1 lg:flex-[0.35] flex items-center justify-center px-6 lg:px-10 xl:px-14">
        <div className="w-full max-w-2xl px-3 sm:px-6">
          {success ? (
            <div className="space-y-6">
              <h2 className="text-4xl font-semibold text-white">Registration Successful!</h2>
              <p className="text-gray-300 text-base">
                Your account has been created and is now awaiting approval from an administrator.
              </p>
              <p className="text-gray-300 text-base">
                You will be notified by email once your account is approved.
              </p>
              <Link to="/login" className="text-primary font-semibold hover:underline">
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8 px-2 sm:px-3">
              <div>
                <h2 className="text-3xl sm:text-4xl font-semibold text-white">Create Account</h2>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-dark-200 border border-gray-600 rounded-lg px-3 py-3 text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-dark-200 border border-gray-600 rounded-lg px-3 py-3 text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    placeholder="Create a password"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">I am a...</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full bg-dark-200 border border-gray-600 rounded-lg px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  >
                    <option value="INVESTIDOR">Investor</option>
                    <option value="CONSULTOR">Consultant</option>
                    <option value="GESTOR">Manager</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 text-white rounded-lg bg-primary hover:shadow-lg transition-all disabled:opacity-60"
              >
                {loading ? 'Creating Account...' : 'Register'}
              </button>

              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>Already have an account?</span>
                <Link to="/login" className="text-primary font-semibold hover:underline">
                  Log in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
