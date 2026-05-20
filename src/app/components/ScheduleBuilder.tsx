import type { DirectorIdentity } from "@/api/types";

export function ScheduleBuilder({ identity }: { identity: DirectorIdentity }) {
  return <div className="bg-white rounded-xl p-8 shadow-lg">Hi {identity.person.name}! Schedule builder coming in Task 18.</div>;
}
