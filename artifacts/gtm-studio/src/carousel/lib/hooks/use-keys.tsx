import { FocusEvent, useState } from "react";

export function useKeys() {
  const [apiKey, setApiKey] = useState<string>(
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_OPENAI_API_KEY) || ""
  );

  return {
    apiKey,
    setApiKey,
  };
}
