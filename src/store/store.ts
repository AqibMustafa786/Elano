import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface WishlistState {
  favorites: Record<string, boolean>;
  toggleFavorite: (id: string) => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set) => ({
      favorites: {},
      toggleFavorite: (id: string) =>
        set((state) => ({
          favorites: {
            ...state.favorites,
            [id]: !state.favorites[id],
          },
        })),
    }),
    {
      name: "elano-wishlist",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
