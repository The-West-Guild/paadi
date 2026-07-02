import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Holds the real AuthSession (accessToken/refreshToken) once a user
 * finishes signup (signupPin's onSuccess) or logs in.
 *
 * Deliberately separate from features/onboarding/store.ts — that store
 * is scoped to the signup wizard and gets reset() when it's done; a
 * session needs to survive long after onboarding is over, including
 * page refreshes, so it lives here with its own persistence.
 *
 * Honesty about the tradeoff: tokens sit in localStorage via zustand's
 * persist middleware, which is readable by any JS on the page (XSS risk).
 * The textbook-correct answer is an HttpOnly cookie set server-side, but
 * that needs @paadi/api-client + a Next.js server action talking to the
 * real backend, neither of which exist yet. This is the right-sized
 * choice for a 2-week hackathon — revisit before any real production use.
 */

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

      // NOTE: this only checks "do we have a token that hasn't expired by
      // the clock" — it does NOT verify the token against the server.
      // That's fine for deciding whether to show a login screen; it is
      // NOT a substitute for the backend's own Bearer-token validation
      // on every protected request.
      isAuthenticated: () => {
        const { accessToken, expiresAt } = get();
        return Boolean(accessToken) && Boolean(expiresAt) && Date.now() < expiresAt!;
      },
    }),
    {
      name: "paadi:session", // localStorage key
    }
  )
);