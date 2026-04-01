import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query"
import { trashThread, modifyThreadLabels } from "../api"
import { toast } from "sonner"
import type { GmailThread, GmailMessage } from "../types"

interface EmailActionsOptions {
  onRemove?: () => void
}

type EmailPage = { messages: GmailMessage[]; nextPageToken: string | null }

export function useEmailActions(threadId: string, thread?: GmailThread | null, options?: EmailActionsOptions) {
  const queryClient = useQueryClient()
  const labelIds = thread?.labelIds ?? []

  const invalidateEmailQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["emails"] })
    queryClient.invalidateQueries({ queryKey: ["thread", threadId] })
  }

  function optimisticLabelUpdate(add: string[], remove: string[]) {
    const previous = queryClient.getQueryData<GmailThread>(["thread", threadId])
    if (previous) {
      const newLabels = [
        ...previous.labelIds.filter((l) => !remove.includes(l)),
        ...add.filter((l) => !previous.labelIds.includes(l)),
      ]
      queryClient.setQueryData<GmailThread>(["thread", threadId], {
        ...previous,
        labelIds: newLabels,
      })
    }
    return { previous }
  }

  function removeFromEmailList() {
    const previousEmails = queryClient.getQueriesData<InfiniteData<EmailPage>>({ queryKey: ["emails"] })
    queryClient.setQueriesData<InfiniteData<EmailPage>>({ queryKey: ["emails"] }, (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          messages: page.messages.filter((m) => m.threadId !== threadId),
        })),
      }
    })
    return { previousEmails }
  }

  function rollbackEmailList(previousEmails: [readonly unknown[], InfiniteData<EmailPage> | undefined][]) {
    for (const [key, data] of previousEmails) {
      queryClient.setQueryData(key, data)
    }
  }

  const archiveMutation = useMutation({
    mutationFn: () => modifyThreadLabels(threadId, { removeLabelIds: ["INBOX"] }),
    onMutate: () => {
      const threadCtx = optimisticLabelUpdate([], ["INBOX"])
      const listCtx = removeFromEmailList()
      return { ...threadCtx, ...listCtx }
    },
    onSuccess: () => {
      invalidateEmailQueries()
      toast.success("Thread archived")
      options?.onRemove?.()
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["thread", threadId], context.previous)
      }
      if (context?.previousEmails) {
        rollbackEmailList(context.previousEmails)
      }
      toast.error(`Archive failed: ${err.message}`)
    },
  })

  const trashMutation = useMutation({
    mutationFn: () => trashThread(threadId),
    onMutate: () => {
      const threadCtx = optimisticLabelUpdate(["TRASH"], ["INBOX"])
      const listCtx = removeFromEmailList()
      return { ...threadCtx, ...listCtx }
    },
    onSuccess: () => {
      invalidateEmailQueries()
      toast.success("Thread deleted")
      options?.onRemove?.()
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["thread", threadId], context.previous)
      }
      if (context?.previousEmails) {
        rollbackEmailList(context.previousEmails)
      }
      toast.error(`Delete failed: ${err.message}`)
    },
  })

  const starMutation = useMutation({
    mutationFn: (starred: boolean) =>
      modifyThreadLabels(threadId, starred
        ? { addLabelIds: ["STARRED"] }
        : { removeLabelIds: ["STARRED"] },
      ),
    onMutate: (starred: boolean) =>
      optimisticLabelUpdate(starred ? ["STARRED"] : [], starred ? [] : ["STARRED"]),
    onSuccess: (_data, starred) => {
      invalidateEmailQueries()
      toast.success(starred ? "Starred" : "Unstarred")
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["thread", threadId], context.previous)
      }
      toast.error(`Star update failed: ${err.message}`)
    },
  })

  const importantMutation = useMutation({
    mutationFn: (important: boolean) =>
      modifyThreadLabels(threadId, important
        ? { addLabelIds: ["IMPORTANT"] }
        : { removeLabelIds: ["IMPORTANT"] },
      ),
    onMutate: (important: boolean) =>
      optimisticLabelUpdate(important ? ["IMPORTANT"] : [], important ? [] : ["IMPORTANT"]),
    onSuccess: (_data, important) => {
      invalidateEmailQueries()
      toast.success(important ? "Marked important" : "Marked not important")
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["thread", threadId], context.previous)
      }
      toast.error(`Important update failed: ${err.message}`)
    },
  })

  const labelMutation = useMutation({
    mutationFn: (body: { addLabelIds?: string[]; removeLabelIds?: string[] }) =>
      modifyThreadLabels(threadId, body),
    onMutate: (body) =>
      optimisticLabelUpdate(body.addLabelIds ?? [], body.removeLabelIds ?? []),
    onSuccess: () => invalidateEmailQueries(),
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["thread", threadId], context.previous)
      }
      toast.error(`Label update failed: ${err.message}`)
    },
  })

  return {
    archive: () => archiveMutation.mutate(),
    trash: () => trashMutation.mutate(),
    toggleStar: () => starMutation.mutate(!labelIds.includes("STARRED")),
    toggleImportant: () => importantMutation.mutate(!labelIds.includes("IMPORTANT")),
    modifyLabels: (add?: string[], remove?: string[]) =>
      labelMutation.mutate({ addLabelIds: add, removeLabelIds: remove }),
    isStarred: labelIds.includes("STARRED"),
    isImportant: labelIds.includes("IMPORTANT"),
    isPending:
      archiveMutation.isPending ||
      trashMutation.isPending ||
      starMutation.isPending ||
      importantMutation.isPending ||
      labelMutation.isPending,
  }
}
