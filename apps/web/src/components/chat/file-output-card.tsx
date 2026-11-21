"use client";

import { useState } from "react";
import { CHAT_OUTPUT_CARD_CLASS } from "@/components/chat/chat-output-card";
import { fileAvailabilityFromHttpStatus } from "@/components/chat/file-output";

export type FileOutputCardProps = {
  downloadPath: string;
  filename: string;
  kind: "xlsx" | "file";
};

export function FileOutputCard({
  downloadPath,
  filename,
  kind,
}: FileOutputCardProps) {
  const [unavailable, setUnavailable] = useState(false);

  if (unavailable) {
    return <div className={CHAT_OUTPUT_CARD_CLASS}>Unavailable</div>;
  }

  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    try {
      const res = await fetch(downloadPath);
      if (fileAvailabilityFromHttpStatus(res.status) === "unavailable") {
        setUnavailable(true);
        return;
      }
      window.location.href = downloadPath;
    } catch {
      setUnavailable(true);
    }
  }

  return (
    <a
      href={downloadPath}
      download={filename}
      className={CHAT_OUTPUT_CARD_CLASS}
      onClick={handleClick}
    >
      <span className="font-medium">{filename}</span>
      {kind === "xlsx" ? (
        <span className="ml-2 text-xs text-muted-foreground">xlsx</span>
      ) : null}
    </a>
  );
}
