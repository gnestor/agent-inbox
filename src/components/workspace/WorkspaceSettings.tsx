import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getWorkspaceDetails,
  getWorkspaceGitInfo,
  renameWorkspace,
  addWorkspaceMember,
  removeWorkspaceMember,
  updateMemberRole,
  getAvailableUsers,
} from "@/api/client"
import { useConnections } from "@/hooks/use-connections"
import { IntegrationCard } from "@/components/settings/IntegrationCard"
import { useUser } from "@/hooks/use-user"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@hammies/frontend/components/ui"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { getInitials } from "@/lib/formatters"
import { ExternalLink, GitBranch, Trash2, UserPlus } from "lucide-react"
import type { WorkspaceMember } from "@/types"

export function WorkspaceSettings() {
  const { activeWorkspace, refresh: refreshUser } = useUser()
  const queryClient = useQueryClient()
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editName, setEditName] = useState("")

  const workspaceId = activeWorkspace?.id
  if (!workspaceId) return null

  const rename = useMutation({
    mutationFn: (name: string) => renameWorkspace(workspaceId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-details", workspaceId] })
      refreshUser()
    },
  })

  function handleStartEdit() {
    setEditName(activeWorkspace?.name || "")
    setIsEditingName(true)
  }

  function handleFinishEdit() {
    setIsEditingName(false)
    const trimmed = editName.trim()
    if (trimmed && trimmed !== activeWorkspace?.name) {
      rename.mutate(trimmed)
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); handleFinishEdit() }
    if (e.key === "Escape") { setIsEditingName(false) }
  }

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-details", workspaceId],
    queryFn: () => getWorkspaceDetails(workspaceId),
  })

  const { data: gitInfo } = useQuery({
    queryKey: ["workspace-git", workspaceId],
    queryFn: () => getWorkspaceGitInfo(workspaceId),
  })

  const { data: availableUsers } = useQuery({
    queryKey: ["workspace-available-users", workspaceId],
    queryFn: () => getAvailableUsers(workspaceId),
    enabled: addMemberOpen,
  })

  const { data: integrations } = useConnections()
  const workspaceIntegrations = integrations?.filter((i) => i.scope === "workspace" && i.connected) || []

  const addMember = useMutation({
    mutationFn: (email: string) => addWorkspaceMember(workspaceId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-details", workspaceId] })
      queryClient.invalidateQueries({ queryKey: ["workspace-available-users", workspaceId] })
      setAddMemberOpen(false)
    },
  })

  const removeMember = useMutation({
    mutationFn: (email: string) => removeWorkspaceMember(workspaceId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-details", workspaceId] })
    },
  })

  const changeMemberRole = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      updateMemberRole(workspaceId, email, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-details", workspaceId] })
    },
  })

  const members = (data?.members || []) as WorkspaceMember[]

  return (
    <div className="flex flex-col h-full w-full">
      <PanelHeader
        left={
          <>
            <SidebarButton />
            {isEditingName ? (
              <input
                autoFocus
                onFocus={(e) => e.target.select()}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleFinishEdit}
                onKeyDown={handleEditKeyDown}
                className="font-semibold text-sm bg-transparent border-b border-foreground/30 outline-none truncate min-w-0 flex-1"
                maxLength={200}
              />
            ) : (
              <h2
                className="font-semibold text-sm truncate min-w-0 flex-1 cursor-pointer hover:text-foreground/70"
                onClick={handleStartEdit}
                title="Click to rename"
              >
                {activeWorkspace?.name}
              </h2>
            )}
          </>
        }
      />

      {isLoading ? (
        <PanelSkeleton />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-6 max-w-2xl">
          {/* Git Info */}
          {gitInfo && (gitInfo.branch || gitInfo.remote) && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Repository</h2>
              <div className="space-y-1 text-sm text-muted-foreground">
                {gitInfo.branch && (
                  <div className="flex items-center gap-2">
                    <GitBranch className="size-3.5" />
                    <span>{gitInfo.branch}</span>
                  </div>
                )}
                {gitInfo.remoteUrl && (
                  <div className="flex items-center gap-2">
                    <ExternalLink className="size-3.5" />
                    <a
                      href={gitInfo.remoteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {gitInfo.remoteUrl.replace("https://github.com/", "")}
                    </a>
                  </div>
                )}
                {gitInfo.status.length > 0 && (
                  <div className="mt-1 text-xs">
                    {gitInfo.status.length} file{gitInfo.status.length === 1 ? "" : "s"} changed
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Members */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Members</h2>
              <Popover open={addMemberOpen} onOpenChange={setAddMemberOpen}>
                <PopoverTrigger
                  render={
                    <Button variant="ghost" size="sm">
                      <UserPlus className="size-3.5 mr-1" />
                      Add member
                    </Button>
                  }
                />
                <PopoverContent className="p-0 w-64" align="end">
                  <Command>
                    <CommandInput placeholder="Search users..." />
                    <CommandList>
                      <CommandEmpty>No users found</CommandEmpty>
                      <CommandGroup>
                        {(availableUsers?.users || []).map((u) => (
                          <CommandItem
                            key={u.email}
                            onSelect={() => addMember.mutate(u.email)}
                            className="flex items-center gap-2"
                          >
                            <Avatar className="h-6 w-6">
                              {u.picture && <AvatarImage src={u.picture} />}
                              <AvatarFallback className="text-xs">
                                {getInitials(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 truncate">
                              <div className="text-sm">{u.name}</div>
                              <div className="text-xs text-muted-foreground">{u.email}</div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              {members.map((member) => (
                <div
                  key={member.user_email}
                  className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/50"
                >
                  <Avatar className="h-8 w-8">
                    {member.picture && <AvatarImage src={member.picture} />}
                    <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{member.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{member.user_email}</div>
                  </div>
                  <Badge
                    variant="secondary"
                    className="cursor-pointer text-xs"
                    onClick={() => {
                      const newRole = member.role === "admin" ? "member" : "admin"
                      changeMemberRole.mutate({ email: member.user_email, role: newRole })
                    }}
                  >
                    {member.role}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeMember.mutate(member.user_email)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          {/* Workspace Integrations */}
          {workspaceIntegrations.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Integrations</h2>
              <p className="text-xs text-muted-foreground">
                Shared service accounts for this workspace.
              </p>
              <div className="space-y-2">
                {workspaceIntegrations.map((integration) => (
                  <IntegrationCard key={integration.id} integration={integration} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
