import { Fragment, type ReactNode } from "react";

/**
 * Like `interpolate`, but returns React nodes and wraps every inserted value in
 * <bdi>. Bidi isolation keeps mixed-direction content (an English campaign name
 * inside an Arabic sentence, or the reverse) in the right visual order.
 */
export function richT(template: string, params: Record<string, ReactNode> = {}): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, index) => {
    const match = /^\{(\w+)\}$/.exec(part);
    if (match && match[1] in params) return <bdi key={index}>{params[match[1]]}</bdi>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
