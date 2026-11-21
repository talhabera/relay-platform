"use client";

import * as React from "react";

/**
 * Lets a work pane (rendered by the server into OperatorChat's `workPane`
 * slot) steer the session: "Search more" sends a message like a chip does.
 * Outside a session, `send` is null and the pane hides steering controls.
 */
export type SessionSteer = {
  /** Sends a message as the starter; null when the viewer cannot steer. */
  send: ((text: string) => void) | null;
  isStreaming: boolean;
};

const SessionSteerContext = React.createContext<SessionSteer>({ send: null, isStreaming: false });

export const SessionSteerProvider = SessionSteerContext.Provider;

export function useSessionSteer(): SessionSteer {
  return React.useContext(SessionSteerContext);
}
