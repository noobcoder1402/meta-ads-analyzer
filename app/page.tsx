import { redirect } from "next/navigation";
import { getSelfCompetitor } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (process.env.DEMO_MODE !== "true") {
    const self = await getSelfCompetitor();
    if (!self) redirect("/onboarding");
  }
  redirect("/competitors");
}
