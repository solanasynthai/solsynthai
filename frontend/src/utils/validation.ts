export const isValidSolanaAddress = (address: string): boolean => {
  try {
    if (!address) return false;
    if (address.length !== 44) return false;
    if (!/^[A-HJ-NP-Za-km-z1-9]*$/.test(address)) return false;
    return true;
  } catch {
    return false;
  }
};

export const isValidContractName = (name: string): boolean => {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
};

export const validateAmount = (amount: string): boolean => {
  const regex = /^\d*\.?\d*$/;
  return regex.test(amount) && parseFloat(amount) > 0;
};
