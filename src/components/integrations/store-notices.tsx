import { Notice } from "@/components/ui/notice";
import type { ServerI18n } from "@/i18n/server";
import type { StoreSourceInfo } from "@/server/queries/performance";

/** Explains demo, error, mixed-source and partial-history states above store figures. */
export function StoreNotices({
  source,
  complete,
  comparable,
  showMixed = false,
  i18n,
}: {
  source: StoreSourceInfo;
  complete: boolean;
  comparable?: boolean;
  /** Pages that combine store revenue with ad spend explain why that's hidden. */
  showMixed?: boolean;
  i18n: ServerI18n;
}) {
  const d = i18n.dict.dataSource;
  const errors = i18n.dict.errors as Record<string, string>;
  return (
    <>
      {source.mode === "demo" ? <Notice tone="info">{d.demoNotice}</Notice> : null}
      {source.mode === "error" ? (
        <Notice tone="critical">
          {d.errorNotice} {errors[source.code] ?? errors.UNEXPECTED}
        </Notice>
      ) : null}
      {source.mode === "live" && showMixed && !comparable ? <Notice tone="info">{d.mixedNotice}</Notice> : null}
      {source.mode === "live" && !complete ? <Notice tone="warning">{d.partialHistory}</Notice> : null}
    </>
  );
}
