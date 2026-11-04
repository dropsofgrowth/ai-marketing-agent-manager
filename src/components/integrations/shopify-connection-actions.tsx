"use client";

import { RefreshCw, ShoppingBag, Unplug } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/form-controls";
import { useActionWithToast } from "@/components/ui/toast";
import { useI18n } from "@/i18n/client";
import {
  disconnectShopifyAction,
  startShopifyConnectAction,
  verifyShopifyConnectionAction,
} from "@/server/actions/shopify";

/**
 * Starts the OAuth flow. The server action sets the state cookie and navigates to
 * Shopify; only the locale is posted from the browser.
 */
export function ConnectShopifyButton({ reconnect = false }: { reconnect?: boolean }) {
  const { dict, locale } = useI18n();
  const [, formAction] = useActionWithToast(startShopifyConnectAction);
  return (
    <form action={formAction}>
      <input type="hidden" name="locale" value={locale} />
      <SubmitButton pendingLabel={dict.shopifyConnect.connecting} className="w-full sm:w-auto">
        <ShoppingBag aria-hidden className="size-4" />
        {reconnect ? dict.shopifyConnect.reconnect : dict.shopifyConnect.connect}
      </SubmitButton>
    </form>
  );
}

export function VerifyShopifyButton() {
  const { dict } = useI18n();
  const [, formAction] = useActionWithToast(verifyShopifyConnectionAction);
  return (
    <form action={formAction}>
      <SubmitButton variant="secondary" pendingLabel={dict.shopifyConnect.verifying} className="w-full sm:w-auto">
        <RefreshCw aria-hidden className="size-4" />
        {dict.shopifyConnect.verify}
      </SubmitButton>
    </form>
  );
}

export function DisconnectShopifyButton() {
  const { dict } = useI18n();
  const [open, setOpen] = useState(false);
  const [, formAction] = useActionWithToast(disconnectShopifyAction, { onSuccess: () => setOpen(false) });
  const s = dict.shopifyConnect;
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)} className="w-full sm:w-auto">
        <Unplug aria-hidden className="size-4" />
        {s.disconnect}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={s.disconnectTitle}>
        <p className="text-sm text-ink-2">{s.disconnectBody}</p>
        <form action={formAction} className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)} className="w-full sm:w-auto">
            {dict.common.cancel}
          </Button>
          <SubmitButton variant="danger" pendingLabel={s.disconnecting} className="w-full sm:w-auto">
            {s.disconnect}
          </SubmitButton>
        </form>
      </Dialog>
    </>
  );
}
