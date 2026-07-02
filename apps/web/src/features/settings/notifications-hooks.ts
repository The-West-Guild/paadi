"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fixtureNotificationsApi, NotificationPreference } from "@/lib/api/notifications"; // Adjust path as needed

const QUERY_KEY = ["settings", "notifications"];

export function useNotificationPrefs() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fixtureNotificationsApi.getNotificationPreferences(),
  });
}

export function useUpdateNotificationPrefs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updatedList: NotificationPreference[]) =>
      fixtureNotificationsApi.updateNotificationPreferences(updatedList),
    
    // Optional Optimistic Update to make the toggle feel instant and high-performance
    onMutate: async (updatedList) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previousPrefs = queryClient.getQueryData<{ preferences: NotificationPreference[] }>(QUERY_KEY);
      
      queryClient.setQueryData(QUERY_KEY, { preferences: updatedList });
      return { previousPrefs };
    },
    onError: (err, newVars, context) => {
      if (context?.previousPrefs) {
        queryClient.setQueryData(QUERY_KEY, context.previousPrefs);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

