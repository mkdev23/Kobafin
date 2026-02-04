import { PhoneShell } from "@/components/PhoneShell";
import { TopBar } from "@/components/TopBar";

export default function PotsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PhoneShell topbar={<TopBar />}>
      {children}
    </PhoneShell>
  );
}
