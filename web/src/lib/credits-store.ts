"use client";

import { create } from "zustand";
import { authClient } from "@/lib/auth-client";

interface CustomerStateLike {
  activeMeters?: Array<Record<string, unknown>>;
  active_meters?: Array<Record<string, unknown>>;
}

interface MeterLike {
  balance?: unknown;
}

interface FetchBalanceOptions {
  setLoading?: boolean;
}

interface CreditsStoreState {
  balance: number | null;
  loading: boolean;
  fetchBalance: (options?: FetchBalanceOptions) => Promise<void>;
  reset: () => void;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getActiveMeters(data: CustomerStateLike | null | undefined): MeterLike[] {
  if (!data) return [];
  if (Array.isArray(data.activeMeters)) return data.activeMeters;
  if (Array.isArray(data.active_meters)) return data.active_meters;
  return [];
}

function extractBalance(data: CustomerStateLike | null | undefined): number {
  const meters = getActiveMeters(data);
  return meters.reduce((sum, meter) => sum + asNumber(meter.balance), 0);
}

export const useCreditsStore = create<CreditsStoreState>((set, get) => ({
  balance: null,
  loading: true,

  async fetchBalance(options) {
    const shouldShowLoading = options?.setLoading ?? get().balance === null;

    if (shouldShowLoading) {
      set({ loading: true });
    }

    try {
      const { data } = await authClient.customer.state({}, { cache: "no-store" });
      const nextBalance = extractBalance(data as CustomerStateLike);
      set({ balance: nextBalance });
    } catch {
      set({ balance: 0 });
    } finally {
      if (shouldShowLoading) {
        set({ loading: false });
      }
    }
  },

  reset() {
    set({
      balance: null,
      loading: true,
    });
  },
}));
