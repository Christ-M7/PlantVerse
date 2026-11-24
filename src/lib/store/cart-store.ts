"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** One line of the shopping cart. */
export interface CartItem {
  key: string;
  nameFa: string;
  nameEn: string;
  price: number;
  image: string;
  qty: number;
}

interface CartState {
  items: CartItem[];
  /** Add one unit (merges by key). */
  add: (item: Omit<CartItem, "qty">) => void;
  /** Remove an entire line. */
  remove: (key: string) => void;
  /** Change quantity (clamped 1..9). */
  setQty: (key: string, qty: number) => void;
  /** Empty the cart. */
  clear: () => void;
}

const MAX_QTY = 9;

/**
 * Persisted cart — survives reloads and navigation.
 * Keyed by product nameEn (the de-facto product key across shop + greenhouse).
 */
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) =>
        set({
          items: (() => {
            const prev = get().items;
            const found = prev.find((i) => i.key === item.key);
            if (found) {
              return prev.map((i) =>
                i.key === item.key ? { ...i, qty: Math.min(MAX_QTY, i.qty + 1) } : i
              );
            }
            return [...prev, { ...item, qty: 1 }];
          })(),
        }),
      remove: (key) => set({ items: get().items.filter((i) => i.key !== key) }),
      setQty: (key, qty) =>
        set({
          items: get().items.map((i) =>
            i.key === key ? { ...i, qty: Math.min(MAX_QTY, Math.max(1, qty)) } : i
          ),
        }),
      clear: () => set({ items: [] }),
    }),
    { name: "plantverse-cart" }
  )
);
