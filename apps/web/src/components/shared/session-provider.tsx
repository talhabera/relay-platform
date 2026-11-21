"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({
  children,
  user,
}: {
  children: ReactNode;
  user: SessionUser;
}) {
  return (
    <SessionContext.Provider value={user}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionContext must be used within a SessionProvider");
  }
  return context;
}
