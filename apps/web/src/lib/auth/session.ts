import { create } from "zustand";
import { persist } from "zustand/middleware";

type SessionState = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null; // ms epoch, computed from expiresIn at set-time

  setSession: (session: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }) => void;
  clearSession: () => void;
  isAuthenticated: () => boolean;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,

      setSession: ({ accessToken, refreshToken, expiresIn }) => {
        set({
          accessToken,
          refreshToken,
          expiresAt: Date.now() + expiresIn * 1000,
        });
      },

      clearSession: () => {
        set({ accessToken: null, refreshToken: null, expiresAt: null });
      },

      isAuthenticated: () => {
        const { accessToken, expiresAt } = get();
        return Boolean(accessToken) && Boolean(expiresAt) && Date.now() < expiresAt!;
      },
    }),
    {
      name: "paadi:session", 
    }
  )
);