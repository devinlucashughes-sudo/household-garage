import { TabBar } from "@/components/tabbar";
import { requireUser } from "@/lib/session";

export default async function GarageLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <>
      {children}
      <TabBar />
    </>
  );
}
