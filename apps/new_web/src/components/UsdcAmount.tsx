import React from 'react';

type Props = {
  amount?: number | null;
  maximumFractionDigits?: number;
};

/**
 * Displays an amount in USDC, the asset used for fund prices, investments and refunds (1 USDC ≈ 1 USD).
 */
const UsdcAmount: React.FC<Props> = ({ amount, maximumFractionDigits = 2 }) => {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return <span>-</span>;
  return <span>${amount.toLocaleString(undefined, { maximumFractionDigits })} USDC</span>;
};

export default UsdcAmount;
