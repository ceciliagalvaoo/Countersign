// Manager wallets are operational signers, independent of the profile's wallet binding.
export async function persistConnectedWallet(role: string | undefined, authenticated: boolean,
  address: string, updateWallet: (address: string) => Promise<unknown>) {
  if (authenticated && role && role !== 'GESTOR') await updateWallet(address);
}
