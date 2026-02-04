import { PhoneShell } from "@/components/PhoneShell";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PhoneShell className="flex flex-col" topbar={<TopBar />} footer={<BottomNav />}>
      <div className="flex-1">{children}</div>
    </PhoneShell>
  );
}
