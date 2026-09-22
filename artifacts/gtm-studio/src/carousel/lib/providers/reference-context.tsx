import React, { createContext, useContext, ReactNode } from "react";

const RefContext = createContext<React.RefObject<HTMLDivElement | null> | null>(
  null
);

export function useRefContext() {
  const context = useContext(RefContext);
  if (!context) {
    throw new Error("useRefContext must be used within a RefProvider");
  }
  return context;
}

interface RefProviderProps {
  children: ReactNode;
  myRef: React.RefObject<HTMLDivElement | null>;
}

export function RefProvider({ children, myRef }: RefProviderProps) {
  return <RefContext.Provider value={myRef}>{children}</RefContext.Provider>;
}
