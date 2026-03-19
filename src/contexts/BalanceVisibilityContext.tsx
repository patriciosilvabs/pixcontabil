import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

interface BalanceVisibilityContextType {
  balanceVisible: boolean;
  toggleBalance: () => void;
}

const BalanceVisibilityContext = createContext<BalanceVisibilityContextType>({
  balanceVisible: false,
  toggleBalance: () => {},
});

export function BalanceVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [balanceVisible, setBalanceVisible] = useState(false);
  const toggleBalance = useCallback(() => setBalanceVisible(v => !v), []);
  const value = useMemo(() => ({ balanceVisible, toggleBalance }), [balanceVisible, toggleBalance]);

  return (
    <BalanceVisibilityContext.Provider value={value}>
      {children}
    </BalanceVisibilityContext.Provider>
  );
}

export function useBalanceVisibility() {
  return useContext(BalanceVisibilityContext);
}
