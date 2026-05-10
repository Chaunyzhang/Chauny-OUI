import { renderChat, type ChatProps } from "./chat.ts";

export type OuiChatProps = ChatProps;

export function renderOuiChat(props: OuiChatProps) {
  return renderChat(props);
}
