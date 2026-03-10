import { useEffect, useRef, useState } from "react"
import { Inbox } from "lucide-react"
import { getAuthClientId, authCallback } from "@/api/client"
import { useUser } from "@/hooks/use-user"

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            auto_select?: boolean
          }) => void
          prompt: () => void
          renderButton: (
            element: HTMLElement,
            config: { theme?: string; size?: string; width?: number; text?: string },
          ) => void
        }
      }
    }
  }
}

export function LoginPage() {
  const buttonRef = useRef<HTMLDivElement>(null)
  const { refresh } = useUser()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { clientId } = await getAuthClientId()

      const waitForGoogle = () =>
        new Promise<void>((resolve) => {
          if (window.google?.accounts) return resolve()
          const interval = setInterval(() => {
            if (window.google?.accounts) {
              clearInterval(interval)
              resolve()
            }
          }, 50)
        })

      await waitForGoogle()
      if (cancelled) return

      window.google!.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            await authCallback(response.credential)
            await refresh()
          } catch (err) {
            setError("Sign in failed. Please try again.")
            console.error("Auth callback failed:", err)
          }
        },
        auto_select: true,
      })

      window.google!.accounts.id.prompt()

      if (buttonRef.current) {
        window.google!.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          width: 300,
          text: "signin_with",
        })
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [refresh])

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Inbox className="size-5" />
          </div>
          <h1 className="text-xl font-bold">Welcome to Agent Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your Google account to continue
          </p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div ref={buttonRef} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <p className="px-6 text-center text-xs text-muted-foreground">
          Your Gmail and Notion data stays on this device.
        </p>
      </div>
    </div>
  )
}
