import { createContext, useContext, type ReactNode } from 'react';
import { useApi } from './hooks';
import type { Settings } from './api/types';

const DEFAULTS: Settings = { businessName: 'StockSync', currency: 'USD', whatsappNumber: '', defaultWarehouseId: null, alertRecipients: [], customFields: [] };

interface SettingsState { settings: Settings; reload: () => void }
const SettingsContext = createContext<SettingsState>({ settings: DEFAULTS, reload: () => {} });

/** Runtime-configurable settings (currency, custom fields…) shared by all dashboard pages. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi<Settings>('/settings');
  return <SettingsContext.Provider value={{ settings: data ?? DEFAULTS, reload }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  return useContext(SettingsContext);
}
