import { useMutation } from '@tanstack/react-query'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { apiPostRaw } from '../client'
import type { AuthResponseDto } from '../types'

export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const credential = await signInWithEmailAndPassword(auth, email, password)
      const idToken = await credential.user.getIdToken()
      return apiPostRaw<AuthResponseDto>('/auth/exchange', { idToken })
    },
  })
}
