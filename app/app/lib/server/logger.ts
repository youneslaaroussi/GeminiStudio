import pino from "pino";

export const logger = pino({
  name: "gemini-studio",
  level: process.env.LOG_LEVEL ?? "info",
});
