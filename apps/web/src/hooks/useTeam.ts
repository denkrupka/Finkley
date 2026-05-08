import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type SalonRole = 'owner' | 'admin' | 'accountant' | 'staff'

export type TeamMember = {
  id: string
  user_id: string
  role: SalonRole
  staff_id: string | null
  joined_at: string | null
  invited_email: string | null
}

export type Invitation = {
  id: string
  email: string
  role: SalonRole
  staff_id: string | null
  invited_at: string
  expires_at: string
  accepted_at: string | null
  cancelled_at: string | null
}

export function useTeamMembers(salonId: string | undefined) {
  return useQuery<TeamMember[]>({
    queryKey: ['team-members', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('salon_members')
        .select('id, user_id, role, staff_id, joined_at, invited_email')
        .eq('salon_id', salonId)
      if (error) throw error
      return (data ?? []) as TeamMember[]
    },
    enabled: !!salonId,
  })
}

export function useInvitations(salonId: string | undefined) {
  return useQuery<Invitation[]>({
    queryKey: ['invitations', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('salon_invitations')
        .select('id, email, role, staff_id, invited_at, expires_at, accepted_at, cancelled_at')
        .eq('salon_id', salonId)
        .is('accepted_at', null)
        .is('cancelled_at', null)
        .order('invited_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Invitation[]
    },
    enabled: !!salonId,
  })
}

export function useInviteMember(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { email: string; role: SalonRole; staffId?: string | null }) => {
      const { data, error } = await supabase.functions.invoke('send-invitation', {
        body: {
          action: 'create',
          salon_id: salonId,
          email: input.email,
          role: input.role,
          staff_id: input.staffId ?? null,
        },
      })
      if (error) throw error
      const json = data as { ok: boolean; error?: string; message?: string }
      if (!json.ok) throw new Error(json.error ?? json.message ?? 'invite_failed')
      return json
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', salonId] }),
  })
}

export function useCancelInvitation(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase.functions.invoke('send-invitation', {
        body: { action: 'cancel', invitation_id: invitationId },
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', salonId] }),
  })
}

export function useUpdateMemberRole(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { memberId: string; role: SalonRole }) => {
      const { error } = await supabase
        .from('salon_members')
        .update({ role: input.role })
        .eq('id', input.memberId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-members', salonId] }),
  })
}

export function useRemoveMember(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('salon_members').delete().eq('id', memberId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-members', salonId] }),
  })
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc('accept_salon_invitation', { p_token: token })
      if (error) throw error
      const json = data as {
        ok: boolean
        error?: string
        salon_id?: string
        already_member?: boolean
      }
      if (!json.ok) throw new Error(json.error ?? 'accept_failed')
      return json
    },
  })
}

/** Текущий role текущего юзера в текущем салоне. */
export function useMyRole(salonId: string | undefined) {
  return useQuery<SalonRole | null>({
    queryKey: ['my-role', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data: user } = await supabase.auth.getUser()
      if (!user.user?.id) return null
      const { data, error } = await supabase
        .from('salon_members')
        .select('role')
        .eq('salon_id', salonId)
        .eq('user_id', user.user.id)
        .maybeSingle()
      if (error) throw error
      return (data?.role ?? null) as SalonRole | null
    },
    enabled: !!salonId,
    staleTime: 5 * 60_000,
  })
}
