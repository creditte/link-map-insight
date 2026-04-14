import { createContext, useContext, ReactNode } from "react";
import { useTenantSettings as useTenantSettingsHook, TenantSettings, TenantLoadStatus } from "@/hooks/useTenantSettings";

interface TenantSettingsContextValue {
  tenant: TenantSettings | null;
  loading: boolean;
  status: TenantLoadStatus;
  error: string | null;
  reload: () => void;
}

const TenantSettingsContext = createContext<TenantSettingsContextValue | null>(null);

export function TenantSettingsProvider({ children }: { children: ReactNode }) {
  const value = useTenantSettingsHook();
  return (
    <TenantSettingsContext.Provider value={value}>
      {children}
    </TenantSettingsContext.Provider>
  );
}

export function useSharedTenantSettings(): TenantSettingsContextValue {
  const ctx = useContext(TenantSettingsContext);
  if (!ctx) {
    throw new Error("useSharedTenantSettings must be used within TenantSettingsProvider");
  }
  return ctx;
}
