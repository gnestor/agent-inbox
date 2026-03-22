import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { getUserProfiles } from "@/api/client"
import type { SessionMessage } from "@/types"

/**
 * Collect unique author emails from messages and cache their profiles.
 * Returns a lookup map: email → { name, picture }.
 */
export function useUserProfiles(messages: SessionMessage[]) {
  const emails = useMemo(() => {
    const set = new Set<string>()
    for (const m of messages) {
      const email = (m.message as any).authorEmail
      if (email) set.add(email)
    }
    return [...set].sort()
  }, [messages])

  const emailsKey = emails.join(",")

  const { data } = useQuery({
    queryKey: ["user-profiles", emailsKey],
    queryFn: () => getUserProfiles(emails),
    enabled: emails.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  return useMemo(() => {
    const map = new Map<string, { name: string; picture?: string }>()
    for (const u of data?.users ?? []) {
      map.set(u.email, { name: u.name, picture: u.picture })
    }
    return map
  }, [data])
}
