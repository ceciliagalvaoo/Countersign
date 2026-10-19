import React, { useState } from 'react'
import toast from 'react-hot-toast'
import * as StellarSdk from '@stellar/stellar-sdk'
import { orderService, stellarService } from '../services/api'
import { useWallet } from '../contexts/WalletContext'
import UsdcAmount from './UsdcAmount'

interface Fund {
  id: string
  name: string
  symbol?: string
  price: number
  consultor?: { publicKey?: string }
  fundWalletPublicKey?: string | null
}
// Investment Modal with Wallet Integration
const InvestmentModal: React.FC<{
  fund: Fund
  onClose: () => void
  onConfirm: () => void
}> = ({ fund, onClose, onConfirm }) => {
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const { publicKey, isConnected, connect, signAndSubmitTransaction } =
    useWallet()

  const handleInvest = async () => {
    if (!isConnected || !publicKey) {
      toast.error('Please connect your wallet first')
      await connect()
      return
    }

    setLoading(true)
    try {
      const quantity = parseFloat(amount) / fund.price
      const total = parseFloat(amount)

      // Create order and get payment details
      const response = await orderService.create({
        fundId: fund.id,
        quantity,
        total,
        publicKey, // Send wallet address to backend
      })

      if (!response.payment) {
        toast.error('Payment details not available')
        return
      }

      const server = new StellarSdk.Horizon.Server(
        'https://horizon-testnet.stellar.org'
      )

      const { order, payment } = response
      // Fund shares are a Soroban token minted after approval: no trustline is needed for them.
      let toastId: string

      // Step 1: Make sure the wallet holds enough of the payment asset (USDC)
      const paymentAsset = new StellarSdk.Asset(payment.asset.code, payment.asset.issuer)
      let account = await server.loadAccount(publicKey)
      const usdcBalance = () =>
        Number(
          account.balances.find(
            (b: any) => b.asset_code === paymentAsset.code && b.asset_issuer === paymentAsset.issuer
          )?.balance ?? 0
        )

      if (usdcBalance() < Number(payment.amount)) {
        const wantsTestUsdc = window.confirm(
          `Your wallet has ${usdcBalance()} ${paymentAsset.code} but this investment needs ${payment.amount}. ` +
            'Get 1000 test USDC from the testnet faucet now?'
        )
        if (!wantsTestUsdc) {
          toast.error(`Insufficient ${paymentAsset.code} balance`)
          return
        }
        toastId = toast.loading('Requesting test USDC...')
        const { transactionXdr } = await stellarService.getTestUsdc(publicKey)
        await signAndSubmitTransaction(transactionXdr)
        toast.dismiss(toastId)
        account = await server.loadAccount(publicKey)
        if (usdcBalance() < Number(payment.amount)) {
          toast.error(`Insufficient ${paymentAsset.code} balance even after the faucet`)
          return
        }
      }

      // Step 2: Pay for the investment in USDC
      toastId = toast.loading('Processing payment...')

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: payment.destination,
            asset: paymentAsset,
            amount: payment.amount,
          })
        )
        .addMemo(StellarSdk.Memo.text(payment.memo))
        .setTimeout(180)
        .build()

      // Sign and submit via wallet
      const txHash = await signAndSubmitTransaction(transaction.toXDR())

      toast.dismiss(toastId)

      // Complete the order with tx hash
      await orderService.complete(order.id, txHash)

      toast.success(
        `Investment successful! You will receive ${quantity} ${fund.symbol} tokens after approval.`
      )
      onConfirm()
      onClose()
    } catch (error: any) {
      console.error('Investment error:', error)
      toast.dismiss() // Dismiss all toasts
      toast.error(error.message || 'Investment failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white/[0.04] border border-white/[0.12] backdrop-blur-xl rounded-2xl p-6 md:p-8 shadow-[0_18px_60px_rgba(0,0,0,0.45)] w-full max-w-md m-4">
                <h2 className="text-2xl font-bold mb-4">Invest in {fund.name}</h2>
                <div className="space-y-4">
                    <p>Price per token: <UsdcAmount amount={fund.price} /></p>
                    <input 
                        type="number" 
                        value={amount} 
                        onChange={e => setAmount(e.target.value)} 
                        placeholder="Amount to invest (USDC)" 
                        className="w-full p-3 bg-dark-200 border border-gray-600 rounded-lg"
                    />
                    {amount && (
                        <div className="text-sm space-y-1">
                            <p>You will receive approx. {Math.floor(parseFloat(amount) / fund.price)} {fund.symbol || 'TOKEN'} tokens.</p>
                            <p className="text-gray-600">
                                Investment: <UsdcAmount amount={parseFloat(amount)} />
                            </p>
                        </div>
                    )}
                </div>
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onClose} className="px-6 py-2 text-gray-200 bg-gray-700 rounded-lg hover:bg-gray-600">Cancel</button>
                    <button onClick={handleInvest} disabled={loading || !amount} className="px-6 py-2 text-white bg-primary rounded-lg hover:bg-primary/90 disabled:bg-primary/50">
                        {loading ? 'Processing...' : 'Confirm Investment'}
                    </button>
                </div>
            </div>
        </div>
  )
}

export default InvestmentModal
