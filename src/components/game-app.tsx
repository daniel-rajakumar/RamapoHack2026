"use client";

import { useEffect, useRef } from "react";
import { mountGame } from "../client/bootstrap";

export function GameApp() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    return mountGame(root);
  }, []);

  return <div ref={rootRef} id="app" />;
}
