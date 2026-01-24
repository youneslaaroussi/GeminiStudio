import { UIMessage, UIDataTypes } from "ai";

type ToolMap = {
  "tool-getDate": {
    input: { locale?: string };
    output: string;
  };
  "tool-getTime": {
    input: { locale?: string };
    output: string;
  };
};

export type TimelineChatMessage = UIMessage<never, UIDataTypes, ToolMap>;
