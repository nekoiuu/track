import { RETURN_KINDS, type ReturnKind } from "@/lib/tracking";
import { CancelledList } from "./cancelled-list";

export const metadata = { title: "ยกเลิก / ตีกลับ" };

export default async function CancelledPage({ searchParams }: PageProps<"/cancelled">) {
  const sp = await searchParams;
  const kind = RETURN_KINDS.find((k) => k.key === sp.kind)?.key as ReturnKind | undefined;
  return <CancelledList show={sp.show === "returned" ? "returned" : "pending"} kind={kind} />;
}
