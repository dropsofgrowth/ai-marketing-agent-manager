"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";

export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { dict } = useI18n();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <AlertTriangle aria-hidden className="mx-auto size-8 text-critical-ink" />
      <h1 className="mt-4 text-lg font-semibold text-ink">{dict.errors.pageTitle}</h1>
      <p className="mt-2 text-sm text-ink-2">{dict.errors.pageBody}</p>
      {error.digest ? (
        <p className="mt-2 text-xs text-ink-3" dir="ltr">
          ref: {error.digest}
        </p>
      ) : null}
      <Button className="mt-6" onClick={() => retry()}>
        {dict.common.tryAgain}
      </Button>
    </div>
  );
}
