import { useMutation, useQuery } from '@tanstack/react-query'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth, devAuthEnabled } from '@/lib/firebase'
import { apiPostRaw, apiGet } from '../client'
import type { AuthResponseDto, DevUserDto } from '../types'

export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const credential = await signInWithEmailAndPassword(auth!, email, password)
      const idToken = await credential.user.getIdToken()
      return apiPostRaw<AuthResponseDto>('/auth/exchange', { idToken })
    },
  })
}

export function useDevLogin() {
  return useMutation({
    mutationFn: ({ username }: { username: string }) =>
      apiPostRaw<AuthResponseDto>('/auth/dev-login', { username }),
  })
}

export function useDevUsers() {
  return useQuery({
    queryKey: ['dev-users'],
    queryFn: () => apiGet<DevUserDto[]>('/auth/dev-users'),
    enabled: devAuthEnabled,
    retry: false,
  })
}
