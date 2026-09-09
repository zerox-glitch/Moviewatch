import RoomClient from "@/components/RoomClient";

export function generateMetadata({ params }) {
  return { title: `Room ${params.id} — Moviewatch` };
}

export default function RoomPage({ params }) {
  return <RoomClient roomId={String(params.id || "").toUpperCase()} />;
}
