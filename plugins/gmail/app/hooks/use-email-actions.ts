import { useMutation, useQueryClient } from "@tanstack/react-query"
import { trashThread, modifyThreadLabels } from "../api"
import { toast } from "sonner"
import type { GmailThread } from "../types"

interface EmailActionsOptions {
  onRemove?: () => void
}

interface PluginListData {
  items: { id: string; [key: string]: unknown }[]
  nextCursor?: string
}

export function useEmailActions(threadId: string, thread?: GmailThread | null, options?: EmailActionsOptions) {
  const queryClient = useQueryClient()
  const labelIds = thread?.labelIds ?? []

  const invalidateEmailQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["plugin-items"] })
    queryClient.invalidateQueries({ queryKey: ["plugin-item", "gmail", threadId] })
  }

  function optimisticLabelUpdate(add: string[], remove: string[]) {
    const previous = queryClient.getQueryData<GmailThread>(["plugin-item", "gmail", threadId])
    if (previous) {
      const newLabels = [
        ...previous.labelIds.filter((l) => !remove.includes(l)),
        ...add.filter((l) => !previous.labelIds.includes(l)),
      ]
      queryClient.setQueryData<GmailThread>(["plugin-item", "gmail", threadId], {
        ...previous,
        labelIds: newLabels,
      })
    }
    return { previous }
  }

  function removeFromEmailList() {
    const previousList = queryClient.getQueriesData<PluginListData>({ queryKey: ["plugin-items"] })
    queryClient.setQueriesData<PluginListData>({ queryKey: ["plugin-items"] }, (old) => {
      if (!old) return old
      return { ...old, items: old.items.filter((item) => item.id !== threadId) }
    })
    return { previousList }
  }

  function rollbackList(previousList: [readonly unknown[], PluginListData | undefined][]) {
    for (const [key, data] of previousList) {
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
        queryClient.setQueryData(["plugin-item", "gmail", threadId], context.previous)
      }
      if (context?.previousList) {
        rollbackList(context.previousList)
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
        queryClient.setQueryData(["plugin-item", "gmail", threadId], context.previous)
      }
      if (context?.previousList) {
        rollbackList(context.previousList)
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
        queryClient.setQueryData(["plugin-item", "gmail", threadId], context.previous)
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
        queryClient.setQueryData(["plugin-item", "gmail", threadId], context.previous)
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
        queryClient.setQueryData(["plugin-item", "gmail", threadId], context.previous)
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
