import { redirect } from "next/navigation";

// Root "/" is handled by the custom Express server (proxy or bookmarklet page).
// If Next.js receives this request (no proxy set), redirect to /editor.
export default function HomePage() {
  redirect("/editor");
}
